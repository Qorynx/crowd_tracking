"""Bounded short-video analysis and an in-process asynchronous job queue.

Uploaded clips are copied during the submit request, then processed exactly
once by a background worker. The FastAPI composition can defer that worker to
an external scheduler; Modal uses a spawned method with its own Function Call
so long inference and encoding are not tied to a web timeout. Clients receive
``202`` and poll a lightweight status resource. Live WebRTC remains primary.
"""

from __future__ import annotations

from contextlib import suppress
from dataclasses import dataclass
import os
from pathlib import Path
import re
from secrets import token_urlsafe
from shutil import move, rmtree
from tempfile import TemporaryDirectory, mkdtemp, mkstemp
from threading import RLock, Thread
from time import monotonic, perf_counter
from typing import Any, BinaryIO, Callable, Protocol

import cv2

from src.api.sessions import PipelineFactory, UnsupportedSessionModeError
from src.inference.live_stream import LivePipeline
from src.inference.video_io import run_ffmpeg


def _percentile(values: list[float], percentile: float) -> float | None:
    """Return a linearly interpolated percentile without another dependency."""

    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * percentile / 100.0
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return round(ordered[lower] * (1.0 - weight) + ordered[upper] * weight, 3)


class VideoAnalysisError(RuntimeError):
    """Base error for safe client-facing upload diagnostics."""


class UnsupportedVideoError(VideoAnalysisError):
    pass


class VideoTooLargeError(VideoAnalysisError):
    pass


class VideoTooLongError(VideoAnalysisError):
    pass


class VideoAnalysisBusyError(VideoAnalysisError):
    """A live stateful tracker already owns the one-GPU demo capacity."""


class VideoDecodeError(VideoAnalysisError):
    pass


class VideoArtifactNotFoundError(VideoAnalysisError):
    pass


class VideoJobNotFoundError(VideoAnalysisError):
    pass


VideoProgressCallback = Callable[[float, str, str], None]


class VideoAnalyzer(Protocol):
    def analyze(
        self,
        stream: BinaryIO,
        *,
        filename: str | None,
        content_type: str | None,
        mode: str,
        progress_callback: VideoProgressCallback | None = None,
    ) -> dict[str, Any]: ...


_SUPPORTED_VIDEO_SUFFIXES = frozenset(
    {".mp4", ".mov", ".avi", ".mkv", ".webm", ".mpeg", ".mpg", ".m4v"}
)
_VIDEO_COPY_CHUNK_BYTES = 1_024 * 1_024
_VIDEO_JOB_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{20,64}$")


def validate_video_upload_metadata(filename: str | None, content_type: str | None) -> str:
    """Validate cheap upload metadata before an asynchronous job is accepted."""

    suffix = Path(filename or "upload.mp4").suffix.lower() or ".mp4"
    if suffix not in _SUPPORTED_VIDEO_SUFFIXES:
        supported = ", ".join(sorted(_SUPPORTED_VIDEO_SUFFIXES))
        raise UnsupportedVideoError(f"Unsupported video extension {suffix!r}. Supported extensions: {supported}.")
    if content_type and content_type not in {"application/octet-stream", "binary/octet-stream"}:
        if not content_type.lower().startswith("video/"):
            raise UnsupportedVideoError("Content-Type must be a video MIME type.")
    return suffix


@dataclass(frozen=True)
class _VideoArtifact:
    path: Path
    expires_at_monotonic: float


