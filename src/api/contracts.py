"""Public REST response contracts for the Crowd Tracking API.

The inference payload is intentionally open-ended because pipeline profiles
can add analytics sections. The lifecycle/envelope fields remain explicit so
clients can safely handle status, session, frame and error state.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorEnvelope(BaseModel):
    detail: ErrorDetail


class SessionMetadata(BaseModel):
    id: str
    mode: str
    camera_id: str | None = None
    created_at: str
    last_used_at: str
    expires_in_seconds: float | None = None
    status: str = "active"


class SessionEnvelope(BaseModel):
    status: Literal["created", "active", "reset"]
    session: SessionMetadata


class FrameMetadata(BaseModel):
    sequence: int
    submitted_monotonic_seconds: float
    completed_monotonic_seconds: float


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    sessions: dict[str, Any]


class ReadyResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    service: str
    ready: bool
    model_initialization: str | None = None
    modes: dict[str, Any] = Field(default_factory=dict)
    production_asset_manifest: str | None = None
    missing_model_assets: list[dict[str, Any]] = Field(default_factory=list)
    asset_bootstrap_command: str | None = None
    asset_manifest_error: str | None = None


class WarmupStatusResponse(BaseModel):
    status: Literal["idle", "warming", "tracking_ready", "ready", "failed", "blocked", "in_use"]
    mode: str
    progress: float = 0.0
    stage: str = "idle"
    message: str
    error: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    elapsed_seconds: float | None = None
    cached: bool = False
    active_sessions: int = 0
    detector_ready: bool = False
    tracker_ready: bool = False
    attributes_ready: bool = False


class SessionStatsResponse(BaseModel):
    status: Literal["ready", "waiting_for_frame"]
    session: SessionMetadata
    frame: FrameMetadata | None = None
    analytics: dict[str, Any] | None = None
    live_stream: dict[str, Any]


class SessionLayoutRequest(BaseModel):
    session_layout: dict[str, Any]


class SessionCalibrationRequest(BaseModel):
    calibration: dict[str, Any]


class SessionConfigurationResponse(BaseModel):
    status: Literal["updated"]
    session: SessionMetadata
    classroom: dict[str, Any]


class FrameResponse(BaseModel):
    status: Literal["accepted"]
    sequence: int
    result_sequence: int | None = None
    analytics: dict[str, Any] | None = None
    overlay: dict[str, Any] | None = None


class VideoAnalysisResponse(BaseModel):
    status: Literal["completed"]
    mode: str
    input: dict[str, Any] = Field(default_factory=dict)
    performance: dict[str, Any] = Field(default_factory=dict)
    analytics: dict[str, Any] = Field(default_factory=dict)
    artifacts: dict[str, Any] = Field(default_factory=dict)


__all__ = [
    "ErrorDetail",
    "ErrorEnvelope",
    "FrameMetadata",
    "FrameResponse",
    "HealthResponse",
    "ReadyResponse",
    "WarmupStatusResponse",
    "SessionEnvelope",
    "SessionCalibrationRequest",
    "SessionConfigurationResponse",
    "SessionLayoutRequest",
    "SessionMetadata",
    "SessionStatsResponse",
    "VideoAnalysisResponse",
]
