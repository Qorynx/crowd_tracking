"""Session ownership for the stateful live FastAPI demo.

Every live session owns exactly one ``CrowdGenderPipeline`` and one
``LiveFrameProcessor``.  Keeping that boundary explicit prevents a FastTracker
or stream-scoped ``person_id`` from leaking across cameras or browser peers.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from threading import RLock, Thread
from time import monotonic
from typing import Any, Callable, Protocol
from uuid import uuid4

import numpy as np

from src.inference.live_stream import LiveFrameProcessor, LiveFrameResult, LivePipeline


class ApiSessionError(RuntimeError):
    """Base error translated to a compact HTTP response by the API layer."""


class SessionNotFoundError(ApiSessionError):
    pass


class SessionCapacityError(ApiSessionError):
    pass


class UnsupportedSessionModeError(ApiSessionError):
    pass


class SessionInitializationError(ApiSessionError):
    """The requested model/profile could not be prepared for a new session."""


class SessionWarmupInProgress(ApiSessionError):
    """A live pipeline is still being prepared in the background."""


class SessionClosedError(ApiSessionError):
    pass


PipelineFactory = Callable[[str], LivePipeline]
ReadinessProbe = Callable[[], dict[str, Any]]


@dataclass(frozen=True)
class SessionInfo:
    """JSON-safe public metadata; no model, image, or tracker object escapes."""

    session_id: str
    mode: str
    camera_id: str | None
    created_at: str
    last_used_at: str
    expires_in_seconds: float | None
    status: str = "active"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.session_id,
            "mode": self.mode,
            "camera_id": self.camera_id,
            "created_at": self.created_at,
            "last_used_at": self.last_used_at,
            "expires_in_seconds": self.expires_in_seconds,
            "status": self.status,
        }


@dataclass(frozen=True)
class SessionState:
    """A point-in-time dashboard view of a session and its newest result."""

    info: SessionInfo
    result: LiveFrameResult | None
    telemetry: dict[str, Any]


@dataclass
class _SessionEntry:
    session_id: str
    mode: str
    camera_id: str | None
    processor: LiveFrameProcessor
    created_at: datetime
    last_used_at: datetime
    created_monotonic: float
    last_used_monotonic: float


@dataclass
class _WarmupEntry:
    mode: str
    status: str = "idle"
    progress: float = 0.0
    stage: str = "idle"
    message: str = "Model chưa được warm up."
    error: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    started_monotonic: float | None = None
    completed_monotonic: float | None = None
    pipeline: LivePipeline | None = None
    thread: Thread | None = None
    running: bool = False
    detector_ready: bool = False
    tracker_ready: bool = False
    attributes_ready: bool = False


class SessionManager(Protocol):
    """Minimal manager contract shared by HTTP and WebRTC adapters."""

    def create_session(self, mode: str = "default", camera_id: str | None = None) -> SessionInfo: ...

    def get(self, session_id: str) -> SessionInfo: ...

    def get_processor(self, session_id: str) -> LiveFrameProcessor: ...

    def submit_frame(
        self,
        session_id: str,
        frame: np.ndarray,
        *,
        submitted_at: float | None = None,
    ) -> int: ...

    def latest_result(self, session_id: str) -> LiveFrameResult | None: ...

    def get_state(self, session_id: str) -> SessionState: ...

    def reset(self, session_id: str) -> SessionInfo: ...

    def close(self, session_id: str) -> None: ...

    def health(self) -> dict[str, Any]: ...

    def readiness(self) -> dict[str, Any]: ...

    def close_all(self) -> None: ...

    def start_warmup(
        self,
        mode: str = "default",
        *,
        start_immediately: bool = True,
    ) -> dict[str, Any]: ...

    def run_warmup(self, mode: str = "default") -> None: ...

    def warmup_status(self, mode: str = "default") -> dict[str, Any]: ...

    def release_warm_pipelines(self) -> None: ...


class DemoSessionManager:
    """Capacity-bounded owner of live pipeline workers.

    The factory is injected so tests never instantiate GPU models.  The default
    app uses a factory that calls ``warmup`` only when a session is explicitly
    created, not at ASGI import time.
    """

    def __init__(
        self,
        pipeline_factory: PipelineFactory,
        *,
        allowed_modes: tuple[str, ...] = ("default", "classroom_demo"),
        max_sessions: int = 1,
        ttl_seconds: float = 600.0,
        cadence_seconds: float = 0.15,
        profiling_window: int = 120,
        readiness_probe: ReadinessProbe | None = None,
        clock: Callable[[], float] = monotonic,
        wall_clock: Callable[[], datetime] | None = None,
    ) -> None:
        if max_sessions < 1:
            raise ValueError("max_sessions must be positive.")
        if ttl_seconds < 0.0:
            raise ValueError("ttl_seconds must be non-negative.")
        if cadence_seconds <= 0.0:
            raise ValueError("cadence_seconds must be positive.")
        if profiling_window < 1:
            raise ValueError("profiling_window must be positive.")
        if not allowed_modes:
            raise ValueError("allowed_modes cannot be empty.")
        self._pipeline_factory = pipeline_factory
        self._allowed_modes = frozenset(allowed_modes)
        self._max_sessions = int(max_sessions)
        self._ttl_seconds = float(ttl_seconds)
        self._cadence_seconds = float(cadence_seconds)
        self._profiling_window = int(profiling_window)
        self._readiness_probe = readiness_probe
        self._clock = clock
        self._wall_clock = wall_clock or (lambda: datetime.now(UTC))
        self._lock = RLock()
        self._entries: dict[str, _SessionEntry] = {}
        self._last_creation_error: str | None = None
        self._warmups: dict[str, _WarmupEntry] = {}
        self._creation_in_progress = False

    @property
    def allowed_modes(self) -> tuple[str, ...]:
        return tuple(sorted(self._allowed_modes))

    def create_session(self, mode: str = "default", camera_id: str | None = None) -> SessionInfo:
        normalized_mode = self._normalize_mode(mode)
        normalized_camera_id = self._normalize_camera_id(camera_id)
        with self._lock:
            self._evict_expired_locked(self._clock())
            if len(self._entries) >= self._max_sessions:
                raise SessionCapacityError(
                    f"Live demo capacity is {self._max_sessions} session(s); close the existing session first."
                )
            warmup_entry = self._warmups.get(normalized_mode)
            pipeline = None
            if (
                warmup_entry is not None
                and warmup_entry.status in {"tracking_ready", "ready"}
                and warmup_entry.pipeline is not None
            ):
                pipeline = warmup_entry.pipeline
                warmup_entry.status = "in_use"
                warmup_entry.stage = "session_starting"
                warmup_entry.message = "Model đã sẵn sàng; đang tạo phiên live."
            elif warmup_entry is not None and warmup_entry.status == "warming":
                raise SessionWarmupInProgress(
                    "Model warmup is still running. Wait for the warmup status to become ready before creating a session."
                )
            if pipeline is None:
                if self._creation_in_progress:
                    raise SessionWarmupInProgress("Another model/session initialization is already running.")
                self._creation_in_progress = True
            try:
                if pipeline is None:
                    pipeline = self._pipeline_factory(normalized_mode)
                processor = LiveFrameProcessor(
                    pipeline,
                    cadence_seconds=self._cadence_seconds,
                    profiling_window=self._profiling_window,
                )
            except Exception as exc:
                if pipeline is not None and warmup_entry is not None and warmup_entry.status == "in_use":
                    warmup_entry.pipeline = pipeline
                    warmup_entry.status = "ready" if warmup_entry.attributes_ready else "tracking_ready"
                    warmup_entry.stage = warmup_entry.status
                self._last_creation_error = f"{type(exc).__name__}: {exc}"
                raise SessionInitializationError(
                    "The selected pipeline could not be initialized. Check /api/v1/ready and server logs."
                ) from exc
            finally:
                self._creation_in_progress = False
            now_monotonic = self._clock()
            now_wall = self._wall_clock()
            entry = _SessionEntry(
                session_id=f"demo_{uuid4().hex[:12]}",
                mode=normalized_mode,
                camera_id=normalized_camera_id,
                processor=processor,
                created_at=now_wall,
                last_used_at=now_wall,
                created_monotonic=now_monotonic,
                last_used_monotonic=now_monotonic,
            )
            self._entries[entry.session_id] = entry
            self._last_creation_error = None
            return self._snapshot_locked(entry, now_monotonic)

    def start_warmup(
        self,
        mode: str = "default",
        *,
        start_immediately: bool = True,
    ) -> dict[str, Any]:
        """Prepare an idempotent warmup and optionally start its local thread."""

        normalized_mode = self._normalize_mode(mode)
        thread: Thread | None = None
        with self._lock:
            self._evict_expired_locked(self._clock())
            entry = self._warmups.setdefault(normalized_mode, _WarmupEntry(mode=normalized_mode))
            if self._entries:
                if entry.status == "in_use" and entry.pipeline is not None:
                    return self._warmup_snapshot_locked(entry)
                entry.status = "blocked"
                entry.progress = 100.0
                entry.stage = "session_active"
                entry.message = "Đang có một session live hoạt động; hãy dừng session đó trước."
                return self._warmup_snapshot_locked(entry)
            if entry.status in {"tracking_ready", "ready"} and entry.pipeline is not None:
                return self._warmup_snapshot_locked(entry)
            if entry.status == "warming":
                return self._warmup_snapshot_locked(entry)
            if self._creation_in_progress:
                entry.status = "blocked"
                entry.progress = 0.0
                entry.stage = "session_starting"
                entry.message = "Một phiên khác đang được khởi tạo."
                return self._warmup_snapshot_locked(entry)

            now = self._clock()
            wall_now = self._wall_clock()
            entry.status = "warming"
            entry.progress = 8.0
            entry.stage = "loading_model"
            entry.message = "Đang tải model và khởi tạo runtime CUDA…"
            entry.error = None
            entry.detector_ready = False
            entry.tracker_ready = False
            entry.attributes_ready = False
            entry.started_monotonic = now
            entry.completed_monotonic = None
            entry.started_at = wall_now.isoformat()
            entry.completed_at = None
            entry.running = False
            if start_immediately:
                thread = Thread(
                    target=self.run_warmup,
                    args=(normalized_mode,),
                    name=f"crowd-warmup-{normalized_mode}",
                    daemon=True,
                )
                entry.thread = thread
            else:
                entry.thread = None
            snapshot = self._warmup_snapshot_locked(entry)
        if thread is not None:
            thread.start()
        return snapshot

    def run_warmup(self, mode: str = "default") -> None:
        """Run one prepared warmup exactly once in the caller's lifetime."""

        normalized_mode = self._normalize_mode(mode)
        with self._lock:
            entry = self._warmups.get(normalized_mode)
            if entry is None or entry.status != "warming" or entry.running:
                return
            entry.running = True
        try:
            self._run_warmup(normalized_mode)
        finally:
            with self._lock:
                entry = self._warmups.get(normalized_mode)
                if entry is not None:
                    entry.running = False

    def warmup_status(self, mode: str = "default") -> dict[str, Any]:
        """Return the current progress for one mode without starting work."""

        normalized_mode = self._normalize_mode(mode)
        with self._lock:
            entry = self._warmups.get(normalized_mode)
            if entry is None:
                entry = _WarmupEntry(mode=normalized_mode)
            return self._warmup_snapshot_locked(entry)

    def release_warm_pipelines(self) -> None:
        """Release idle live-model caches before another GPU workflow starts."""

        with self._lock:
            if self._entries or self._creation_in_progress:
                raise SessionCapacityError("A live session currently owns the GPU pipeline.")
            if any(entry.running or entry.status == "warming" for entry in self._warmups.values()):
                raise SessionWarmupInProgress("Live model warmup is still using the GPU pipeline.")
            pipelines = [entry.pipeline for entry in self._warmups.values() if entry.pipeline is not None]
            for entry in self._warmups.values():
                entry.pipeline = None
                entry.status = "idle"
                entry.progress = 0.0
                entry.stage = "idle"
                entry.message = "Model chưa được warm up."
                entry.error = None
                entry.detector_ready = False
                entry.tracker_ready = False
                entry.attributes_ready = False
                entry.thread = None
                entry.started_monotonic = None
                entry.started_at = None
                entry.completed_monotonic = None
                entry.completed_at = None
        for pipeline in pipelines:
            self._close_pipeline(pipeline)

    def _run_warmup(self, mode: str) -> None:
        pipeline: LivePipeline | None = None
        staged = False
        try:
            with self._lock:
                entry = self._warmups[mode]
                entry.progress = 35.0
                entry.stage = "warming_model"
                entry.message = "Đang warm up detector, tracker và classifier; tiến trình có thể đứng ở bước này vài giây…"
            pipeline = self._pipeline_factory(mode)
            tracking_warmup = getattr(pipeline, "warmup_tracking", None)
            staged = callable(tracking_warmup)
            if staged:
                tracking_warmup()
            else:
                # Compatibility path for injected/legacy pipelines that only
                # expose the original all-in-one warmup method.
                pipeline.warmup()
            with self._lock:
                entry = self._warmups[mode]
                entry.pipeline = pipeline
                entry.detector_ready = bool(getattr(pipeline, "detector_ready", True))
                entry.tracker_ready = bool(getattr(pipeline, "tracker_ready", True))
                entry.attributes_ready = bool(getattr(pipeline, "attributes_ready", not staged))
                entry.status = "tracking_ready" if staged and not entry.attributes_ready else "ready"
                entry.progress = 68.0 if entry.status == "tracking_ready" else 100.0
                entry.stage = "tracking_ready" if entry.status == "tracking_ready" else "ready"
                entry.message = (
                    "Detector và tracker đã sẵn sàng; attributes đang warm up nền."
                    if entry.status == "tracking_ready"
                    else "Model đã warm up xong và sẵn sàng cho camera."
                )
                entry.error = None
                if entry.status == "ready":
                    entry.completed_monotonic = self._clock()
                    entry.completed_at = self._wall_clock().isoformat()
                else:
                    entry.completed_monotonic = None
                    entry.completed_at = None
            if staged and not bool(getattr(pipeline, "attributes_ready", False)):
                with self._lock:
                    entry = self._warmups[mode]
                    entry.progress = 72.0
                    entry.stage = "attributes_loading"
                    entry.message = "Đang warm up face detector, face classifier và body classifier ở background…"
                attributes_warmup = getattr(pipeline, "warmup_attributes", None)
                if callable(attributes_warmup):
                    attributes_warmup()
                with self._lock:
                    entry = self._warmups[mode]
                    entry.detector_ready = bool(getattr(pipeline, "detector_ready", entry.detector_ready))
                    entry.tracker_ready = bool(getattr(pipeline, "tracker_ready", entry.tracker_ready))
                    entry.attributes_ready = bool(getattr(pipeline, "attributes_ready", True))
                    if entry.status != "in_use":
                        entry.status = "ready"
                    entry.progress = 100.0
                    entry.stage = "ready" if entry.status == "ready" else "in_use"
                    entry.message = "Attributes đã warm up xong." if entry.status == "ready" else "Live session đang sử dụng pipeline."
                    entry.completed_monotonic = self._clock()
                    entry.completed_at = self._wall_clock().isoformat()
        except Exception as exc:
            with self._lock:
                entry = self._warmups.setdefault(mode, _WarmupEntry(mode=mode))
                session_owns_pipeline = entry.status == "in_use" or bool(self._entries)
                pipeline_tracker_ready = bool(getattr(pipeline, "tracker_ready", False)) if pipeline is not None else False
            # An attribute-stage failure must not throw away a usable
            # detector/tracker. Keep that pipeline available so the live demo
            # can still show boxes/counts and report attributes as degraded.
            tracking_usable = staged and pipeline_tracker_ready
            keep_pipeline = session_owns_pipeline or tracking_usable
            if pipeline is not None and not keep_pipeline:
                self._close_pipeline(pipeline)
            with self._lock:
                entry = self._warmups.setdefault(mode, _WarmupEntry(mode=mode))
                if not keep_pipeline and entry.pipeline is pipeline:
                    entry.pipeline = None
                entry.status = (
                    "in_use"
                    if session_owns_pipeline
                    else "tracking_ready"
                    if tracking_usable
                    else "failed"
                )
                entry.progress = 68.0 if tracking_usable and not session_owns_pipeline else 100.0
                entry.stage = "attributes_failed" if tracking_usable else "failed"
                entry.message = (
                    "Attributes warmup thất bại; tracking vẫn được giữ hoạt động."
                    if tracking_usable
                    else "Không thể warm up model."
                )
                entry.error = f"{type(exc).__name__}: {exc}"
                entry.detector_ready = bool(getattr(pipeline, "detector_ready", entry.detector_ready)) if pipeline is not None else entry.detector_ready
                entry.tracker_ready = bool(getattr(pipeline, "tracker_ready", entry.tracker_ready)) if pipeline is not None else entry.tracker_ready
                if tracking_usable:
                    entry.completed_monotonic = None
                    entry.completed_at = None
                else:
                    entry.completed_monotonic = self._clock()
                    entry.completed_at = self._wall_clock().isoformat()

    def _warmup_snapshot_locked(self, entry: _WarmupEntry) -> dict[str, Any]:
        now = self._clock()
        elapsed = None
        if entry.started_monotonic is not None:
            end = entry.completed_monotonic if entry.completed_monotonic is not None else now
            elapsed = round(max(0.0, end - entry.started_monotonic), 2)
        return {
            "mode": entry.mode,
            "status": entry.status,
            "progress": round(float(entry.progress), 1),
            "stage": entry.stage,
            "message": entry.message,
            "error": entry.error,
            "started_at": entry.started_at,
            "completed_at": entry.completed_at,
            "elapsed_seconds": elapsed,
            "cached": entry.pipeline is not None,
            "active_sessions": len(self._entries),
            "detector_ready": entry.detector_ready,
            "tracker_ready": entry.tracker_ready,
            "attributes_ready": entry.attributes_ready,
        }

    @staticmethod
    def _close_pipeline(pipeline: LivePipeline) -> None:
        close = getattr(pipeline, "close", None)
        if callable(close):
            close()
        else:
            pipeline.reset()

    def get(self, session_id: str) -> SessionInfo:
        with self._lock:
            entry, now = self._entry_locked(session_id)
            self._touch_locked(entry, now)
            return self._snapshot_locked(entry, now)

    def get_processor(self, session_id: str) -> LiveFrameProcessor:
        with self._lock:
            entry, now = self._entry_locked(session_id)
            self._touch_locked(entry, now)
            return entry.processor

    def submit_frame(
        self,
        session_id: str,
        frame: np.ndarray,
        *,
        submitted_at: float | None = None,
    ) -> int:
        processor = self.get_processor(session_id)
        sequence = processor.submit(frame, submitted_at=submitted_at)
        if sequence is None:
            raise SessionClosedError("The live session was closed while a frame was being submitted.")
        return sequence

    def latest_result(self, session_id: str) -> LiveFrameResult | None:
        processor = self.get_processor(session_id)
        return processor.latest_result()

    def get_state(self, session_id: str) -> SessionState:
        with self._lock:
            entry, now = self._entry_locked(session_id)
            self._touch_locked(entry, now)
            info = self._snapshot_locked(entry, now)
            processor = entry.processor
        return SessionState(info=info, result=processor.latest_result(), telemetry=processor.telemetry())

    def reset(self, session_id: str) -> SessionInfo:
        processor = self.get_processor(session_id)
        processor.reset()
        with self._lock:
            entry, now = self._entry_locked(session_id)
            self._touch_locked(entry, now)
            return self._snapshot_locked(entry, now)

    def close(self, session_id: str) -> None:
        with self._lock:
            self._evict_expired_locked(self._clock())
            entry = self._entries.pop(session_id, None)
        if entry is None:
            raise SessionNotFoundError(f"Unknown or expired session: {session_id}")
        entry.processor.close()
        with self._lock:
            warmup = self._warmups.setdefault(entry.mode, _WarmupEntry(mode=entry.mode))
            warmup.pipeline = entry.processor.pipeline
            warmup.status = "ready" if warmup.attributes_ready else "tracking_ready"
            warmup.progress = 100.0
            warmup.stage = "ready" if warmup.attributes_ready else "tracking_ready"
            warmup.message = "Model đã sẵn sàng; pipeline được giữ nóng cho lần chạy tiếp theo."
            warmup.error = None
            warmup.completed_monotonic = self._clock()
            warmup.completed_at = self._wall_clock().isoformat()

    def close_all(self) -> None:
        with self._lock:
            entries = tuple(self._entries.values())
            self._entries.clear()
            warmup_threads = tuple(
                entry.thread
                for entry in self._warmups.values()
                if entry.thread is not None and entry.thread.is_alive()
            )
        # Shutdown should not tear down a CUDA module while its staged
        # attribute warm-up is still executing.  These threads are daemonized
        # for crash resilience, but a normal app shutdown waits for them.
        for thread in warmup_threads:
            thread.join()
        # Read the cache only after the joins: a warm-up thread can publish its
        # pipeline between the first snapshot and completion of the join.
        with self._lock:
            cached = tuple(
                entry.pipeline
                for entry in self._warmups.values()
                if entry.pipeline is not None
            )
            for entry in self._warmups.values():
                entry.pipeline = None
        for entry in entries:
            entry.processor.close()
        active_pipeline_ids = {id(entry.processor.pipeline) for entry in entries}
        for pipeline in cached:
            if id(pipeline) not in active_pipeline_ids:
                self._close_pipeline(pipeline)

    def health(self) -> dict[str, Any]:
        with self._lock:
            self._evict_expired_locked(self._clock())
            return {
                "active_sessions": len(self._entries),
                "max_live_sessions": self._max_sessions,
                "allowed_modes": self.allowed_modes,
                "session_ttl_seconds": self._ttl_seconds if self._ttl_seconds > 0.0 else None,
                "last_session_creation_error": self._last_creation_error,
            }

    def readiness(self) -> dict[str, Any]:
        details = dict(self._readiness_probe() if self._readiness_probe is not None else {"ready": True})
        details["ready"] = bool(details.get("ready", True)) and self._last_creation_error is None
        details["active_sessions"] = self.health()["active_sessions"]
        details["max_live_sessions"] = self._max_sessions
        if self._last_creation_error is not None:
            details["last_session_creation_error"] = self._last_creation_error
        return details

    def _entry_locked(self, session_id: str) -> tuple[_SessionEntry, float]:
        now = self._clock()
        self._evict_expired_locked(now)
        entry = self._entries.get(session_id)
        if entry is None:
            raise SessionNotFoundError(f"Unknown or expired session: {session_id}")
        return entry, now

    def _evict_expired_locked(self, now: float) -> None:
        if self._ttl_seconds <= 0.0:
            return
        expired_ids = [
            session_id
            for session_id, entry in self._entries.items()
            if now - entry.last_used_monotonic >= self._ttl_seconds
        ]
        for session_id in expired_ids:
            entry = self._entries.pop(session_id)
            # This waits for an in-flight inference before model teardown.  It
            # is intentionally serialized with session creation because the
            # demo has a single GPU/session capacity.
            entry.processor.close()
            warmup = self._warmups.setdefault(entry.mode, _WarmupEntry(mode=entry.mode))
            warmup.pipeline = entry.processor.pipeline
            warmup.status = "ready" if warmup.attributes_ready else "tracking_ready"
            warmup.progress = 100.0
            warmup.stage = "ready" if warmup.attributes_ready else "tracking_ready"
            warmup.message = "Model đã sẵn sàng; pipeline được giữ nóng cho lần chạy tiếp theo."
            warmup.error = None
            warmup.completed_monotonic = self._clock()
            warmup.completed_at = self._wall_clock().isoformat()

    def _touch_locked(self, entry: _SessionEntry, now_monotonic: float) -> None:
        entry.last_used_monotonic = now_monotonic
        entry.last_used_at = self._wall_clock()

    def _snapshot_locked(self, entry: _SessionEntry, now: float) -> SessionInfo:
        expires = None
        if self._ttl_seconds > 0.0:
            expires = max(0.0, self._ttl_seconds - (now - entry.last_used_monotonic))
        return SessionInfo(
            session_id=entry.session_id,
            mode=entry.mode,
            camera_id=entry.camera_id,
            created_at=entry.created_at.isoformat(),
            last_used_at=entry.last_used_at.isoformat(),
            expires_in_seconds=round(expires, 2) if expires is not None else None,
        )

    def _normalize_mode(self, mode: str) -> str:
        normalized = str(mode).strip().lower()
        if normalized not in self._allowed_modes:
            allowed = ", ".join(sorted(self._allowed_modes))
            raise UnsupportedSessionModeError(f"Unsupported mode {mode!r}. Allowed modes: {allowed}.")
        return normalized

    @staticmethod
    def _normalize_camera_id(camera_id: str | None) -> str | None:
        if camera_id is None:
            return None
        normalized = str(camera_id).strip()
        if not normalized:
            return None
        if len(normalized) > 128:
            raise ValueError("camera_id must contain at most 128 characters.")
        return normalized


def build_crowd_pipeline_factory(
    mode_configs: dict[str, str],
    *,
    gender_model_path: str | None = None,
    warmup: bool = True,
    defer_attribute_models: bool = False,
) -> PipelineFactory:
    """Create a lazy production factory without constructing a model yet."""

    normalized_configs = {str(mode).strip().lower(): str(path) for mode, path in mode_configs.items()}

    def factory(mode: str) -> LivePipeline:
        normalized_mode = str(mode).strip().lower()
        try:
            config_path = normalized_configs[normalized_mode]
        except KeyError as error:
            raise UnsupportedSessionModeError(f"No pipeline config is registered for mode {mode!r}.") from error
        # Keep this import and construction inside the factory.  ASGI startup
        # stays fast and tests can import the API without CUDA/Ultralytics work.
        from src.inference.pipeline import CrowdGenderPipeline

        pipeline = CrowdGenderPipeline(
            config_path=config_path,
            model_path=gender_model_path,
            defer_attribute_models=defer_attribute_models,
        )
        if warmup:
            pipeline.warmup()
        return pipeline

    return factory
