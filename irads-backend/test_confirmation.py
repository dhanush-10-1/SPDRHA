import asyncio
from datetime import datetime, timezone
from uuid import uuid4

from dotenv import load_dotenv

from consumer.db_writer import create_pool, insert_anomaly
from backend.services.anomaly_confirmation import process_raw_anomaly

load_dotenv(".env")

# Use an isolated test location.
LATITUDE = -45.123456
LONGITUDE = 130.123456


def create_event(confidence: float) -> dict:
    timestamp_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

    return {
        "id": str(uuid4()),
        "type": "POTHOLE",
        "confidence": confidence,
        "latitude": LATITUDE,
        "longitude": LONGITUDE,
        "gps_accuracy_m": 5.0,
        "speed_kmh": 30.0,
        "raw_z_peak": 4.5,
        "device_id_hash": "b" * 64,
        "detected_at_ms": timestamp_ms,
    }


async def main():
    pool = await create_pool()
    event_ids = []
    confirmed_id = None

    try:
        # Check that the test location is not already occupied.
        async with pool.acquire() as connection:
            existing = await connection.fetchval(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM confirmed_anomalies
                    WHERE is_active = TRUE
                      AND type = 'POTHOLE'
                      AND ST_DWithin(
                          location,
                          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                          15
                      )
                )
                """,
                LONGITUDE,
                LATITUDE,
            )

        if existing:
            print("STOPPED: A confirmed pothole already exists at the test location.")
            print("Choose another unused test location before running again.")
            return

        # TEST 1: A high-confidence event creates an anomaly.
        event1 = create_event(0.95)
        event_ids.append(event1["id"])
        await insert_anomaly(pool, event1)

        result1 = await process_raw_anomaly(pool, event1["id"])
        print("TEST 1 - FIRST PROCESSING:", result1)
        assert result1 == "confirmed_created"

        # Find the exact confirmed anomaly created by this test.
        async with pool.acquire() as connection:
            confirmed_id = await connection.fetchval(
                """
                SELECT id
                FROM confirmed_anomalies
                WHERE type = 'POTHOLE'
                  AND ST_DWithin(
                      location,
                      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                      15
                  )
                  AND first_seen = to_timestamp($3 / 1000.0)
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                LONGITUDE,
                LATITUDE,
                event1["detected_at_ms"],
            )

        assert confirmed_id is not None, "Created anomaly was not found."

        # TEST 2: Processing the same event again must not duplicate it.
        result2 = await process_raw_anomaly(pool, event1["id"])
        print("TEST 2 - DUPLICATE PROCESSING:", result2)
        assert result2 == "already_processed"

        # TEST 3: A second high-confidence event updates the same anomaly.
        event2 = create_event(0.80)
        event_ids.append(event2["id"])
        await insert_anomaly(pool, event2)

        result3 = await process_raw_anomaly(pool, event2["id"])
        print("TEST 3 - SECOND HIGH-CONFIDENCE EVENT:", result3)
        assert result3 == "confirmed_updated"

        async with pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                SELECT confidence_avg, report_count
                FROM confirmed_anomalies
                WHERE id = $1
                """,
                confirmed_id,
            )

        print("AFTER TEST 3:", dict(row))
        assert row["report_count"] == 2
        assert abs(row["confidence_avg"] - 0.875) < 0.000001

        # TEST 4: A low-confidence event must not update the anomaly.
        event3 = create_event(0.50)
        event_ids.append(event3["id"])
        await insert_anomaly(pool, event3)

        result4 = await process_raw_anomaly(pool, event3["id"])
        print("TEST 4 - LOW-CONFIDENCE EVENT:", result4)
        assert result4 == "below_threshold"

        async with pool.acquire() as connection:
            row_after_low = await connection.fetchrow(
                """
                SELECT confidence_avg, report_count
                FROM confirmed_anomalies
                WHERE id = $1
                """,
                confirmed_id,
            )

            processed = await connection.fetchval(
                """
                SELECT is_processed
                FROM raw_anomaly_events
                WHERE id = $1
                """,
                event3["id"],
            )

        print("AFTER TEST 4:", dict(row_after_low))
        print("LOW-CONFIDENCE EVENT PROCESSED:", processed)

        assert row_after_low["report_count"] == 2
        assert abs(row_after_low["confidence_avg"] - 0.875) < 0.000001
        assert processed is True

        print("\nALL FOUR TESTS PASSED!")

    finally:
        # Remove only the test events and the anomaly created by this test.
        async with pool.acquire() as connection:
            async with connection.transaction():
                if confirmed_id is not None:
                    await connection.execute(
                        "DELETE FROM confirmed_anomalies WHERE id = $1",
                        confirmed_id,
                    )

                if event_ids:
                    await connection.execute(
                        "DELETE FROM raw_anomaly_events WHERE id = ANY($1::uuid[])",
                        event_ids,
                    )

        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())