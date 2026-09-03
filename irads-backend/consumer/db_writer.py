import os
from uuid import UUID

import asyncpg
from dotenv import load_dotenv

load_dotenv()


async def create_pool():
    return await asyncpg.create_pool(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5433")),
        database=os.getenv("DB_NAME", "irads"),
        user=os.getenv("DB_USER", "irads_user"),
        password=os.getenv("DB_PASSWORD", "irads_pass_2024"),
        min_size=1,
        max_size=5,
    )


async def insert_anomaly(pool, event: dict):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO raw_anomaly_events (
                id,
                type,
                confidence,
                location,
                gps_accuracy_m,
                speed_kmh,
                raw_z_peak,
                device_id_hash,
                detected_at
            )
            VALUES (
                $1,
                $2,
                $3,
                ST_SetSRID(
                    ST_MakePoint($4, $5),
                    4326
                )::GEOGRAPHY,
                $6,
                $7,
                $8,
                $9,
                to_timestamp($10 / 1000.0)
            )
            """,
            UUID(event["id"]),
            event["type"],
            event["confidence"],
            event["longitude"],
            event["latitude"],
            event["gps_accuracy_m"],
            event["speed_kmh"],
            event["raw_z_peak"],
            event["device_id_hash"],
            event["detected_at_ms"],
        )