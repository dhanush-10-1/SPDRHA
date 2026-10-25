import redis.asyncio as redis
import os
import json

from fastapi import Body

from fastapi import APIRouter, Depends, HTTPException, Query, status
from typing import Literal
from uuid import UUID


from backend.auth.jwt import get_current_device
from backend.db.connection import get_pool
from backend.kafka.producer import publish
from backend.models.anomaly import AnomalyCreate, AnomalyReceived

import logging

logger = logging.getLogger(__name__)

router = APIRouter()


async def get_redis_client() -> redis.Redis:
    return redis.Redis(
        host=os.getenv("REDIS_HOST", "127.0.0.1"),
        port=int(os.getenv("REDIS_PORT", "6379")),
        password=os.getenv("REDIS_PASSWORD") or None,
        decode_responses=True,
    )


async def rate_limit_exceeded(device_id_hash: str) -> bool:
    redis_client = await get_redis_client()

    try:
        key = f"anomaly_rate:{device_id_hash}"
        current = await redis_client.incr(key)

        if current == 1:
            await redis_client.expire(key, 3600)

        if current > 50:
            ttl = await redis_client.ttl(key)

            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded",
                headers={"Retry-After": str(max(ttl, 1))},
            )

        return False

    finally:
        await redis_client.aclose()


@router.post(
    "/api/v1/anomalies",
    response_model=AnomalyReceived,
    status_code=status.HTTP_200_OK,
)
async def create_anomaly(
    payload: AnomalyCreate,
    current_device: dict = Depends(get_current_device),
):
    if current_device.get("device_id") != payload.device_id_hash:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Device identity does not match authenticated token",
        )

    await rate_limit_exceeded(payload.device_id_hash)

    event = payload.model_dump()
    event["type"] = payload.type.value

    published = await publish(event)

    if not published:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to publish anomaly to Kafka",
        )

    return {
        "id": payload.id,
        "status": "received",
    }


@router.get("/api/v1/anomalies/nearby")
async def get_nearby_anomalies(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    radius_m: float = Query(5000, gt=0, le=50000),
    anomaly_type: Literal[
        "POTHOLE",
        "SPEED_BREAKER",
    ] | None = None,
):
    pool = get_pool()

    if pool is None:
        raise HTTPException(
            status_code=503,
            detail="Database connection is unavailable",
        )

    query = """
        SELECT
            id,
            type,
            severity,
            confidence_avg,
            report_count,
            ST_Y(location::geometry) AS latitude,
            ST_X(location::geometry) AS longitude,
            first_seen,
            last_seen,
            updated_at
        FROM confirmed_anomalies
        WHERE is_active = TRUE
          AND ST_DWithin(
              location,
              ST_SetSRID(
                  ST_MakePoint($1, $2),
                  4326
              )::geography,
              $3
          )
          AND ($4::VARCHAR IS NULL OR type = $4)
        ORDER BY ST_Distance(
            location,
            ST_SetSRID(
                ST_MakePoint($1, $2),
                4326
            )::geography
        )
        LIMIT 1000
    """

    try:
        async with pool.acquire() as connection:
            rows = await connection.fetch(
                query,
                longitude,
                latitude,
                radius_m,
                anomaly_type,
            )

    except Exception as exc:
        print(f"Nearby anomaly query failed: {exc}")

        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve nearby anomalies",
        ) from exc

    anomalies = []

    for row in rows:
        anomalies.append(
            {
                "id": str(row["id"]),
                "type": row["type"],
                "severity": row["severity"],
                "confidence": row["confidence_avg"],
                "report_count": row["report_count"],
                "latitude": row["latitude"],
                "longitude": row["longitude"],
                "first_seen": (
                    row["first_seen"].isoformat()
                    if row["first_seen"]
                    else None
                ),
                "last_seen": (
                    row["last_seen"].isoformat()
                    if row["last_seen"]
                    else None
                ),
                "updated_at": (
                    row["updated_at"].isoformat()
                    if row["updated_at"]
                    else None
                ),
            }
        )

    return {
        "count": len(anomalies),
        "radius_m": radius_m,
        "anomalies": anomalies,
    }

