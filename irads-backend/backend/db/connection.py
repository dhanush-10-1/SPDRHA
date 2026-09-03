import os
from typing import Optional

import asyncpg
from dotenv import load_dotenv

load_dotenv()

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("DB_NAME", "irads")
DB_USER = os.getenv("DB_USER", "irads_user")
DB_PASSWORD = os.getenv("DB_PASSWORD", "irads_pass_2024")
DB_MIN_SIZE = int(os.getenv("DB_MIN_SIZE", "2"))
DB_MAX_SIZE = int(os.getenv("DB_MAX_SIZE", "10"))

_pool: Optional[asyncpg.Pool] = None


def get_pool() -> Optional[asyncpg.Pool]:
    return _pool


async def connect() -> asyncpg.Pool:
    global _pool

    if _pool is not None:
        return _pool

    _pool = await asyncpg.create_pool(
        host=DB_HOST,
        port=DB_PORT,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        min_size=DB_MIN_SIZE,
        max_size=DB_MAX_SIZE,
    )

    return _pool


async def disconnect() -> None:
    global _pool

    if _pool is not None:
        await _pool.close()
        _pool = None
