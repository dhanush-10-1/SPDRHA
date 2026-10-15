import asyncio
import json
import logging
import os

from aiokafka import AIOKafkaConsumer, TopicPartition
from dotenv import load_dotenv

from consumer.db_writer import create_pool, insert_anomaly
from backend.services.anomaly_confirmation import process_raw_anomaly

load_dotenv()

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)

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

MAX_DB_RETRIES = 5
INITIAL_RETRY_DELAY_SECONDS = 1


async def write_with_retry(pool, event: dict) -> bool:
    """Retry transient database failures with exponential backoff."""

    for attempt in range(MAX_DB_RETRIES):
        try:
            return await insert_anomaly(pool, event)

        except Exception:
            if attempt == MAX_DB_RETRIES - 1:
                logger.exception(
                    "Database write failed after %s attempts. Event ID: %s",
                    MAX_DB_RETRIES,
                    event.get("id"),
                )
                raise

            delay = INITIAL_RETRY_DELAY_SECONDS * (2**attempt)

            logger.warning(
                "Database write failed. Attempt %s/%s; retrying in %s seconds.",
                attempt + 1,
                MAX_DB_RETRIES,
                delay,
                exc_info=True,
            )

            await asyncio.sleep(delay)

    raise RuntimeError("Unexpected retry-loop termination")


async def consume():
    consumer = AIOKafkaConsumer(
        KAFKA_TOPIC,
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        group_id=KAFKA_GROUP_ID,
        enable_auto_commit=False,
        auto_offset_reset="earliest",
    )

    pool = None
    consumer_started = False

    try:
        # Initialize PostgreSQL before starting message consumption.
        pool = await create_pool()

        await consumer.start()
        consumer_started = True

        logger.info(
            "Kafka consumer started. Topic=%s Group=%s",
            KAFKA_TOPIC,
            KAFKA_GROUP_ID,
        )

        async for message in consumer:
            try:
                event = json.loads(message.value.decode("utf-8"))

                if not isinstance(event, dict):
                    raise ValueError("Kafka message must contain a JSON object")

                event_id = event.get("id")
                await write_with_retry(pool, event)

                # Step 2: Apply provisional confirmation rules.
                confirmation_result = await process_raw_anomaly(pool, event_id)

                logger.info(
                    "Confirmation completed. Event ID=%s Result=%s",
                    event_id,
                    confirmation_result,
                )

                # Step 3: Commit the Kafka offset only after both operations succeed.
                await consumer.commit(
                {
                    TopicPartition(message.topic, message.partition):
                        message.offset + 1
                }
                )

                logger.info(
                    "Event processed and offset committed. "
                    "Event ID=%s Partition=%s Offset=%s",
                    event_id,
                    message.partition,
                    message.offset,
                )

            except json.JSONDecodeError:
                # Do not silently skip malformed messages.
                # Stop consumption so the message can be investigated.
                logger.exception(
                    "Malformed JSON at partition=%s offset=%s. "
                    "Offset was not committed.",
                    message.partition,
                    message.offset,
                )
                raise

            except (UnicodeDecodeError, ValueError):
                logger.exception(
                    "Invalid message at partition=%s offset=%s. "
                    "Offset was not committed.",
                    message.partition,
                    message.offset,
                )
                raise

            except Exception:
                # Includes exhausted database retries and commit failures.
                # Stop instead of continuing past an uncommitted message.
                logger.exception(
                    "Message processing failed at partition=%s offset=%s. "
                    "Offset was not intentionally advanced.",
                    message.partition,
                    message.offset,
                )
                raise

    except asyncio.CancelledError:
        logger.info("Consumer cancellation requested.")
        raise

    except Exception:
        logger.exception("Kafka consumer stopped because of an error.")
        raise

    finally:
        if consumer_started:
            await consumer.stop()

        if pool is not None:
            await pool.close()

        logger.info("Kafka consumer resources closed.")


if __name__ == "__main__":
    try:
        asyncio.run(consume())
    except KeyboardInterrupt:
        logger.info("Consumer stopped by user.")