@router.get("/api/v1/anomalies/raw/nearby")
async def get_nearby_raw_anomalies(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    radius_m: float = Query(10000, gt=0, le=50000),
    anomaly_type: Literal["POTHOLE", "SPEED_BREAKER"] | None = None,
):
    pool = get_pool()

    if pool is None:
        raise HTTPException(
            status_code=503,
            detail="Database connection unavailable",
        )

    query = """
        SELECT
            id,
            type,
            confidence,
            gps_accuracy_m,
            speed_kmh,
            ST_Y(location::geometry) AS latitude,
            ST_X(location::geometry) AS longitude,
            detected_at,
            created_at,
            is_processed
        FROM raw_anomaly_events
        WHERE ST_DWithin(
            location,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
            $3
        )
        AND ($4::VARCHAR IS NULL OR type = $4)
        ORDER BY created_at DESC
        LIMIT 1000
    """

    async with pool.acquire() as connection:
        rows = await connection.fetch(
            query,
            longitude,
            latitude,
            radius_m,
            anomaly_type,
        )

    anomalies = [
        {
            "id": str(row["id"]),
            "type": row["type"],
            "confidence": row["confidence"],
            "gps_accuracy_m": row["gps_accuracy_m"],
            "speed_kmh": row["speed_kmh"],
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "detected_at": (
                row["detected_at"].isoformat()
                if row["detected_at"] else None
            ),
            "created_at": (
                row["created_at"].isoformat()
                if row["created_at"] else None
            ),
            "is_processed": row["is_processed"],
        }
        for row in rows
    ]


    return {
        "count": len(anomalies),
        "radius_m": radius_m,
        "anomalies": anomalies,
    }

@router.post("/api/v1/anomalies/along-route")
async def get_anomalies_along_route(
    route_coordinates: list[list[float]] = Body(
        ...,
        description="Route coordinates as [longitude, latitude] pairs",
        min_length=2,
    ),
    corridor_m: float = Query(15.0, gt=0, le=100),
    anomaly_type: Literal[
        "POTHOLE",
        "SPEED_BREAKER",
    ] | None = None,
):
    """
    Return active confirmed anomalies close to the selected route.

    Coordinate format:
        [[longitude, latitude], [longitude, latitude], ...]
    """

    pool = get_pool()

    if pool is None:
        raise HTTPException(
            status_code=503,
            detail="Database connection unavailable",
        )

    # Validate route coordinates before querying PostGIS.
    if len(route_coordinates) > 10000:
        raise HTTPException(
            status_code=400,
            detail="Route contains too many coordinates",
        )

    for coordinate in route_coordinates:
        if len(coordinate) != 2:
            raise HTTPException(
                status_code=400,
                detail="Each coordinate must be [longitude, latitude]",
            )

        longitude, latitude = coordinate

        if not (-180 <= longitude <= 180):
            raise HTTPException(
                status_code=400,
                detail="Longitude must be between -180 and 180",
            )

        if not (-90 <= latitude <= 90):
            raise HTTPException(
                status_code=400,
                detail="Latitude must be between -90 and 90",
            )

    query = """
        WITH selected_route AS (
            SELECT ST_SetSRID(
                ST_MakeLine(
                    ARRAY(
                        SELECT ST_SetSRID(
                            ST_MakePoint(
                                (coordinate->>0)::DOUBLE PRECISION,
                                (coordinate->>1)::DOUBLE PRECISION
                            ),
                            4326
                        )
                        FROM json_array_elements($1::JSON) AS coordinate
                    )
                ),
                4326
            )::geography AS route
        )
        SELECT
            anomaly.id,
            anomaly.type,
            anomaly.severity,
            anomaly.confidence_avg AS confidence,
            anomaly.report_count,
            ST_Y(anomaly.location::geometry) AS latitude,
            ST_X(anomaly.location::geometry) AS longitude,
            ST_Distance(
                anomaly.location,
                selected_route.route
            ) AS distance_to_route_m,
            anomaly.last_seen
        FROM confirmed_anomalies AS anomaly
        CROSS JOIN selected_route
        WHERE anomaly.is_active = TRUE
          AND ST_DWithin(
              anomaly.location,
              selected_route.route,
              $2
          )
          AND ($3::VARCHAR IS NULL OR anomaly.type = $3)
        ORDER BY distance_to_route_m ASC
        LIMIT 1000
    """

    try:
        async with pool.acquire() as connection:
            rows = await connection.fetch(
                query,
                json.dumps(route_coordinates),
                corridor_m,
                anomaly_type,
            )

    except Exception as exc:
        logger.exception("Route anomaly query failed")

        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve route anomalies",
        ) from exc

    anomalies = [
        {
            "id": str(row["id"]),
            "type": row["type"],
            "severity": row["severity"],
            "confidence": row["confidence"],
            "report_count": row["report_count"],
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "distance_to_route_m": row["distance_to_route_m"],
            "last_seen": (
                row["last_seen"].isoformat()
                if row["last_seen"] else None
            ),
        }
        for row in rows
    ]

    return {
        "count": len(anomalies),
        "corridor_m": corridor_m,
        "anomalies": anomalies,
    }
