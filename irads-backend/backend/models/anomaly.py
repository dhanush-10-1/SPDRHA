from __future__ import annotations

from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, validator


class AnomalyType(str, Enum):
    POTHOLE = "POTHOLE"
    SPEED_BREAKER = "SPEED_BREAKER"
    BUMP = "BUMP"


class AnomalyCreate(BaseModel):
    id: str
    type: AnomalyType
    confidence: float = Field(..., ge=0.0, le=1.0)
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    gps_accuracy_m: float = Field(..., ge=0.0)
    speed_kmh: float = Field(..., ge=0.0, le=200.0)
    raw_z_peak: float = Field(..., ge=-20.0, le=20.0)
    device_id_hash: str = Field(..., min_length=1)
    detected_at_ms: int = Field(..., ge=0)

    @validator("id")
    def validate_uuid_v4(cls, value: str) -> str:
        try:
            parsed = UUID(value)
        except ValueError as exc:
            raise ValueError("id must be a valid UUID string") from exc

        if parsed.version != 4:
            raise ValueError("id must be a UUID v4 string")

        return value

    @validator("device_id_hash")
    def validate_device_id_hash(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("device_id_hash cannot be empty")

        if len(value) != 64:
            raise ValueError("device_id_hash must be a 64-character SHA-256 hash")

        try:
            int(value, 16)
        except ValueError as exc:
            raise ValueError("device_id_hash must be a valid hexadecimal SHA-256 hash") from exc

        return value

    @validator("gps_accuracy_m")
    def validate_gps_accuracy(cls, value: float) -> float:
        if value < 0:
            raise ValueError("gps_accuracy_m must be greater than or equal to 0")
        return value


class AnomalyReceived(BaseModel):
    id: str
    status: str = "received"


class HealthStatus(BaseModel):
    postgres: str
    kafka: str
    redis: str


class ErrorResponse(BaseModel):
    detail: str
