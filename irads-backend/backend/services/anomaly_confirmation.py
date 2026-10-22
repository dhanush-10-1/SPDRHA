import logging

import asyncpg

logger = logging.getLogger(__name__)

CONFIDENCE_THRESHOLD = 0.70
MATCH_RADIUS_METERS = 15.0
SUPPORTED_ANOMALY_TYPES = {"POTHOLE", "SPEED_BREAKER"}


async def process_raw_anomaly(
    pool: asyncpg.Pool,
    event_id,
) -> str:
    """
    Process one raw anomaly event transactionally.

    Events with confidence >= 0.70 are provisionally confirmed.
    Nearby active anomalies of the same type are merged within 15 metres.

    Returns:
        confirmed_created: A new confirmed anomaly was created.
        confirmed_updated: An existing confirmed anomaly was updated.
        below_threshold: Confidence was below the threshold.
        already_processed: The event had already been processed.
    """

    async with pool.acquire() as connection:
        async with connection.transaction():
            # Lock this event so concurrent processing cannot process it twice.
            raw_event = await connection.fetchrow(
                """
                SELECT
                    id,
                    type,
                    confidence,
                    location,
                    detected_at,
                    is_processed
                FROM raw_anomaly_events
                WHERE id = $1
                FOR UPDATE
                """,
                event_id,
            )

            if raw_event is None:
                raise ValueError(f"Raw anomaly event not found: {event_id}")

            if raw_event["is_processed"]:
                return "already_processed"

            if raw_event["type"] not in SUPPORTED_ANOMALY_TYPES:
                raise ValueError(
                    f"Unsupported anomaly type: {raw_event['type']}"
                )

            confidence = raw_event["confidence"]

            if confidence < CONFIDENCE_THRESHOLD:
                await connection.execute(
                    """
                    UPDATE raw_anomaly_events
                    SET is_processed = TRUE
                    WHERE id = $1
                    """,
                    event_id,
                )

                return "below_threshold"

            # Serialize confirmation operations to prevent two simultaneous
            # events from creating separate records for the same nearby hazard.
            await connection.execute(
                "SELECT pg_advisory_xact_lock($1)",
                81720415,
            )

            # Find the nearest active anomaly of the same type.
            matching_anomaly = await connection.fetchrow(
                """
                SELECT
                    id,
                    confidence_avg,
                    report_count,
                    severity
                FROM confirmed_anomalies
                WHERE is_active = TRUE
                  AND type = $1
                  AND ST_DWithin(
                      location,
                      $2::geography,
                      $3
                  )
                ORDER BY ST_Distance(location, $2::geography)
                LIMIT 1
                FOR UPDATE
                """,
                raw_event["type"],
                raw_event["location"],
                MATCH_RADIUS_METERS,
            )

            if matching_anomaly is None:
                await connection.execute(
                    """
                    INSERT INTO confirmed_anomalies (
                        location,
                        type,
                        severity,
                        confidence_avg,
                        report_count,
                        first_seen,
                        last_seen,
                        is_active,
                        updated_at
                    )
                    VALUES (
                        $1,
                        $2,
                        1,
                        $3,
                        1,
                        $4,
                        $4,
                        TRUE,
                        NOW()
                    )
                    """,
                    raw_event["location"],
                    raw_event["type"],
                    confidence,
                    raw_event["detected_at"],
                )

                result = "confirmed_created"

            else:
                old_count = matching_anomaly["report_count"] or 1
                old_confidence = matching_anomaly["confidence_avg"]

                if old_confidence is None:
                    old_confidence = confidence

                new_count = old_count + 1

                new_average = (
                    old_confidence * old_count + confidence
                ) / new_count

                await connection.execute(
                    """
                    UPDATE confirmed_anomalies
                    SET
                        confidence_avg = $2,
                        report_count = $3,
                        last_seen = GREATEST(
                            COALESCE(last_seen, $4),
                            $4
                        ),
                        updated_at = NOW()
                    WHERE id = $1
                    """,
                    matching_anomaly["id"],
                    new_average,
                    new_count,
                    raw_event["detected_at"],
                )

                result = "confirmed_updated"

            # Mark the raw event processed only after confirmation succeeds.
            await connection.execute(
                """
                UPDATE raw_anomaly_events
                SET is_processed = TRUE
                WHERE id = $1
                """,
                event_id,
            )

    logger.info(
        "Anomaly confirmation processed. Event ID=%s Result=%s",
        event_id,
        result,
    )

    return result