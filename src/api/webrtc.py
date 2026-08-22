"""Optional WebRTC media-plane router for the Crowd Analytics demo.

The REST API remains usable without WebRTC dependencies.  ``aiortc`` and its
PyAV dependency are intentionally imported only while handling an SDP offer:
the lightweight HTTP API must still boot in environments that only need the
upload/frame-demo path.  In such an environment the offer endpoint returns a
clear 503 rather than pretending that a peer connection was established.

The browser uses *non-trickle ICE* for this small demo: it waits until its
offer has finished ICE gathering, then sends the complete offer through the
``/webrtc/connect`` lifecycle WebSocket. The media direction is deliberately
**send-only**: aiortc consumes the browser camera track and feeds the latest
frame into ``LiveFrameProcessor``. It does not render or send an annotated
video track back to the browser. The same persistent socket pushes compact
analytics/overlay metadata and keeps a serverless Function Call alive for the
live-session lifetime. If mobile NAT prevents ICE from connecting, that same
socket accepts bounded JPEG frames while retaining the warm tracker session.
A POST offer endpoint remains for normal self-hosted ASGI deployments.

aiortc peers use a default public STUN server (overridable with
``WEBRTC_STUN_SERVERS``) for candidate discovery. TURN credentials remain
intentionally out of scope for this one-camera demo;
restrictive NATs may therefore still need a managed relay.
"""

from __future__ import annotations

import asyncio
from contextlib import suppress
import json
import inspect
import logging
import os
from dataclasses import dataclass
from time import monotonic
from typing import Any, Callable, Literal, Protocol

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field, ValidationError


LOGGER = logging.getLogger(__name__)

DEFAULT_STUN_SERVER = "stun:stun.l.google.com:19302"
STUN_SERVERS_ENV = "WEBRTC_STUN_SERVERS"
MAX_FALLBACK_FRAME_BYTES = 1_000_000
FALLBACK_FRAME_MIN_INTERVAL_SECONDS = 0.18


class WebRTCDependencyUnavailable(RuntimeError):
    """Raised when the optional WebRTC media runtime is not installed."""


@dataclass(frozen=True)
class AiortcBackend:
    """The small subset of aiortc/PyAV used by this module.

    Keeping this injectable makes the router testable without installing or
    opening real peer connections in the normal unit-test environment.
    """

    peer_connection_type: type[Any]
    session_description_type: type[Any]
    video_stream_track_type: type[Any]
    video_frame_type: Any
    configuration_type: type[Any] | None = None
    ice_server_type: type[Any] | None = None


def load_aiortc_backend() -> AiortcBackend:
    """Load aiortc lazily, with an actionable error for the API caller."""

    try:
        from aiortc import RTCConfiguration, RTCIceServer, RTCPeerConnection, RTCSessionDescription
        try:
            # Publicly re-exported by current aiortc releases.
            from aiortc import VideoStreamTrack
        except ImportError:  # pragma: no cover - compatibility with older aiortc layouts.
            from aiortc.mediastreams import VideoStreamTrack
        from av import VideoFrame
    except (ImportError, OSError) as exc:
        raise WebRTCDependencyUnavailable(
            "WebRTC is not enabled in this deployment. Install the optional "
            "media dependencies (for example: pip install aiortc av) and redeploy."
        ) from exc
    return AiortcBackend(
        peer_connection_type=RTCPeerConnection,
        session_description_type=RTCSessionDescription,
        video_stream_track_type=VideoStreamTrack,
        video_frame_type=VideoFrame,
        configuration_type=RTCConfiguration,
        ice_server_type=RTCIceServer,
    )


def _normalize_stun_servers(servers: tuple[str, ...] | list[str]) -> tuple[str, ...]:
    normalized = tuple(dict.fromkeys(str(server).strip() for server in servers if str(server).strip()))
    for server in normalized:
        if not server.lower().startswith(("stun:", "stuns:")):
            raise ValueError("STUN server URLs must start with stun: or stuns:.")
    return normalized