class VideoArtifactStore:
    """Keep completed annotated clips available briefly for the browser.

    Uploads and generated videos are deliberately not durable user data. The
    source upload is deleted as soon as processing finishes, while the rendered
    MP4 remains available through an opaque URL for a short, bounded period.
    """

    def __init__(self, *, ttl_seconds: float = 900.0) -> None:
        if ttl_seconds <= 0.0:
            raise ValueError("ttl_seconds must be positive.")
        self._ttl_seconds = float(ttl_seconds)
        self._root = Path(mkdtemp(prefix="crowd_api_video_artifacts_"))
        self._entries: dict[str, _VideoArtifact] = {}
        self._lock = RLock()

    @property
    def ttl_seconds(self) -> int:
        return int(self._ttl_seconds)

    def publish(self, source_path: Path) -> str:
        """Move one completed MP4 into the bounded artifact directory."""

        if not source_path.is_file():
            raise VideoAnalysisError("Annotated video output was not created.")
        with self._lock:
            self._evict_expired_locked(monotonic())
            token = token_urlsafe(18)
            destination = self._root / f"{token}.mp4"
            try:
                move(str(source_path), str(destination))
            except OSError as error:
                raise VideoAnalysisError("Annotated video output could not be prepared for download.") from error
            self._entries[token] = _VideoArtifact(
                path=destination,
                expires_at_monotonic=monotonic() + self._ttl_seconds,
            )
            return token

    def get(self, token: str) -> Path:
        with self._lock:
            self._evict_expired_locked(monotonic())
            artifact = self._entries.get(token)
            if artifact is None or not artifact.path.is_file():
                raise VideoArtifactNotFoundError("Annotated video is unavailable or has expired.")
            return artifact.path

    def close(self) -> None:
        with self._lock:
            self._entries.clear()
            root = self._root
        with suppress(OSError):
            rmtree(root)

    def _evict_expired_locked(self, now: float) -> None:
        expired_tokens = [
            token
            for token, artifact in self._entries.items()
            if artifact.expires_at_monotonic <= now or not artifact.path.is_file()
        ]
        for token in expired_tokens:
            artifact = self._entries.pop(token)
            with suppress(OSError):
                artifact.path.unlink()


@dataclass
class _VideoJob:
    job_id: str
    source_path: Path
    filename: str | None
    content_type: str | None
    mode: str
    status: str = "queued"
    progress: float = 0.0
    stage: str = "queued"
    message: str = "Video is queued for processing."
    result: dict[str, Any] | None = None
    error: dict[str, str] | None = None
    updated_at_monotonic: float = 0.0


