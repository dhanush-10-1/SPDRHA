import asyncio
import os
import uuid

from dotenv import load_dotenv
from consumer.db_writer import create_pool, insert_anomaly, validate_event

load_dotenv()


async def main():
    pool = await create_pool()

    event_id = str(uuid.uuid4())

    event = {
        "id": event_id,
        "type": "POTHOLE",
        "confidence": 0.91,
        "latitude": 12.9716,
        "longitude": 77.5946,
        "gps_accuracy_m": 8.5,
        "speed_kmh": 35.5,
        "raw_z_peak": 4.2,
        "device_id_hash": "a" * 64,
        "detected_at_ms": 1756700000000,
    }

    try:
        # Test 1: Valid event should insert successfully.
        first_insert = await insert_anomaly(pool, event)
        assert first_insert is True, "Expected the first insert to succeed"
        print("PASS: Valid event inserted")

        # Test 2: Duplicate event should not insert again.
        duplicate_insert = await insert_anomaly(pool, event)
        assert duplicate_insert is False, "Expected duplicate to be ignored"
        print("PASS: Duplicate event ignored")

        # Test 3: Invalid confidence should be rejected.
        invalid_event = {**event, "confidence": 1.5}

        try:
            validate_event(invalid_event)
            raise AssertionError("Invalid confidence was accepted")
        except ValueError:
            print("PASS: Invalid confidence rejected")

        # Test 4: Invalid coordinates should be rejected.
        invalid_event = {**event, "latitude": 100}

        try:
            validate_event(invalid_event)
            raise AssertionError("Invalid latitude was accepted")
        except ValueError:
            print("PASS: Invalid latitude rejected")

    finally:
        # Remove the test row so it doesn't pollute your dataset.
        async with pool.acquire() as conn:
            await conn.execute(
                "DELETE FROM raw_anomaly_events WHERE id = $1",
                uuid.UUID(event_id),
            )

        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())