def resolve_stun_servers(raw_value: str | None = None) -> tuple[str, ...]:
    """Resolve comma-separated STUN URLs without exposing TURN credentials.

    The default helps browser-to-Modal candidate discovery. Set
    ``WEBRTC_STUN_SERVERS`` to a comma-separated list to use an organisation's
    STUN service, or to an empty string to intentionally disable STUN. TURN is
    not accepted here because this demo has no credential-management or relay
    policy yet.
    """

    configured = os.getenv(STUN_SERVERS_ENV) if raw_value is None else raw_value
    if configured is None:
        return (DEFAULT_STUN_SERVER,)
    return _normalize_stun_servers(configured.split(","))


def _create_peer_connection(
    backend: AiortcBackend,
    *,
    stun_servers: tuple[str, ...],
) -> Any:
    """Construct an aiortc peer with STUN, preserving dependency-free mocks."""

    # Test/alternate backends can omit aiortc's ICE configuration classes.
    # Existing lightweight mock peers then retain their zero-argument
    # constructor while real aiortc peers always receive an RTCConfiguration.
    if backend.configuration_type is None or backend.ice_server_type is None:
        return backend.peer_connection_type()
    ice_servers = [backend.ice_server_type(urls=server) for server in stun_servers]
    configuration = backend.configuration_type(iceServers=ice_servers)
    return backend.peer_connection_type(configuration=configuration)


class WebRTCSessionManager(Protocol):
    """Duck-typed contract supplied by ``src.api.sessions.DemoSessionManager``.

    The media router deliberately never imports the concrete REST/session
    manager.  It only needs a per-session latest-frame processor and the
    lifecycle methods below, which keeps the stateful FastTracker ownership in
    one place.
    """

    def create_session(
        self,
        *,
        mode: str = "default",
        camera_id: str | None = None,
    ) -> Any: ...

    def submit_frame(
        self,
        session_id: str,
        frame: np.ndarray,
        submitted_at: float | None = None,
    ) -> Any: ...

    def latest_result(self, session_id: str) -> Any: ...

    def close(self, session_id: str) -> Any: ...


class WebRTCOfferRequest(BaseModel):
    """A complete, non-trickle browser SDP offer."""

    sdp: str = Field(min_length=1, max_length=200_000)
    type: Literal["offer"] = "offer"
    mode: Literal["default", "classroom_demo"] = "default"
    camera_id: str | None = Field(default=None, max_length=128)


class WebRTCOfferResponse(BaseModel):
    session_id: str
    sdp: str
    type: Literal["answer"]
    mode: Literal["default", "classroom_demo"]
    ice_mode: Literal["non_trickle"] = "non_trickle"
    expires_in_seconds: int | None = None


@dataclass(frozen=True)
class _PeerRecord:
    session_id: str
    peer_connection: Any


