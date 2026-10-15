import logging
import os
from uuid import UUID

import asyncpg
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


async def create_pool():
    """Create a PostgreSQL connection pool using environment variables."""

    required_variables = [
        "DB_NAME",
        "DB_USER",
        "DB_PASSWORD",
    ]

    missing = [
        name for name in required_variables
        if not os.getenv(name)
    ]

    if missing:
        raise RuntimeError(
            f"Missing required database environment variables: {', '.join(missing)}"
        )

    return await asyncpg.create_pool(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5433")),
        database=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        min_size=1,
        max_size=5,
        command_timeout=10,
        timeout=10,
    )


def validate_event(event: dict) -> dict:
    """Validate and normalize an incoming anomaly event."""

    required_fields = [
        "id",
        "type",
        "confidence",
        "latitude",
        "longitude",
        "gps_accuracy_m",
        "speed_kmh",
        "raw_z_peak",
        "device_id_hash",
        "detected_at_ms",
    ]

    if not isinstance(event, dict):
        raise ValueError("Event must be a JSON object")

    missing = [
        field for field in required_fields
        if field not in event or event[field] is None
    ]

    if missing:
        raise ValueError(
            f"Missing required event fields: {', '.join(missing)}"
        )

    try:
        event_id = UUID(str(event["id"]))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError("Event id must be a valid UUID") from exc

    anomaly_type = event["type"]

    if anomaly_type not in {"POTHOLE", "SPEED_BREAKER", "BUMP"}:
        raise ValueError("Unsupported anomaly type")

    def finite_number(field):
        value = event[field]

        if isinstance(value, bool):
            raise ValueError(f"{field} must be numeric")

        try:
            number = float(value)
        except (ValueError, TypeError, OverflowError) as exc:
            raise ValueError(f"{field} must be numeric") from exc

        import math

        if not math.isfinite(number):
            raise ValueError(f"{field} must be finite")

        return number

    confidence = finite_number("confidence")
    latitude = finite_number("latitude")
    longitude = finite_number("longitude")
    gps_accuracy_m = finite_number("gps_accuracy_m")
    speed_kmh = finite_number("speed_kmh")
    raw_z_peak = finite_number("raw_z_peak")
    detected_at_ms = finite_number("detected_at_ms")

    if not 0 <= confidence <= 1:
        raise ValueError("confidence must be between 0 and 1")

    if not -90 <= latitude <= 90:
        raise ValueError("latitude must be between -90 and 90")

    if not -180 <= longitude <= 180:
        raise ValueError("longitude must be between -180 and 180")

    if gps_accuracy_m < 0:
        raise ValueError("gps_accuracy_m cannot be negative")

    if not 0 <= speed_kmh <= 200:
        raise ValueError("speed_kmh must be between 0 and 200")

    if not -20 <= raw_z_peak <= 20:
        raise ValueError("raw_z_peak must be between -20 and 20")

    if detected_at_ms < 0 or not detected_at_ms.is_integer():
        raise ValueError("detected_at_ms must be a non-negative integer")

    device_id_hash = event["device_id_hash"]

    if not isinstance(device_id_hash, str):
        raise ValueError("device_id_hash must be a string")

    if len(device_id_hash) != 64:
        raise ValueError("device_id_hash must contain 64 characters")

    try:
        int(device_id_hash, 16)
    except ValueError as exc:
        raise ValueError(
            "device_id_hash must be a hexadecimal SHA-256 hash"
        ) from exc

    return {
        "id": event_id,
        "type": anomaly_type,
        "confidence": confidence,
        "latitude": latitude,
        "longitude": longitude,
        "gps_accuracy_m": gps_accuracy_m,
        "speed_kmh": speed_kmh,
        "raw_z_peak": raw_z_peak,
        "device_id_hash": device_id_hash.lower(),
        "detected_at_ms": int(detected_at_ms),
    }


async def insert_anomaly(pool, event: dict) -> bool:
    """Insert an anomaly and return whether a new row was created."""

    validated = validate_event(event)

    async with pool.acquire() as conn:
        result = await conn.execute(
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
            ON CONFLICT (id) DO NOTHING
            """,
            validated["id"],
            validated["type"],
            validated["confidence"],
            validated["longitude"],
            validated["latitude"],
            validated["gps_accuracy_m"],
            validated["speed_kmh"],
            validated["raw_z_peak"],
            validated["device_id_hash"],
            validated["detected_at_ms"],
        )

    inserted = result == "INSERT 0 1"

    if inserted:
        logger.info(
            "Anomaly inserted: %s",
            validated["id"],
        )
    else:
        logger.info(
            "Duplicate anomaly ignored: %s",
            validated["id"],
        )

    return inserted