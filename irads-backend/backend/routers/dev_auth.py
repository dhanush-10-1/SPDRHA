import os
from datetime import datetime, timedelta, timezone

from jose import jwt
from fastapi import APIRouter

router = APIRouter()

JWT_SECRET = os.getenv(
    "JWT_SECRET",
    "irads_jwt_secret_key_2024",
)
JWT_ALGORITHM = "HS256"


@router.post("/api/v1/dev/token")
async def create_dev_token():
    expires_at = datetime.now(timezone.utc) + timedelta(hours=12)

    payload = {
        "device_id": "review_device",
        "exp": expires_at,
    }

    token = jwt.encode(
        payload,
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )

    return {
        "access_token": token,
        "token_type": "bearer",
    }