class WebRTCPeerRegistry:
    """Own and close aiortc peers alongside their tracker sessions.

    ``DemoSessionManager`` owns the actual model/processor.  This registry only
    ensures that a browser disconnect also closes that manager session, and
    allows the REST ``DELETE /sessions/{id}`` handler to close a peer first.
    """

    def __init__(self, session_manager: WebRTCSessionManager) -> None:
        self._session_manager = session_manager
        self._records: dict[str, _PeerRecord] = {}
        self._lock = asyncio.Lock()

    async def register(self, session_id: str, peer_connection: Any) -> None:
        """Register a peer, replacing an old peer for the same session safely."""

        previous: _PeerRecord | None
        async with self._lock:
            previous = self._records.get(session_id)
            self._records[session_id] = _PeerRecord(session_id, peer_connection)
        if previous is not None and previous.peer_connection is not peer_connection:
            await self._close_peer_connection(previous.peer_connection)

    async def close_peer(
        self,
        session_id: str,
        *,
        expected_peer: Any | None = None,
    ) -> bool:
        """Close and forget a peer without touching the session manager."""

        record = await self._take(session_id, expected_peer=expected_peer)
        if record is None:
            return False
        await self._close_peer_connection(record.peer_connection)
        return True

    async def close_session(
        self,
        session_id: str,
        *,
        expected_peer: Any | None = None,
    ) -> bool:
        """Close a peer (if present) and release its stateful tracker session."""

        peer_closed = await self.close_peer(session_id, expected_peer=expected_peer)
        self._close_manager_session(session_id)
        return peer_closed

    async def close_all(self) -> None:
        """Close all current peers and their sessions during application shutdown."""

        async with self._lock:
            records = list(self._records.values())
            self._records.clear()
        for record in records:
            await self._close_peer_connection(record.peer_connection)
            self._close_manager_session(record.session_id)

    async def peer_count(self) -> int:
        async with self._lock:
            return len(self._records)

    async def _take(self, session_id: str, *, expected_peer: Any | None) -> _PeerRecord | None:
        async with self._lock:
            record = self._records.get(session_id)
            if record is None:
                return None
            # An old connection-state callback must never tear down a newly
            # registered peer for the same session id.
            if expected_peer is not None and record.peer_connection is not expected_peer:
                return None
            return self._records.pop(session_id)

    async def _close_peer_connection(self, peer_connection: Any) -> None:
        ingest_tasks = list(getattr(peer_connection, "_crowd_ingest_tasks", ()))
        for task in ingest_tasks:
            if not task.done():
                task.cancel()
        if ingest_tasks:
            await asyncio.gather(*ingest_tasks, return_exceptions=True)
        try:
            result = peer_connection.close()
            if inspect.isawaitable(result):
                await result
        except Exception:  # Browser teardown is best effort and must not leak tracker state.
            LOGGER.debug("Unable to close WebRTC peer cleanly.", exc_info=True)

    def _close_manager_session(self, session_id: str) -> None:
        try:
            self._session_manager.close(session_id)
        except Exception:
            # REST deletion and a connection-state callback may race. Closing
            # an already-released demo session is intentionally idempotent. We
            # intentionally do not import the concrete SessionNotFoundError so
            # this optional adapter remains independent of the REST layer.
            LOGGER.debug("WebRTC cleanup found no live session %s.", session_id, exc_info=True)


def _session_id_from(entry: Any) -> str:
    """Accept the manager's SessionEntry object or a simple string in tests."""

    if isinstance(entry, str):
        return entry
    session_id = getattr(entry, "session_id", None)
    if not isinstance(session_id, str) or not session_id:
        raise RuntimeError("Session manager create_session() did not return a session_id.")
    return session_id


async def _consume_video_track(
    session_manager: WebRTCSessionManager,
    session_id: str,
    source_track: Any,
) -> None:
    """Consume an inbound camera track without creating a return media track.

    ``LiveFrameProcessor.submit_frame`` is intentionally non-blocking and
    capacity-one.  The consumer therefore keeps the WebRTC receive loop
    flowing while the model worker processes only the newest frame.  Results
    are delivered separately by the metadata WebSocket.
    """

    try:
        while True:
            source_frame = await source_track.recv()
            source_bgr = source_frame.to_ndarray(format="bgr24")
            if not isinstance(source_bgr, np.ndarray) or source_bgr.ndim != 3:
                continue
            session_manager.submit_frame(
                session_id,
                source_bgr,
                submitted_at=monotonic(),
            )
            # Real aiortc ``recv`` awaits the next RTP frame.  Yield once as
            # well so deterministic test tracks and alternate adapters that
            # return an already-ready frame cannot monopolize the event loop.
            await asyncio.sleep(0)
    except asyncio.CancelledError:
        raise
    except Exception:
        # A browser track ending or a malformed media frame must not crash the
        # ASGI worker.  Connection-state cleanup owns the session lifecycle.
        LOGGER.debug("WebRTC inbound video track ended.", exc_info=True)


def _unavailable_detail(exc: WebRTCDependencyUnavailable) -> dict[str, str]:
    return {
        "code": "webrtc_unavailable",
        "message": str(exc),
        "remediation": "Install the optional aiortc and av packages in the API image, then redeploy.",
    }


