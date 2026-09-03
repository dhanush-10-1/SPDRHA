import redis.asyncio as redis
from fastapi import APIRouter, Depends, HTTPException, status

from backend.auth.jwt import get_current_device
from backend.kafka.producer import publish
from backend.models.anomaly import AnomalyCreate, AnomalyReceived

router = APIRouter()


async def get_redis_client() -> redis.Redis:
    redis_client = redis.Redis(
        host="127.0.0.1",
        port=6379,
        decode_responses=True,
    )
    return redis_client


async def rate_limit_exceeded(device_id_hash: str) -> bool:
    redis_client = await get_redis_client()

    key = f"anomaly_rate:{device_id_hash}"
    current = await redis_client.incr(key)

    if current == 1:
        await redis_client.expire(key, 3600)

    if current > 50:
        ttl = await redis_client.ttl(key)
        retry_after = max(ttl, 1)

        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded",
            headers={"Retry-After": str(retry_after)},
        )

    return False


@router.post(
    "/api/v1/anomalies",
    response_model=AnomalyReceived,
    status_code=status.HTTP_200_OK,
)
async def create_anomaly(
    payload: AnomalyCreate,
    current_device: dict = Depends(get_current_device),
):
    device_id_hash = payload.device_id_hash

    await rate_limit_exceeded(device_id_hash)

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