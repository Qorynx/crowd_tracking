"""FastAPI factory for the bounded Crowd Analytics demonstration API."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
import math
from pathlib import Path
from time import monotonic
from typing import Any, Callable

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field

from src.api.config import ApiSettings
from src.api.contracts import (
    ErrorEnvelope,
    FrameResponse,
    HealthResponse,
    ReadyResponse,
    SessionEnvelope,
    SessionCalibrationRequest,
    SessionConfigurationResponse,
    SessionLayoutRequest,
    SessionStatsResponse,
    WarmupStatusResponse,
    VideoJobAcceptedResponse,
    VideoJobStatusResponse,
)
from src.api.sessions import (
    ApiSessionError,
    DemoSessionManager,
    SessionCapacityError,
    SessionInitializationError,
    SessionManager,
    SessionNotFoundError,
    SessionWarmupInProgress,
    UnsupportedSessionModeError,
    build_crowd_pipeline_factory,
)
from src.api.video import (
    ShortVideoAnalyzer,
    VideoArtifactNotFoundError,
    VideoArtifactStore,
    VideoAnalysisBusyError,
    VideoJobManager,
    VideoJobNotFoundError,
    UnsupportedVideoError,
    VideoAnalysisError,
    VideoAnalyzer,
    VideoTooLargeError,
    VideoTooLongError,
)
from src.api.webrtc import WebRTCPeerRegistry, create_webrtc_router


API_PREFIX = "/api/v1"
SESSION_ERROR_RESPONSES = {
    404: {"model": ErrorEnvelope},
    409: {"model": ErrorEnvelope},
    422: {"model": ErrorEnvelope},
    429: {"model": ErrorEnvelope},
    503: {"model": ErrorEnvelope},
}


class CreateSessionRequest(BaseModel):
    """Only allow named demo profiles; never accept client filesystem paths."""

    mode: str = Field(default="default", description="`default` or `classroom_demo`.")
    camera_id: str | None = Field(default=None, max_length=128)


def create_api_app(
    *,
    settings: ApiSettings | None = None,
    session_manager: SessionManager | None = None,
    video_analyzer: VideoAnalyzer | None = None,
    warmup_scheduler: Callable[[str], None] | None = None,
    video_job_scheduler: Callable[[str], None] | None = None,
) -> FastAPI:
    """Create the API without loading a model until a session/job is requested.

    ``session_manager`` and ``video_analyzer`` are explicit injection points for
    tests, hardware-specific runtimes, and the WebRTC adapter. Optional
    schedulers let serverless deployments run warmup/video work in dedicated
    calls while retaining the same in-process state owner. This keeps the REST
    layer free from singleton model state at import time.
    """

    effective_settings = settings or ApiSettings.from_environment()
    owns_session_manager = session_manager is None
    mode_configs = {mode: str(path) for mode, path in effective_settings.modes.items()}
    # Live uses staged warmup: construct weights first, warm YOLO/tracker, then
    # continue optional attribute warmup in the background. Upload analysis keeps
    # the legacy fully-warmed factory because it is synchronous by design.
    live_pipeline_factory = build_crowd_pipeline_factory(
        mode_configs,
        gender_model_path=effective_settings.gender_model_path,
        warmup=False,
        defer_attribute_models=True,
    )
    pipeline_factory = build_crowd_pipeline_factory(
        mode_configs,
        gender_model_path=effective_settings.gender_model_path,
        warmup=True,
        defer_attribute_models=False,
    )
    manager: SessionManager = session_manager or DemoSessionManager(
        live_pipeline_factory,
        allowed_modes=tuple(effective_settings.modes),
        max_sessions=effective_settings.max_live_sessions,
        ttl_seconds=effective_settings.session_ttl_seconds,
        cadence_seconds=effective_settings.live_cadence_seconds,
        profiling_window=effective_settings.profiling_window,
        readiness_probe=effective_settings.readiness,
    )
    analyzer: VideoAnalyzer = video_analyzer or ShortVideoAnalyzer(
        pipeline_factory,
        allowed_modes=tuple(effective_settings.modes),
        max_bytes=effective_settings.max_video_bytes,
        max_seconds=effective_settings.max_video_seconds,
        max_frames=effective_settings.max_video_frames,
    )
    video_artifacts = VideoArtifactStore()
    video_jobs = VideoJobManager(
        analyzer,
        video_artifacts,
        max_bytes=effective_settings.max_video_bytes,
        artifact_url_prefix=f"{API_PREFIX}/video/artifacts",
    )
    webrtc_peers = WebRTCPeerRegistry(manager)

    def prepare_live_gpu_owner() -> None:
        """Prevent live and upload workflows from retaining two model caches."""

        if video_jobs.is_busy():
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "video_analysis_busy",
                    "message": "Wait for the active video analysis job before starting Live Monitor.",
                },
            )
        close_video_cache = getattr(analyzer, "close", None)
        if callable(close_video_cache):
            close_video_cache()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        # The production one-camera manager owns a persistent warm slot.  Start
        # its staged warm-up as a daemon thread during app startup so the first
        # browser click can claim an already-prepared detector/tracker. Injected
        # managers (tests, notebooks, alternate deployments) keep explicit
        # lifecycle control and are never warmed implicitly.
        if owns_session_manager and effective_settings.warm_on_start:
            manager.start_warmup("classroom_demo")
        try:
            yield
        finally:
            # A tracker worker owns native/GPU resources.  Sessions are still
            # released by DELETE or TTL during normal use, but app shutdown
            # must clean up any remaining worker deterministically.
            # Close media transports before their associated model workers.
            # The registry also closes WebRTC-owned sessions; close_all then
            # releases any REST-only sessions that have no peer record.
            await webrtc_peers.close_all()
            manager.close_all()
            # Let an accepted upload finish before releasing its warm model or
            # short-lived artifact directory.
            video_jobs.close()
            close_analyzer = getattr(analyzer, "close", None)
            if callable(close_analyzer):
                close_analyzer()
            video_artifacts.close()

    app = FastAPI(
        title="Crowd Analytics Demo API",
        version="0.1.0",
        description=(
            "Small stateful API for demonstrating FastTracker, stream-scoped "
            "person IDs, visual presentation analytics, heatmap, and live telemetry."
        ),
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(effective_settings.frontend_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )
    app.state.api_settings = effective_settings
    app.state.session_manager = manager
    app.state.video_analyzer = analyzer
    app.state.video_artifacts = video_artifacts
    app.state.video_jobs = video_jobs
    app.state.webrtc_peers = webrtc_peers
    app.include_router(
        create_webrtc_router(
            manager,
            registry=webrtc_peers,
            metadata_payload_factory=lambda session_id: _session_stats_payload(manager, session_id),
            allowed_websocket_origins=effective_settings.frontend_origins,
            allow_detached_offer=not effective_settings.require_webrtc_lifecycle_socket,
            session_start_guard=prepare_live_gpu_owner,
            session_ttl_seconds=(
                int(effective_settings.session_ttl_seconds)
                if effective_settings.session_ttl_seconds > 0.0
                else None
            ),
        )
    )

    @app.exception_handler(SessionNotFoundError)
    async def session_not_found_handler(_request, exc: SessionNotFoundError) -> JSONResponse:
        return _error_response(404, "session_not_found", str(exc))

    @app.exception_handler(SessionCapacityError)
    async def session_capacity_handler(_request, exc: SessionCapacityError) -> JSONResponse:
        return _error_response(429, "live_session_capacity_reached", str(exc))

    @app.exception_handler(SessionWarmupInProgress)
    async def session_warmup_handler(_request, exc: SessionWarmupInProgress) -> JSONResponse:
        return _error_response(409, "session_warmup_in_progress", str(exc))

    @app.exception_handler(SessionInitializationError)
    async def session_initialization_handler(_request, exc: SessionInitializationError) -> JSONResponse:
        return _error_response(503, "pipeline_unavailable", str(exc))

    @app.exception_handler(UnsupportedSessionModeError)
    async def mode_handler(_request, exc: UnsupportedSessionModeError) -> JSONResponse:
        return _error_response(422, "unsupported_mode", str(exc))

    @app.exception_handler(ApiSessionError)
    async def session_error_handler(_request, exc: ApiSessionError) -> JSONResponse:
        return _error_response(409, "session_state_error", str(exc))

    @app.exception_handler(VideoTooLargeError)
    async def video_size_handler(_request, exc: VideoTooLargeError) -> JSONResponse:
        return _error_response(413, "video_too_large", str(exc))

    @app.exception_handler(VideoAnalysisBusyError)
    async def video_busy_handler(_request, exc: VideoAnalysisBusyError) -> JSONResponse:
        return _error_response(429, "video_analysis_busy", str(exc))

    @app.exception_handler(VideoTooLongError)
    async def video_length_handler(_request, exc: VideoTooLongError) -> JSONResponse:
        return _error_response(422, "video_too_long", str(exc))

    @app.exception_handler(UnsupportedVideoError)
    async def unsupported_video_handler(_request, exc: UnsupportedVideoError) -> JSONResponse:
        return _error_response(415, "unsupported_video", str(exc))

    @app.exception_handler(VideoAnalysisError)
    async def video_error_handler(_request, exc: VideoAnalysisError) -> JSONResponse:
        return _error_response(422, "video_analysis_failed", str(exc))

    @app.exception_handler(VideoJobNotFoundError)
    async def video_job_not_found_handler(_request, exc: VideoJobNotFoundError) -> JSONResponse:
        return _error_response(404, "video_job_not_found", str(exc))

    @app.get(f"{API_PREFIX}/health", response_model=HealthResponse, tags=["service"])
    def health() -> HealthResponse:
        """Liveness check: does not initialize a pipeline or a GPU model."""

        return HealthResponse.model_validate(_json_safe(
            {
                "status": "ok",
                "service": "crowd-analytics-demo-api",
                "sessions": manager.health(),
            }
        ))

    @app.get(f"{API_PREFIX}/ready", response_model=ReadyResponse, tags=["service"])
    def ready() -> JSONResponse:
        """Report whether the configured default profile can be created on demand."""

        details = _json_safe(manager.readiness())
        is_ready = bool(details.get("ready", False))
        return JSONResponse(
            status_code=200 if is_ready else 503,
            content={"status": "ready" if is_ready else "not_ready", "service": "crowd-analytics-demo-api", **details},
        )

    @app.post(
        f"{API_PREFIX}/warmup",
        response_model=WarmupStatusResponse,
        tags=["service"],
    )
    def start_model_warmup(request: CreateSessionRequest) -> WarmupStatusResponse:
        """Start idempotent background model preparation for a live mode."""

        prepare_live_gpu_owner()
        defer_warmup = warmup_scheduler is not None
        status = manager.start_warmup(request.mode, start_immediately=not defer_warmup)
        if warmup_scheduler is not None:
            warmup_scheduler(request.mode)
        return WarmupStatusResponse.model_validate(_json_safe(status))

    @app.get(
        f"{API_PREFIX}/warmup",
        response_model=WarmupStatusResponse,
        tags=["service"],
    )
    def get_model_warmup_status(mode: str = Query(default="default")) -> WarmupStatusResponse:
        """Return background model warmup progress without starting work."""

        status = manager.warmup_status(mode)
        return WarmupStatusResponse.model_validate(_json_safe(status))

    @app.post(
        f"{API_PREFIX}/sessions",
        response_model=SessionEnvelope,
        responses=SESSION_ERROR_RESPONSES,
        status_code=201,
        tags=["sessions"],
    )
    def create_session(request: CreateSessionRequest) -> SessionEnvelope:
        """Create the one persistent tracker/person-ID state for a media peer."""

        prepare_live_gpu_owner()
        session = manager.create_session(request.mode, request.camera_id)
        return SessionEnvelope.model_validate(_json_safe({"status": "created", "session": session.to_dict()}))

    @app.get(
        f"{API_PREFIX}/sessions/{{session_id}}",
        response_model=SessionEnvelope,
        responses={404: {"model": ErrorEnvelope}},
        tags=["sessions"],
    )
    def get_session(session_id: str) -> SessionEnvelope:
        return SessionEnvelope.model_validate(_json_safe({"status": "active", "session": manager.get(session_id).to_dict()}))

    @app.get(
        f"{API_PREFIX}/sessions/{{session_id}}/stats",
        response_model=SessionStatsResponse,
        responses={404: {"model": ErrorEnvelope}},
        tags=["sessions"],
    )
    def get_session_stats(session_id: str) -> SessionStatsResponse:
        """Return the latest analytics envelope for control/debug clients."""

        return SessionStatsResponse.model_validate(_session_stats_payload(manager, session_id))

    @app.websocket(f"{API_PREFIX}/sessions/{{session_id}}/metadata")
    async def session_metadata_socket(websocket: WebSocket, session_id: str) -> None:
        """Push compact latest-result metadata without polling HTTP.

        The WebRTC media peer owns the inbound camera frames.  This channel is
        deliberately metadata-only: it sends an analytics/result envelope only when the
        capacity-one live processor publishes a newer sequence, so a slow
        detector cannot create a stale outbound queue.
        """

        try:
            manager.get(session_id)
        except SessionNotFoundError:
            await websocket.close(code=4404, reason="Session not found")
            return

        await websocket.accept()
        last_sequence: int | None = None
        try:
            while True:
                state = manager.get_state(session_id)
                result = state.result
                sequence = result.sequence if result is not None else None
                if isinstance(sequence, int) and sequence != last_sequence:
                    payload = _session_stats_payload_from_state(state)
                    await websocket.send_json(payload)
                    last_sequence = sequence
                # This is an in-process wake-up cadence, not a network poll.
                # Results are still sent only when sequence changes.
                await asyncio.sleep(0.05)
        except WebSocketDisconnect:
            return
        except SessionNotFoundError:
            # The browser may have closed the socket while the session was
            # being released by the WebRTC peer callback. Closing an already
            # disconnected socket must not become an ASGI worker traceback.
            try:
                await websocket.close(code=4404, reason="Session expired")
            except WebSocketDisconnect:
                return
        except Exception:
            # A browser/tab disconnect commonly surfaces as a transport-level
            # exception.  Do not turn it into an ASGI worker error.
            try:
                await websocket.close(code=1011, reason="Metadata stream stopped")
            except Exception:
                pass

    @app.patch(
        f"{API_PREFIX}/sessions/{{session_id}}/layout",
        response_model=SessionConfigurationResponse,
        responses={404: {"model": ErrorEnvelope}, 409: {"model": ErrorEnvelope}, 422: {"model": ErrorEnvelope}},
        tags=["sessions"],
    )
    def update_session_layout(session_id: str, request: SessionLayoutRequest) -> SessionConfigurationResponse:
        """Update rows/disabled seats for one running classroom session."""

        session = manager.get(session_id)
        processor = manager.get_processor(session_id)
        try:
            classroom = processor.apply_session_layout(request.session_layout)
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail={"code": "classroom_not_configured", "message": str(exc)}) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail={"code": "invalid_session_layout", "message": str(exc)}) from exc
        return SessionConfigurationResponse.model_validate(
            _json_safe({"status": "updated", "session": session.to_dict(), "classroom": classroom})
        )

    @app.patch(
        f"{API_PREFIX}/sessions/{{session_id}}/calibration",
        response_model=SessionConfigurationResponse,
        responses={404: {"model": ErrorEnvelope}, 409: {"model": ErrorEnvelope}, 422: {"model": ErrorEnvelope}},
        tags=["sessions"],
    )
    def update_session_calibration(session_id: str, request: SessionCalibrationRequest) -> SessionConfigurationResponse:
        """Persist four-or-more floor correspondences for one running session."""

        session = manager.get(session_id)
        processor = manager.get_processor(session_id)
        try:
            classroom = processor.apply_room_calibration(request.calibration)
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail={"code": "classroom_not_configured", "message": str(exc)}) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail={"code": "invalid_calibration", "message": str(exc)}) from exc
        return SessionConfigurationResponse.model_validate(
            _json_safe({"status": "updated", "session": session.to_dict(), "classroom": classroom})
        )

    @app.post(
        f"{API_PREFIX}/sessions/{{session_id}}/reset",
        response_model=SessionEnvelope,
        responses={404: {"model": ErrorEnvelope}, 409: {"model": ErrorEnvelope}},
        tags=["sessions"],
    )
    def reset_session(session_id: str) -> SessionEnvelope:
        """Reset FastTracker, stream person IDs, counters, and heatmap together."""

        session = manager.reset(session_id)
        return SessionEnvelope.model_validate(_json_safe({"status": "reset", "session": session.to_dict()}))

    @app.delete(
        f"{API_PREFIX}/sessions/{{session_id}}",
        responses={404: {"model": ErrorEnvelope}},
        status_code=204,
        tags=["sessions"],
    )
    async def delete_session(session_id: str) -> Response:
        peer_closed = await webrtc_peers.close_peer(session_id)
        try:
            manager.close(session_id)
        except SessionNotFoundError:
            # Closing an aiortc peer emits ``connectionstatechange``. Its
            # callback can release the same tracker before this endpoint gets
            # to manager.close(), so treat that already-completed cleanup as
            # idempotent while preserving 404 for truly unknown sessions.
            if not peer_closed:
                raise
        return Response(status_code=204)

    @app.post(
        f"{API_PREFIX}/sessions/{{session_id}}/frame",
        response_model=FrameResponse,
        responses={400: {"model": ErrorEnvelope}, 404: {"model": ErrorEnvelope}, 409: {"model": ErrorEnvelope}, 415: {"model": ErrorEnvelope}},
        tags=["sessions"],
    )
    async def submit_session_frame(
        session_id: str,
        file: UploadFile = File(..., description="JPEG/PNG frame captured by the browser camera."),
        after_sequence: int | None = Query(
            default=None,
            ge=0,
            description="Only include an annotated image when a newer result exists.",
        ),
    ) -> FrameResponse:
        """Accept one browser frame and return the newest completed annotation.

        The model worker remains asynchronous and latest-frame-only.  The
        response can therefore contain the previous completed result while the
        submitted frame is being processed; the next request receives the
        newer annotation without building a stale request queue.
        """

        payload = await file.read()
        if not payload:
            raise HTTPException(status_code=400, detail="The uploaded frame is empty.")
        frame = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR)
        if frame is None or frame.ndim != 3:
            raise HTTPException(status_code=415, detail="The uploaded frame is not a supported image.")

        sequence = manager.submit_frame(session_id, frame, submitted_at=monotonic())
        result = manager.latest_result(session_id)
        has_new_result = result is not None and (
            after_sequence is None or result.sequence > after_sequence
        )
        analytics_payload = None
        overlay_payload = None
        if has_new_result and result is not None and isinstance(result.stats, dict):
            # Keep overlay as a separate compact channel so it is not duplicated
            # inside the dashboard analytics envelope.
            analytics_payload = dict(result.stats)
            overlay_payload = analytics_payload.pop("overlay", None)
        response: dict[str, Any] = {
            "status": "accepted",
            "sequence": sequence,
            "result_sequence": result.sequence if result is not None else None,
            # The browser keeps the camera's raw <video> local and draws this
            # lightweight metadata on a transparent canvas.  Do not send the
            # full annotated JPEG back through the tunnel.
            "analytics": analytics_payload,
            "overlay": overlay_payload,
        }
        return FrameResponse.model_validate(_json_safe(response))

    @app.post(
        f"{API_PREFIX}/video/analyze",
        response_model=VideoJobAcceptedResponse,
        responses={413: {"model": ErrorEnvelope}, 415: {"model": ErrorEnvelope}, 422: {"model": ErrorEnvelope}, 429: {"model": ErrorEnvelope}},
        status_code=202,
        tags=["video"],
    )
    def analyze_short_video(
        file: UploadFile = File(..., description="Short video clip; default demo limit is 60 seconds / 64 MiB."),
        mode: str = Form("default"),
        job_id: str | None = Form(default=None, description="Optional client-generated idempotency token."),
    ) -> VideoJobAcceptedResponse:
        """Accept a clip, then run inference independently of this request."""

        # A clip uses a reset tracker/analytics state with warm model weights.
        # The demo intentionally has one GPU/session budget, so do not compete
        # with an active WebRTC or REST live stream. The explicit guard keeps
        # that ownership rule intact even though lightweight ASGI inputs are
        # concurrent on Modal.
        active_sessions = int(manager.health().get("active_sessions", 0))
        if active_sessions:
            raise VideoAnalysisBusyError(
                "Close the active live session before running short-video analysis in the one-GPU demo."
            )
        # A stopped live session leaves one warm pipeline cached for fast
        # restart. Release it before loading the separate video-analysis cache,
        # otherwise one T4 can retain two complete model stacks.
        manager.release_warm_pipelines()
        job_id = video_jobs.submit(
            file.file,
            filename=file.filename,
            content_type=file.content_type,
            mode=mode,
            job_id=job_id,
            start_immediately=video_job_scheduler is None,
        )
        if video_job_scheduler is not None:
            video_job_scheduler(job_id)
        status_url = f"{API_PREFIX}/video/jobs/{job_id}"
        return VideoJobAcceptedResponse(
            status="queued",
            job_id=job_id,
            status_url=status_url,
            poll_after_ms=1_000,
        )

    @app.get(
        f"{API_PREFIX}/video/jobs/{{job_id}}",
        response_model=VideoJobStatusResponse,
        responses={404: {"model": ErrorEnvelope}},
        tags=["video"],
    )
    def get_video_job(job_id: str) -> VideoJobStatusResponse:
        """Return a small status snapshot; polling never reruns inference."""

        return VideoJobStatusResponse.model_validate(_json_safe(video_jobs.get(job_id)))

    @app.get(
        f"{API_PREFIX}/video/artifacts/{{artifact_id}}",
        responses={404: {"model": ErrorEnvelope}},
        tags=["video"],
    )
    def get_annotated_video(artifact_id: str) -> FileResponse:
        """Stream one short-lived, browser-compatible annotated MP4."""

        try:
            artifact_path = video_artifacts.get(artifact_id)
        except VideoArtifactNotFoundError as error:
            raise HTTPException(
                status_code=404,
                detail={"code": "annotated_video_not_found", "message": str(error)},
            ) from error
        return FileResponse(
            artifact_path,
            media_type="video/mp4",
            headers={
                "Cache-Control": "private, max-age=900",
                "Content-Disposition": f'inline; filename="annotated-{artifact_id}.mp4"',
            },
        )

    return app


def _session_stats_payload(manager: SessionManager, session_id: str) -> dict[str, Any]:
    """Build the shared REST/WebSocket latest-result envelope."""

    return _session_stats_payload_from_state(manager.get_state(session_id))


def _session_stats_payload_from_state(state: Any) -> dict[str, Any]:
    """Serialize a previously-read state without repeating manager locking."""

    result = state.result
    payload: dict[str, Any] = {
        "status": "ready" if result is not None else "waiting_for_frame",
        "session": state.info.to_dict(),
        "frame": (
            {
                "sequence": result.sequence,
                "submitted_monotonic_seconds": result.submitted_at,
                "completed_monotonic_seconds": result.completed_at,
            }
            if result is not None
            else None
        ),
        # This envelope contains model measurements (tracking, identity,
        # attributes, spatial/heatmap, classroom, and runtime), but never a
        # JPEG or annotated video frame. The browser uses the overlay portion
        # for Canvas and forwards the analytics sections to its dashboards.
        "analytics": result.stats if result is not None else None,
        "live_stream": state.telemetry,
    }
    return _json_safe(payload)


def _error_response(status_code: int, code: str, message: str) -> JSONResponse:
    payload = ErrorEnvelope(detail={"code": code, "message": message})
    return JSONResponse(status_code=status_code, content=payload.model_dump())


def _json_safe(value: Any) -> Any:
    """Normalize numpy/OpenCV analytics values before JSON serialization."""

    if isinstance(value, np.ndarray):
        return [_json_safe(item) for item in value.tolist()]
    if isinstance(value, np.generic):
        return _json_safe(value.item())
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (str, int, bool)) or value is None:
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (tuple, list, set, frozenset)):
        return [_json_safe(item) for item in value]
    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        return _json_safe(to_dict())
    return str(value)