class VideoJobManager:
    """Run at most one uploaded clip without tying work to an HTTP request."""

    def __init__(
        self,
        analyzer: VideoAnalyzer,
        artifact_store: VideoArtifactStore,
        *,
        max_bytes: int,
        result_ttl_seconds: float = 900.0,
        artifact_url_prefix: str = "/api/v1/video/artifacts",
    ) -> None:
        if max_bytes < 1:
            raise ValueError("max_bytes must be positive.")
        if result_ttl_seconds <= 0.0:
            raise ValueError("result_ttl_seconds must be positive.")
        self._analyzer = analyzer
        self._artifact_store = artifact_store
        self._max_bytes = int(max_bytes)
        self._result_ttl_seconds = float(result_ttl_seconds)
        self._artifact_url_prefix = artifact_url_prefix.rstrip("/")
        self._root = Path(mkdtemp(prefix="crowd_api_video_jobs_"))
        self._jobs: dict[str, _VideoJob] = {}
        self._threads: dict[str, Thread] = {}
        self._lock = RLock()
        self._closing = False

    def submit(
        self,
        stream: BinaryIO,
        *,
        filename: str | None,
        content_type: str | None,
        mode: str,
        job_id: str | None = None,
        start_immediately: bool = True,
    ) -> str:
        """Persist an upload and optionally start its local worker immediately.

        ``start_immediately=False`` is intended for an external job scheduler.
        It avoids daemon work escaping a serverless request while preserving
        the same idempotent job contract.
        """

        suffix = validate_video_upload_metadata(filename, content_type)
        job_id = str(job_id).strip() if job_id is not None else token_urlsafe(18)
        if not _VIDEO_JOB_ID_PATTERN.fullmatch(job_id):
            raise VideoAnalysisError("Video job id must be an opaque 20-64 character token.")
        source_path = self._root / f"{job_id}{suffix}"
        now = monotonic()
        job = _VideoJob(
            job_id=job_id,
            source_path=source_path,
            filename=filename,
            content_type=content_type,
            mode=mode,
            updated_at_monotonic=now,
        )
        with self._lock:
            self._evict_expired_locked(now)
            if self._closing:
                raise VideoAnalysisBusyError("Video analysis is shutting down.")
            # The browser creates this opaque id before upload. Returning an
            # existing job makes a retry safe when the original 202 response
            # was lost after the backend had already accepted the file.
            if job_id in self._jobs:
                return job_id
            if any(existing.status in {"queued", "processing"} for existing in self._jobs.values()):
                raise VideoAnalysisBusyError("Another video analysis job is already running.")
            self._jobs[job_id] = job

        try:
            self._copy_upload(stream, source_path)
            if start_immediately:
                worker = Thread(
                    target=self.run,
                    args=(job_id,),
                    name=f"video-analysis-{job_id[:8]}",
                    daemon=True,
                )
                with self._lock:
                    if self._closing:
                        raise VideoAnalysisBusyError("Video analysis is shutting down.")
                    self._threads[job_id] = worker
                worker.start()
        except Exception:
            with self._lock:
                self._jobs.pop(job_id, None)
                self._threads.pop(job_id, None)
            with suppress(OSError):
                source_path.unlink()
            raise
        return job_id

    def run(self, job_id: str) -> None:
        """Process one queued job exactly once.

        Duplicate idempotent submissions may schedule this method more than
        once. The queued-to-processing transition below makes every later call
        a no-op instead of repeating inference.
        """

        self._run_job(job_id)

    def get(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            self._evict_expired_locked(monotonic())
            job = self._jobs.get(job_id)
            if job is None:
                raise VideoJobNotFoundError("Video analysis job was not found or has expired.")
            return {
                "job_id": job.job_id,
                "status": job.status,
                "progress": round(job.progress, 4),
                "stage": job.stage,
                "message": job.message,
                "result": job.result,
                "error": job.error,
            }

    def is_busy(self) -> bool:
        """Return whether a queued/processing clip currently owns GPU work."""

        with self._lock:
            self._evict_expired_locked(monotonic())
            return any(job.status in {"queued", "processing"} for job in self._jobs.values())

    def close(self) -> None:
        with self._lock:
            self._closing = True
            workers = list(self._threads.values())
        for worker in workers:
            worker.join()
        with self._lock:
            self._jobs.clear()
            self._threads.clear()
            root = self._root
        with suppress(OSError):
            rmtree(root)

    def _run_job(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status != "queued":
                return
            job.status = "processing"
            job.progress = 0.01
            job.stage = "preparing"
            job.message = "Preparing video for inference."
            job.updated_at_monotonic = monotonic()
            source_path = job.source_path
            filename = job.filename
            content_type = job.content_type
            mode = job.mode

        try:
            with source_path.open("rb") as stream:
                result = self._analyzer.analyze(
                    stream,
                    filename=filename,
                    content_type=content_type,
                    mode=mode,
                    progress_callback=lambda progress, stage, message: self._update_progress(
                        job_id, progress, stage, message
                    ),
                )
            artifact_path = result.pop("_annotated_video_path", None)
            artifacts = result.setdefault("artifacts", {})
            if artifact_path:
                artifact_id = self._artifact_store.publish(Path(str(artifact_path)))
                artifacts.update(
                    {
                        "annotated_video_url": f"{self._artifact_url_prefix}/{artifact_id}",
                        "annotated_video_filename": "annotated.mp4",
                        "expires_in_seconds": self._artifact_store.ttl_seconds,
                    }
                )
            with self._lock:
                job = self._jobs.get(job_id)
                if job is not None:
                    job.status = "completed"
                    job.progress = 1.0
                    job.stage = "completed"
                    job.message = "Video analysis completed."
                    job.result = result
                    job.updated_at_monotonic = monotonic()
        except Exception as error:
            with self._lock:
                job = self._jobs.get(job_id)
                if job is not None:
                    job.status = "failed"
                    job.stage = "failed"
                    job.message = "Video analysis failed."
                    job.error = {
                        "code": self._error_code(error),
                        "message": str(error) or "Video analysis failed.",
                    }
                    job.updated_at_monotonic = monotonic()
        finally:
            with suppress(OSError):
                source_path.unlink()
            with self._lock:
                self._threads.pop(job_id, None)

    def _update_progress(self, job_id: str, progress: float, stage: str, message: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status != "processing":
                return
            job.progress = max(job.progress, min(0.99, max(0.0, float(progress))))
            job.stage = str(stage)
            job.message = str(message)
            job.updated_at_monotonic = monotonic()

    def _copy_upload(self, stream: BinaryIO, target_path: Path) -> None:
        with suppress(Exception):
            stream.seek(0)
        total_bytes = 0
        with target_path.open("wb") as destination:
            while chunk := stream.read(_VIDEO_COPY_CHUNK_BYTES):
                total_bytes += len(chunk)
                if total_bytes > self._max_bytes:
                    raise VideoTooLargeError(
                        f"Upload exceeds the {self._max_bytes // (1024 * 1024)} MiB demo limit."
                    )
                destination.write(chunk)
        if total_bytes == 0:
            raise UnsupportedVideoError("Upload is empty.")

    def _evict_expired_locked(self, now: float) -> None:
        expired = [
            job_id
            for job_id, job in self._jobs.items()
            if job.status in {"completed", "failed"}
            and job.updated_at_monotonic + self._result_ttl_seconds <= now
        ]
        for job_id in expired:
            self._jobs.pop(job_id, None)

    @staticmethod
    def _error_code(error: Exception) -> str:
        if isinstance(error, UnsupportedVideoError):
            return "unsupported_video"
        if isinstance(error, VideoTooLargeError):
            return "video_too_large"
        if isinstance(error, VideoTooLongError):
            return "video_too_long"
        if isinstance(error, UnsupportedSessionModeError):
            return "unsupported_mode"
        if isinstance(error, VideoDecodeError):
            return "video_decode_failed"
        return "video_analysis_failed"


class ShortVideoAnalyzer:
    """Analyze bounded uploads through one warm pipeline per allowed mode.

    The model weights stay resident between clips, while ``reset`` clears the
    tracker and analytics state before the next clip. A lock serializes jobs so
    a shared stateful pipeline is never touched by two uploads concurrently.
    """

    def __init__(
        self,
        pipeline_factory: PipelineFactory,
        *,
        allowed_modes: tuple[str, ...] = ("default", "classroom_demo"),
        max_bytes: int = 64 * 1024 * 1024,
        max_seconds: float = 60.0,
        max_frames: int = 1_800,
    ) -> None:
        if max_bytes < 1:
            raise ValueError("max_bytes must be positive.")
        if max_seconds <= 0.0:
            raise ValueError("max_seconds must be positive.")
        if max_frames < 1:
            raise ValueError("max_frames must be positive.")
        self._pipeline_factory = pipeline_factory
        self._allowed_modes = frozenset(allowed_modes)
        self._max_bytes = int(max_bytes)
        self._max_seconds = float(max_seconds)
        self._max_frames = int(max_frames)
        self._pipeline_lock = RLock()
        self._pipelines: dict[str, LivePipeline] = {}

    def analyze(
        self,
        stream: BinaryIO,
        *,
        filename: str | None,
        content_type: str | None,
        mode: str,
        progress_callback: VideoProgressCallback | None = None,
    ) -> dict[str, Any]:
        normalized_mode = self._normalize_mode(mode)
        suffix = validate_video_upload_metadata(filename, content_type)
        with TemporaryDirectory(prefix="crowd_api_video_") as temporary_directory:
            source_path = Path(temporary_directory) / f"upload{suffix}"
            received_bytes = self._copy_upload(stream, source_path)
            _report_video_progress(progress_callback, 0.02, "preparing", "Video upload is ready for inference.")
            # A pipeline owns persistent tracker state and GPU model objects.
            # Serialize the whole clip, not only pipeline acquisition, so a
            # reused instance cannot be mutated by concurrent requests.
            with self._pipeline_lock:
                return self._process_file(
                    source_path,
                    normalized_mode,
                    received_bytes,
                    progress_callback=progress_callback,
                )

    def _process_file(
        self,
        source_path: Path,
        mode: str,
        received_bytes: int,
        *,
        progress_callback: VideoProgressCallback | None = None,
    ) -> dict[str, Any]:
        capture = cv2.VideoCapture(str(source_path))
        if not capture.isOpened():
            capture.release()
            raise VideoDecodeError("OpenCV could not open the uploaded video.")
        pipeline: LivePipeline | None = None
        writer: cv2.VideoWriter | None = None
        output_path: Path | None = None
        completed = False
        try:
            reported_fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
            fps = reported_fps if reported_fps > 0.0 else 25.0
            reported_frames = max(0, int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0))
            reported_duration = reported_frames / fps if reported_frames else None
            if reported_duration is not None and reported_duration > self._max_seconds:
                raise VideoTooLongError(
                    f"The uploaded video is {reported_duration:.1f}s; demo limit is {self._max_seconds:.1f}s."
                )
            if reported_frames and reported_frames > self._max_frames:
                raise VideoTooLongError(
                    f"The uploaded video has {reported_frames} frames; demo limit is {self._max_frames}."
                )

            pipeline = self._pipeline_for_mode(mode)
            _report_video_progress(progress_callback, 0.05, "processing", "Running detection and tracking.")
            started_at = perf_counter()
            frames_processed = 0
            last_stats: dict[str, Any] | None = None
            pipeline_latencies_ms: list[float] = []
            stage_timings_ms: dict[str, list[float]] = {}
            progress_interval = max(1, reported_frames // 100) if reported_frames else 10
            with TemporaryDirectory(prefix="crowd_api_video_encode_") as encoding_directory:
                raw_output_path = Path(encoding_directory) / "annotated_raw.mp4"
                file_descriptor, output_name = mkstemp(prefix="crowd_api_annotated_", suffix=".mp4")
                os.close(file_descriptor)
                output_path = Path(output_name)
                # OpenCV and FFmpeg both need to create/overwrite the target
                # themselves. Avoid leaving a zero-byte placeholder in their way.
                output_path.unlink(missing_ok=True)
                while True:
                    ok, frame = capture.read()
                    if not ok:
                        break
                    if frames_processed >= self._max_frames:
                        raise VideoTooLongError(f"The uploaded video exceeds the {self._max_frames}-frame demo limit.")
                    timestamp_seconds = frames_processed / fps
                    frame_started_at = perf_counter()
                    annotated, last_stats = pipeline.process_frame(frame, timestamp_seconds=timestamp_seconds)
                    pipeline_latencies_ms.append((perf_counter() - frame_started_at) * 1_000.0)
                    timing_payload = last_stats.get("runtime", {}).get("timing_ms", {})
                    if isinstance(timing_payload, dict):
                        for stage_name, value in timing_payload.items():
                            if stage_name not in {"p50", "p95"} and isinstance(value, (int, float)):
                                stage_timings_ms.setdefault(str(stage_name), []).append(float(value))
                    if writer is None:
                        frame_height, frame_width = annotated.shape[:2]
                        if frame_width <= 0 or frame_height <= 0:
                            raise VideoDecodeError("The annotated video frame has invalid dimensions.")
                        writer = cv2.VideoWriter(
                            str(raw_output_path),
                            cv2.VideoWriter_fourcc(*"mp4v"),
                            fps,
                            (frame_width, frame_height),
                        )
                        if not writer.isOpened():
                            raise VideoAnalysisError("OpenCV could not create the annotated video output.")
                    writer.write(annotated)
                    frames_processed += 1
                    if frames_processed == 1 or frames_processed % progress_interval == 0:
                        denominator = reported_frames or self._max_frames
                        progress = 0.05 + (0.85 * min(1.0, frames_processed / max(1, denominator)))
                        _report_video_progress(
                            progress_callback,
                            progress,
                            "processing",
                            f"Processed {frames_processed}{f' / {reported_frames}' if reported_frames else ''} frames.",
                        )
                    if timestamp_seconds > self._max_seconds:
                        raise VideoTooLongError(
                            f"The uploaded video exceeds the {self._max_seconds:.1f}s demo limit."
                        )
                if writer is not None:
                    writer.release()
                    writer = None
                if frames_processed == 0 or last_stats is None:
                    raise VideoDecodeError("The uploaded video did not contain a decodable frame.")
                # OpenCV's portable mp4v output is not consistently playable
                # in browsers. Transcode it to H.264/yuv420p just like the
                # previous Gradio workflow did.
                _report_video_progress(
                    progress_callback,
                    0.93,
                    "encoding",
                    "Encoding the annotated video for browser playback.",
                )
                run_ffmpeg(
                    [
                        "-y",
                        "-i",
                        str(raw_output_path),
                        "-c:v",
                        "libx264",
                        "-preset",
                        "ultrafast",
                        "-pix_fmt",
                        "yuv420p",
                        "-movflags",
                        "+faststart",
                        str(output_path),
                    ]
                )
            elapsed_seconds = max(0.0, perf_counter() - started_at)
            pipeline_seconds = sum(pipeline_latencies_ms) / 1_000.0
            timing_summary = {
                stage_name: {
                    "mean": round(sum(values) / len(values), 3),
                    "p50": _percentile(values, 50.0),
                    "p95": _percentile(values, 95.0),
                }
                for stage_name, values in sorted(stage_timings_ms.items())
                if values
            }
            if output_path is None or not output_path.is_file() or output_path.stat().st_size == 0:
                raise VideoAnalysisError("The annotated video output could not be encoded.")
            result = {
                "status": "completed",
                "mode": mode,
                "input": {
                    "bytes": received_bytes,
                    "frames_reported": reported_frames or None,
                    "frames_processed": frames_processed,
                    "fps": round(fps, 3),
                    "duration_seconds": round(frames_processed / fps, 3),
                },
                "performance": {
                    "wall_time_seconds": round(elapsed_seconds, 3),
                    "average_processing_fps": round(frames_processed / elapsed_seconds, 3)
                    if elapsed_seconds > 0.0
                    else 0.0,
                    "pipeline_seconds": round(pipeline_seconds, 3),
                    "pipeline_fps": round(frames_processed / pipeline_seconds, 3)
                    if pipeline_seconds > 0.0
                    else 0.0,
                    "pipeline_p50_latency_ms": _percentile(pipeline_latencies_ms, 50.0),
                    "pipeline_p95_latency_ms": _percentile(pipeline_latencies_ms, 95.0),
                    "stage_timing_ms": timing_summary,
                },
                # Return the same full analytics envelope used by the live
                # dashboard. No input or crop data is retained after return.
                "analytics": last_stats,
                "artifacts": {
                    "annotated_video_url": None,
                    "annotated_video_filename": "annotated.mp4",
                    "note": "Annotated MP4 is available briefly after this response.",
                },
                # Internal-only handoff to the FastAPI artifact store. The
                # public response replaces this with a short-lived URL.
                "_annotated_video_path": str(output_path),
            }
            completed = True
            _report_video_progress(progress_callback, 0.99, "finalizing", "Publishing the analysis result.")
            return result
        finally:
            capture.release()
            if writer is not None:
                writer.release()
            if output_path is not None and not completed:
                with suppress(OSError):
                    output_path.unlink()
            if pipeline is not None:
                # Keep model weights warm for the next clip. Reset is performed
                # after every job as well as before acquisition, so a failed
                # upload cannot leak tracker/analytics state into the next one.
                with suppress(Exception):
                    pipeline.reset()

    def _pipeline_for_mode(self, mode: str) -> LivePipeline:
        pipeline = self._pipelines.get(mode)
        if pipeline is None:
            pipeline = self._pipeline_factory(mode)
            self._pipelines[mode] = pipeline
        else:
            pipeline.reset()
        return pipeline

    def close(self) -> None:
        """Release all warm upload pipelines during API shutdown."""

        with self._pipeline_lock:
            pipelines = list(self._pipelines.values())
            self._pipelines.clear()
        for pipeline in pipelines:
            close = getattr(pipeline, "close", None)
            with suppress(Exception):
                if callable(close):
                    close()
                else:
                    pipeline.reset()

    def _copy_upload(self, stream: BinaryIO, target_path: Path) -> int:
        with suppress(Exception):
            stream.seek(0)
        total_bytes = 0
        with target_path.open("wb") as destination:
            while chunk := stream.read(_VIDEO_COPY_CHUNK_BYTES):
                total_bytes += len(chunk)
                if total_bytes > self._max_bytes:
                    raise VideoTooLargeError(
                        f"Upload exceeds the {self._max_bytes // (1024 * 1024)} MiB demo limit."
                    )
                destination.write(chunk)
        if total_bytes == 0:
            raise UnsupportedVideoError("Upload is empty.")
        return total_bytes

    def _normalize_mode(self, mode: str) -> str:
        normalized = str(mode).strip().lower()
        if normalized not in self._allowed_modes:
            allowed = ", ".join(sorted(self._allowed_modes))
            raise UnsupportedSessionModeError(f"Unsupported mode {mode!r}. Allowed modes: {allowed}.")
        return normalized



def _report_video_progress(
    callback: VideoProgressCallback | None,
    progress: float,
    stage: str,
    message: str,
) -> None:
    if callback is None:
        return
    with suppress(Exception):
        callback(progress, stage, message)
