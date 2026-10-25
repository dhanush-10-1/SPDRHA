"""Standalone diagnostics, not the IRADS API. Only talks to fixed POC targets."""
import asyncio
import hmac
import json
import os
import time
from uuid import UUID, uuid4

import asyncpg
import redis.asyncio as redis
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer, TopicPartition
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse

DATABASE = "irads_poc"
TOPIC = "irads-poc-events"
SOURCE = "irads-render-hybrid-poc"
INSTANCE = str(uuid4())
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
probe_lock = asyncio.Lock()


def validate_environment():
    for name in ("POC_DB_PASSWORD", "POC_REDIS_PASSWORD", "POC_PROBE_TOKEN"):
        if len(os.getenv(name, "")) < 24:
            raise ValueError(name + " must contain at least 24 characters")


def authorize(x_poc_token: str = Header(default="")):
    expected = os.getenv("POC_PROBE_TOKEN", "")
    if len(expected) < 24 or not hmac.compare_digest(x_poc_token.encode(), expected.encode()):
        raise HTTPException(401, "Unauthorized")


async def postgres_connect():
    return await asyncpg.connect(
        host="127.0.0.1", port=15433, database=DATABASE, user="irads_poc",
        password=os.environ["POC_DB_PASSWORD"], timeout=5, command_timeout=5,
    )


def redis_connect():
    return redis.Redis(host="127.0.0.1", port=16379,
                       password=os.environ["POC_REDIS_PASSWORD"],
                       socket_connect_timeout=5, socket_timeout=5, decode_responses=True)


def assert_metadata(brokers):
    if not brokers or any((b.host, b.port) != ("127.0.0.1", 19092) for b in brokers):
        raise RuntimeError("Unexpected Kafka advertised listener")


async def check_postgres():
    conn = await postgres_connect()
    try:
        row = await conn.fetchrow("SELECT current_database() AS db, PostGIS_Version() AS postgis")
        if row["db"] != DATABASE or not row["postgis"]:
            raise RuntimeError("Unexpected database")
        await conn.fetchval("SELECT 1 FROM poc_deliveries LIMIT 1")
        return {"status": "ok", "database": row["db"], "postgis": row["postgis"]}
    finally:
        await conn.close()


async def check_redis(write=False):
    client = redis_connect()
    try:
        if not await client.ping():
            raise RuntimeError("Redis PING failed")
        if write:
            key, value = "irads:poc:" + str(uuid4()), str(uuid4())
            await client.set(key, value, ex=60)
            if await client.get(key) != value:
                raise RuntimeError("Redis readback failed")
        return {"status": "ok", "readback": write}
    finally:
        await client.aclose()


async def check_kafka(delivery=False):
    producer = AIOKafkaProducer(bootstrap_servers="127.0.0.1:19092", acks="all",
                               enable_idempotence=True, request_timeout_ms=5000)
    consumer = None
    try:
        await producer.start()
        brokers = producer.client.cluster.brokers()
        assert_metadata(brokers)
        result = {"status": "ok", "brokers": [{"host": b.host, "port": b.port} for b in brokers]}
        if not delivery:
            return result
        consumer = AIOKafkaConsumer(bootstrap_servers="127.0.0.1:19092",
                                   group_id=None, enable_auto_commit=False,
                                   request_timeout_ms=5000)
        await consumer.start()
        partition = TopicPartition(TOPIC, 0)
        consumer.assign([partition])
        await consumer.seek_to_end(partition)
        event = {"id": str(uuid4()), "source": SOURCE, "instance": INSTANCE, "sent_at": time.time()}
        metadata = await producer.send_and_wait(TOPIC, json.dumps(event).encode(), partition=0)
        deadline = asyncio.get_running_loop().time() + 10
        found = False
        while asyncio.get_running_loop().time() < deadline:
            batches = await consumer.getmany(timeout_ms=1000, max_records=100)
            if any(json.loads(m.value).get("id") == event["id"] for batch in batches.values() for m in batch):
                found = True
                break
        if not found:
            raise RuntimeError("Kafka readback timed out")
        # This checks the separate Windows test consumer, not only direct Kafka readback.
        conn = await postgres_connect()
        try:
            deadline = asyncio.get_running_loop().time() + 10
            while asyncio.get_running_loop().time() < deadline:
                if await conn.fetchval("SELECT EXISTS(SELECT 1 FROM poc_deliveries WHERE id=$1)", UUID(event["id"])):
                    break
                await asyncio.sleep(0.25)
            else:
                raise RuntimeError("Windows test consumer did not record event")
        finally:
            await conn.close()
        result.update(event_id=event["id"], partition=metadata.partition,
                      offset=metadata.offset, readback=True, windows_consumer=True)
        return result
    finally:
        if consumer is not None:
            await consumer.stop()
        await producer.stop()


async def bounded(operation, timeout=8):
    try:
        return await asyncio.wait_for(operation, timeout)
    except Exception as exc:
        # Intentionally omit exception messages: they may contain connection strings.
        return {"status": "error", "error_type": type(exc).__name__}


async def connectivity():
    values = await asyncio.gather(bounded(check_postgres()), bounded(check_redis()), bounded(check_kafka()))
    return dict(zip(("postgres", "redis", "kafka"), values))


def successful(results):
    return all(value["status"] == "ok" for value in results.values())


@app.get("/healthz")
async def health():
    return {"status": "alive"}


@app.get("/probe", dependencies=[Depends(authorize)])
async def read_only_probe():
    async with probe_lock:
        results = await connectivity()
        return JSONResponse({"instance": INSTANCE, "checks": results}, status_code=200 if successful(results) else 503)


@app.post("/probe", dependencies=[Depends(authorize)])
async def delivery_probe():
    async with probe_lock:
        results = await connectivity()
        if successful(results):
            results["redis"] = await bounded(check_redis(write=True))
            results["kafka"] = await bounded(check_kafka(delivery=True), timeout=35)
        return JSONResponse({"instance": INSTANCE, "checks": results}, status_code=200 if successful(results) else 503)
