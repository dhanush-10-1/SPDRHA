import asyncio
import json
import logging
import os

from aiokafka import AIOKafkaConsumer
from consumer.db_writer import create_pool, insert_anomaly
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

KAFKA_BOOTSTRAP_SERVERS = os.getenv(
    "KAFKA_BOOTSTRAP_SERVERS",
    "localhost:9092",
)

KAFKA_TOPIC = os.getenv(
    "KAFKA_TOPIC",
    "raw_anomaly_events",
)

KAFKA_GROUP_ID = os.getenv(
    "KAFKA_GROUP_ID",
    "irads-anomaly-consumer",
)


async def consume():
    consumer = AIOKafkaConsumer(
        KAFKA_TOPIC,
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        group_id=KAFKA_GROUP_ID,
        value_deserializer=lambda value: json.loads(value.decode("utf-8")),
        auto_offset_reset="earliest",
    )

    pool = await create_pool()

    await consumer.start()

    try:
        logger.info("Kafka consumer started")

        async for message in consumer:
            event = message.value

            logger.info("Received event: %s", event)

            try:
                await insert_anomaly(pool, event)

                logger.info(
                    "Anomaly %s inserted into PostgreSQL",
                    event.get("id"),
                )

            except Exception as exc:
                logger.exception(
                "Failed to process Kafka message: %s",
                exc,
                )

    finally:
        await consumer.stop()
        await pool.close()

        logger.info("Kafka consumer stopped")


if __name__ == "__main__":
    asyncio.run(consume())