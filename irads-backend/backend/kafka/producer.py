import json
import logging
import os
from typing import Optional

from aiokafka import AIOKafkaProducer
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

KAFKA_BOOTSTRAP_SERVERS = os.getenv(
    "KAFKA_BOOTSTRAP_SERVERS",
    "localhost:9092"
)

KAFKA_TOPIC = os.getenv(
    "KAFKA_TOPIC",
    "raw_anomaly_events"
)

_producer: Optional[AIOKafkaProducer] = None


def get_producer() -> Optional[AIOKafkaProducer]:
    return _producer


async def start_producer() -> AIOKafkaProducer:
    global _producer

    if _producer is not None:
        return _producer

    _producer = AIOKafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        value_serializer=lambda value: json.dumps(value).encode("utf-8"),
    )

    await _producer.start()

    return _producer


async def stop_producer() -> None:
    global _producer

    if _producer is not None:
        await _producer.stop()
        _producer = None


async def publish(event: dict) -> bool:
    producer = get_producer()

    if producer is None:
        try:
            producer = await start_producer()
        except Exception as exc:
            logger.exception("Kafka producer startup failed: %s", exc)
            return False

    try:
        await producer.send_and_wait(KAFKA_TOPIC, event)
        return True

    except Exception as exc:
        logger.exception(
            "Failed to publish event to Kafka topic %s: %s",
            KAFKA_TOPIC,
            exc
        )
        return False