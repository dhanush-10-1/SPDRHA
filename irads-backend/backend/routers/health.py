from fastapi import APIRouter, HTTPException

from backend.db.connection import get_pool
from backend.kafka.producer import get_producer

router = APIRouter()


@router.get("/health")
async def health_check():
    postgres_status = "error"
    kafka_status = "error"
    redis_status = "error"

    pool = get_pool()
    if pool is not None:
        try:
            async with pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            postgres_status = "ok"
        except Exception:
            postgres_status = "error"

    producer = get_producer()
    if producer is not None:
        try:
            await producer.client.check_version()
            kafka_status = "ok"
        except Exception:
            kafka_status = "error"

    try:
        import redis.asyncio as redis
        from dotenv import load_dotenv
        import os

        load_dotenv()
        redis_client = redis.Redis(
            host=os.getenv("REDIS_HOST", "localhost"),
            port=int(os.getenv("REDIS_PORT", "6379")),
            db=int(os.getenv("REDIS_DB", "0")),
            decode_responses=True,
        )
        await redis_client.ping()
        redis_status = "ok"
    except Exception:
        redis_status = "error"

    return {
        "postgres": postgres_status,
        "kafka": kafka_status,
        "redis": redis_status,
    }
