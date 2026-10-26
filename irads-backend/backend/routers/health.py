import asyncio
import os

import redis.asyncio as redis
from fastapi import APIRouter, HTTPException

from backend.db.connection import get_pool
from backend.kafka.producer import get_producer

router = APIRouter()


@router.get("/healthz")
async def liveness_check():
    return {"status": "ok"}


@router.get("/health")
async def health_check():
    status = {
        "postgres": "error",
        "kafka": "error",
        "redis": "error",
    }

    pool = get_pool()
    if pool is not None:
        try:
            async with pool.acquire() as conn:
                await conn.fetchval("SELECT 1", timeout=5)
            status["postgres"] = "ok"
        except Exception:
            pass

    producer = get_producer()
    if producer is not None:
        try:
            partitions = await asyncio.wait_for(
                producer.partitions_for(
                    os.getenv("KAFKA_TOPIC", "raw_anomaly_events")
                ),
                timeout=5,
            )
            if not partitions:
                raise RuntimeError("Kafka topic has no available partitions")
            status["kafka"] = "ok"
        except Exception as exc:
            print(
                f"Kafka health check failed: {type(exc).__name__}: {exc}",
                flush=True,
            )

    redis_client = redis.Redis(
        host=os.getenv("REDIS_HOST", "localhost"),
        port=int(os.getenv("REDIS_PORT", "6379")),
        db=int(os.getenv("REDIS_DB", "0")),
        password=os.getenv("REDIS_PASSWORD") or None,
        decode_responses=True,
        socket_connect_timeout=5,
        socket_timeout=5,
    )

    try:
        await redis_client.ping()
        status["redis"] = "ok"
    except Exception:
        pass
    finally:
        await redis_client.aclose()

    if any(value != "ok" for value in status.values()):
        raise HTTPException(status_code=503, detail=status)

    return status
