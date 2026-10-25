
import hmac
import json
import os
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException
from jose import jwt
from pydantic import BaseModel

router = APIRouter()

JWT_ALGORITHM = "HS256"


class PilotTokenRequest(BaseModel):
    device_id_hash: str


def get_pilot_devices() -> dict:
    raw = os.getenv("IRADS_PILOT_DEVICE_KEYS_JSON", "")

    try:
        devices = json.loads(raw)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=503,
            detail="Pilot authentication is not configured",
        )

    if not isinstance(devices, dict):
        raise HTTPException(
            status_code=503,
            detail="Pilot authentication is not configured",
        )

    return devices


@router.post("/api/v1/dev/token")
async def create_dev_token(
    request: PilotTokenRequest,
    x_pilot_key: str = Header(default=""),
):
    device_id = request.device_id_hash.lower()

    if not re.fullmatch(r"[0-9a-f]{64}", device_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid device identity",
        )

    jwt_secret = os.getenv("JWT_SECRET", "")

    if len(jwt_secret) < 32:
        raise HTTPException(
            status_code=503,
            detail="JWT authentication is not configured",
        )

    devices = get_pilot_devices()
    expected_key = devices.get(device_id)

    if (
        not isinstance(expected_key, str)
        or len(expected_key) < 32
        or not hmac.compare_digest(
            expected_key.encode("utf-8"),
            x_pilot_key.encode("utf-8"),
        )
    ):
        raise HTTPException(
            status_code=401,
            detail="Device is not authorized",
        )

    expires_at = datetime.now(timezone.utc) + timedelta(hours=12)

    token = jwt.encode(
        {
            "device_id": device_id,
            "exp": expires_at,
        },
        jwt_secret,
        algorithm=JWT_ALGORITHM,
    )

    return {
        "access_token": token,
        "token_type": "bearer",
    }