def create_webrtc_router(
    session_manager: WebRTCSessionManager,
    *,
    prefix: str = "/api/v1",
    registry: WebRTCPeerRegistry | None = None,
    backend_loader: Callable[[], AiortcBackend] = load_aiortc_backend,
    metadata_payload_factory: Callable[[str], dict[str, Any]] | None = None,
    allowed_websocket_origins: tuple[str, ...] = (),
    allow_detached_offer: bool = True,
    session_start_guard: Callable[[], None] | None = None,
    session_ttl_seconds: int | None = 600,
    stun_servers: tuple[str, ...] | None = None,
) -> APIRouter:
    """Create non-trickle WebRTC signaling endpoints.

    The caller should retain the supplied/returned registry (normally in
    ``app.state.webrtc_peers``).  A REST session-delete handler can then call
    ``await registry.close_peer(session_id)`` before it calls
    ``session_manager.close(session_id)``.  Connection failures call
    ``registry.close_session`` automatically.  Real aiortc peers use the
    default STUN server unless ``stun_servers`` is explicitly supplied or the
    ``WEBRTC_STUN_SERVERS`` environment variable overrides it. The WebSocket
    route keeps signaling, aiortc ingestion, and metadata inside one ASGI call;
    this is the production path for serverless WebSocket runtimes such as
    Modal. The HTTP offer remains available for conventional self-hosting.
    """

    if session_ttl_seconds is not None and session_ttl_seconds < 0:
        raise ValueError("session_ttl_seconds must be non-negative or None.")
    if session_ttl_seconds == 0:
        session_ttl_seconds = None
    effective_stun_servers = (
        resolve_stun_servers() if stun_servers is None else _normalize_stun_servers(stun_servers)
    )
    peer_registry = registry or WebRTCPeerRegistry(session_manager)
    router = APIRouter(prefix=prefix, tags=["webrtc"])

    async def accept_offer(
        offer: WebRTCOfferRequest,
        *,
        preserve_session_on_peer_failure: bool = False,
    ) -> tuple[WebRTCOfferResponse, Any]:
        """Create one tracker-owned peer and return its SDP answer."""

        # Do this before creating a session, avoiding a model/session leak when
        # the optional WebRTC media runtime was omitted from the deployment.
        try:
            backend = backend_loader()
        except WebRTCDependencyUnavailable as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=_unavailable_detail(exc),
                headers={"Retry-After": "60"},
            ) from exc

        if not offer.sdp.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={"code": "invalid_sdp", "message": "SDP offer must not be blank."},
            )

        if session_start_guard is not None:
            session_start_guard()
        entry = session_manager.create_session(mode=offer.mode, camera_id=offer.camera_id)
        session_id = _session_id_from(entry)
        response_mode = str(getattr(entry, "mode", offer.mode))
        response_ttl = getattr(entry, "expires_in_seconds", session_ttl_seconds)
        if response_ttl is not None:
            response_ttl = max(0, int(float(response_ttl)))
        try:
            peer_connection = _create_peer_connection(backend, stun_servers=effective_stun_servers)
        except Exception as exc:
            await peer_registry.close_session(session_id)
            LOGGER.exception("Unable to initialize WebRTC peer for demo session %s", session_id)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={
                    "code": "webrtc_peer_initialization_failed",
                    "message": "The WebRTC peer could not be initialized by this deployment.",
                },
            ) from exc
        await peer_registry.register(session_id, peer_connection)

        video_attached = False

        @peer_connection.on("connectionstatechange")
        async def on_connectionstatechange() -> None:
            connection_state = str(getattr(peer_connection, "connectionState", "")).lower()
            if connection_state in {"failed", "closed"}:
                if preserve_session_on_peer_failure:
                    # The lifecycle WebSocket can continue carrying bounded
                    # JPEG frames when mobile/carrier NAT prevents ICE from
                    # finding a usable UDP path. Keep the already-warm tracker
                    # session and release only the failed aiortc peer.
                    await peer_registry.close_peer(session_id, expected_peer=peer_connection)
                else:
                    await peer_registry.close_session(session_id, expected_peer=peer_connection)

        @peer_connection.on("track")
        def on_track(track: Any) -> None:
            nonlocal video_attached
            if getattr(track, "kind", None) != "video" or video_attached:
                return
            video_attached = True
            ingest_task = asyncio.create_task(_consume_video_track(session_manager, session_id, track))
            tasks = getattr(peer_connection, "_crowd_ingest_tasks", None)
            if tasks is None:
                tasks = []
                setattr(peer_connection, "_crowd_ingest_tasks", tasks)
            tasks.append(ingest_task)

        try:
            await peer_connection.setRemoteDescription(
                backend.session_description_type(sdp=offer.sdp, type=offer.type)
            )
            answer = await peer_connection.createAnswer()
            await peer_connection.setLocalDescription(answer)
            local_description = getattr(peer_connection, "localDescription", None)
            if local_description is None:
                raise RuntimeError("WebRTC peer did not create a local SDP answer.")
        except Exception as exc:
            await peer_registry.close_session(session_id, expected_peer=peer_connection)
            LOGGER.info("Rejected WebRTC offer for demo session %s: %s", session_id, type(exc).__name__)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "invalid_webrtc_offer",
                    "message": "The SDP offer could not be accepted by the WebRTC peer.",
                },
            ) from exc

        answer_type = str(getattr(local_description, "type", "answer"))
        answer_sdp = str(getattr(local_description, "sdp", ""))
        if answer_type != "answer" or not answer_sdp:
            await peer_registry.close_session(session_id, expected_peer=peer_connection)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={
                    "code": "webrtc_answer_unavailable",
                    "message": "The peer did not produce a usable SDP answer.",
                },
            )
        return (
            WebRTCOfferResponse(
                session_id=session_id,
                sdp=answer_sdp,
                type="answer",
                mode=response_mode,
                expires_in_seconds=response_ttl,
            ),
            peer_connection,
        )

    @router.post(
        "/webrtc/offer",
        response_model=WebRTCOfferResponse,
        status_code=status.HTTP_201_CREATED,
    )
    async def create_webrtc_offer(offer: WebRTCOfferRequest) -> WebRTCOfferResponse:
        if not allow_detached_offer:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "webrtc_lifecycle_socket_required",
                    "message": "This deployment requires /api/v1/webrtc/connect WebSocket signaling.",
                },
            )
        response, _peer_connection = await accept_offer(offer)
        return response

    @router.websocket("/webrtc/connect")
    async def connect_webrtc(websocket: WebSocket) -> None:
        """Keep signaling, media ingestion, and metadata in one ASGI call."""

        origin = (websocket.headers.get("origin") or "").rstrip("/")
        if origin and allowed_websocket_origins and origin not in allowed_websocket_origins:
            await websocket.close(code=4403, reason="Frontend origin is not allowed")
            return
        await websocket.accept()
        response: WebRTCOfferResponse | None = None
        peer_connection: Any | None = None
        receive_task: asyncio.Task[dict[str, Any]] | None = None
        try:
            raw_offer = await asyncio.wait_for(websocket.receive_json(), timeout=15.0)
            offer = WebRTCOfferRequest.model_validate(raw_offer)
            response, peer_connection = await accept_offer(
                offer,
                preserve_session_on_peer_failure=True,
            )
            await websocket.send_json(
                {"event": "answer", "answer": response.model_dump(mode="json")}
            )
            last_sequence: int | None = None
            fallback_active = False
            last_fallback_submission = 0.0

            async def enable_frame_fallback(reason: str) -> None:
                nonlocal fallback_active
                if fallback_active:
                    return
                fallback_active = True
                await peer_registry.close_peer(
                    response.session_id,
                    expected_peer=peer_connection,
                )
                await websocket.send_json(
                    {
                        "event": "transport",
                        "transport": "websocket_frames",
                        "reason": reason,
                    }
                )

            receive_task = asyncio.create_task(websocket.receive())
            while True:
                peer_state = str(getattr(peer_connection, "connectionState", "")).lower()
                if peer_state in {"failed", "closed"} and not fallback_active:
                    await enable_frame_fallback(f"webrtc_{peer_state}")

                if receive_task.done():
                    message = receive_task.result()
                    if message.get("type") == "websocket.disconnect":
                        break
                    receive_task = asyncio.create_task(websocket.receive())

                    text_payload = message.get("text")
                    if isinstance(text_payload, str):
                        try:
                            control = json.loads(text_payload)
                        except json.JSONDecodeError:
                            control = None
                        if (
                            isinstance(control, dict)
                            and control.get("event") == "fallback"
                            and control.get("transport") == "websocket_frames"
                        ):
                            await enable_frame_fallback("client_requested")

                    frame_bytes = message.get("bytes")
                    if isinstance(frame_bytes, bytes) and fallback_active:
                        submitted_at = monotonic()
                        if (
                            0 < len(frame_bytes) <= MAX_FALLBACK_FRAME_BYTES
                            and submitted_at - last_fallback_submission
                            >= FALLBACK_FRAME_MIN_INTERVAL_SECONDS
                        ):
                            encoded = np.frombuffer(frame_bytes, dtype=np.uint8)
                            frame = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
                            if isinstance(frame, np.ndarray) and frame.ndim == 3:
                                last_fallback_submission = submitted_at
                                session_manager.submit_frame(
                                    response.session_id,
                                    frame,
                                    submitted_at=submitted_at,
                                )

                result = session_manager.latest_result(response.session_id)
                sequence = getattr(result, "sequence", None)
                if (
                    metadata_payload_factory is not None
                    and isinstance(sequence, int)
                    and sequence != last_sequence
                ):
                    await websocket.send_json(
                        {
                            "event": "metadata",
                            "data": metadata_payload_factory(response.session_id),
                        }
                    )
                    last_sequence = sequence
                await asyncio.sleep(0.05)
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass
        except (ValidationError, asyncio.TimeoutError) as exc:
            with suppress(Exception):
                await websocket.send_json(
                    {
                        "event": "error",
                        "error": {"code": "invalid_webrtc_offer", "message": str(exc)},
                    }
                )
                await websocket.close(code=4400, reason="Invalid WebRTC offer")
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, dict) else {"message": str(exc.detail)}
            with suppress(Exception):
                await websocket.send_json({"event": "error", "error": detail})
                await websocket.close(code=4500, reason="WebRTC negotiation failed")
        except Exception:
            LOGGER.exception("WebRTC lifecycle WebSocket failed.")
            with suppress(Exception):
                await websocket.send_json(
                    {
                        "event": "error",
                        "error": {
                            "code": "webrtc_connection_failed",
                            "message": "The WebRTC session could not be established.",
                        },
                    }
                )
                await websocket.close(code=1011, reason="WebRTC session failed")
        finally:
            if receive_task is not None and not receive_task.done():
                receive_task.cancel()
                await asyncio.gather(receive_task, return_exceptions=True)
            if response is not None:
                await peer_registry.close_session(
                    response.session_id,
                    expected_peer=peer_connection,
                )

    # APIRouter intentionally has no State object. This attribute is a small,
    # explicit hand-off for an application factory that wants to store the
    # registry on ``FastAPI.state`` and use it in DELETE/lifespan handlers.
    setattr(router, "webrtc_peer_registry", peer_registry)
    return router


__all__ = [
    "AiortcBackend",
    "DEFAULT_STUN_SERVER",
    "STUN_SERVERS_ENV",
    "WebRTCDependencyUnavailable",
    "WebRTCOfferRequest",
    "WebRTCOfferResponse",
    "WebRTCPeerRegistry",
    "WebRTCSessionManager",
    "create_webrtc_router",
    "load_aiortc_backend",
    "resolve_stun_servers",
]
