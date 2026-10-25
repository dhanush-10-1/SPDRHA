"""Test-only delivery recorder. Never imports or runs the IRADS consumer."""
import asyncio
import json
import os
import signal
from uuid import UUID

import asyncpg
from aiokafka import AIOKafkaConsumer, TopicPartition

DATABASE = "irads_poc"
TOPIC = "irads-poc-events"
SOURCE = "irads-render-hybrid-poc"


def validate_event(value):
    if not isinstance(value, dict) or value.get("source") != SOURCE:
        raise ValueError("Not a POC event")
    UUID(value["id"])
    return value


async def consume():
    pool = await asyncpg.create_pool(
        host="postgres", port=5432, database=DATABASE, user="irads_poc",
        password=os.environ["POC_DB_PASSWORD"], min_size=1, max_size=2,
        timeout=5, command_timeout=5,
    )
    consumer = AIOKafkaConsumer(
        TOPIC, bootstrap_servers="kafka:29092", group_id="irads-poc-recorder-v1",
        auto_offset_reset="earliest", enable_auto_commit=False,
    )
    try:
        await consumer.start()
        async for message in consumer:
            event = validate_event(json.loads(message.value))
            async with pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO poc_deliveries(id, payload) VALUES($1, $2::jsonb) "
                    "ON CONFLICT(id) DO NOTHING", UUID(event["id"]), json.dumps(event),
                )
            await consumer.commit({TopicPartition(message.topic, message.partition): message.offset + 1})
            print("POC event recorded", flush=True)
    finally:
        await consumer.stop()
        await pool.close()


async def main():
    task = asyncio.create_task(consume())
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, task.cancel)
    try:
        await task
    except asyncio.CancelledError:
        pass


if __name__ == "__main__":
    asyncio.run(main())
