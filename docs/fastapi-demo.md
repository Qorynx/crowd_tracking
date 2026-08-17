# FastAPI demo API

The Modal deployment exposes a small, stateful API at `/api/v1`. It is
**API-only**: FastAPI's interactive schema is at `/docs` and the root URL
redirects there. The existing Gradio interface remains a separate local
application (`python app.py`).

The live pipeline is intentionally session-owned: a FastTracker instance,
session-scoped `person_id` resolver, counters, and heatmap belong to exactly
one active browser peer.  The demo limit is one live session, with a default
idle expiry of 600 seconds.

Keeping Modal API-only ensures its single session manager is the only owner of
the one GPU pipeline. A future shared-manager refactor can add a hosted UI
without risking two independent FastTracker states.

## Run locally

Install the normal runtime and the optional media transport dependencies:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pip install -r deploy\requirements-webrtc.txt
.\.venv\Scripts\python.exe -m uvicorn "src.api.app:create_api_app" --factory --host 127.0.0.1 --port 8000
```

`deploy/modal_app.py` also installs both dependency sets. Its Modal ASGI target
is API-only; run `app.py` locally if a Gradio UI is needed. Public live media
uses the lifecycle WebSocket described below so the aiortc peer remains inside
one Modal Function Call.

The person detector is an application artifact at
`artifacts/person_detector/yolo11n.pt`, alongside the face and classification
models. Keep that checkpoint in place before starting the API or deploying to
Modal; the image copies this exact file and does not depend on Ultralytics'
automatic download cache.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Lightweight liveness and live-session capacity; never warms a model. |
| `GET` | `/api/v1/ready` | Checks config/model assets only; it is not the runtime model-ready signal. |
| `POST` | `/api/v1/warmup` | Starts an idempotent staged warm-up for a live mode and returns its current state. |
| `GET` | `/api/v1/warmup?mode=classroom_demo` | Polls detector/tracker/attribute readiness without creating a session. |
| `POST` | `/api/v1/sessions` | Creates a stateful tracker session for lifecycle/testing use. |
| `GET` | `/api/v1/sessions/{session_id}` | Gets session metadata and remaining TTL. |
| `GET` | `/api/v1/sessions/{session_id}/stats` | Gets the latest complete analytics/dashboard snapshot for control/debug clients. |
| `WebSocket` | `/api/v1/sessions/{session_id}/metadata` | Pushes each newer bbox/analytics snapshot for the live Canvas overlay. |
| `POST` | `/api/v1/sessions/{session_id}/reset` | Clears FastTracker, `person_id`, counters, heatmap, and cadence telemetry. |
| `DELETE` | `/api/v1/sessions/{session_id}` | Closes the live worker and releases its tracking state. |
| `WS` | `/api/v1/webrtc/connect` | Preferred signaling + metadata channel; owns the peer for the socket lifetime. |
| `POST` | `/api/v1/webrtc/offer` | Self-hosted browser WebRTC signaling; creates the live session and returns the SDP answer. |
| `POST` | `/api/v1/video/analyze` | Uploads one bounded clip and immediately creates an asynchronous analysis job. |
| `GET` | `/api/v1/video/jobs/{job_id}` | Returns queued/processing progress or the completed video result. |
| `GET` | `/api/v1/video/artifacts/{artifact_id}` | Streams a short-lived annotated H.264 MP4. |

Normal self-hosted startup warms `classroom_demo` in the background and keeps
the resulting pipeline in a one-slot warm pool. Modal sets
`API_WARM_ON_START=false`, so health/readiness traffic does not initialize a
GPU model; the React live flow starts the same idempotent warmup on demand.
`POST /warmup` returns existing state instead of loading a second copy. A live
session claims that pipeline, resets only stream state, and returns it to the
pool on `DELETE`.

Warm-up is staged. `tracking_ready` means YOLO and FastTracker can accept live
frames while `attributes_ready` is still false; face/body attributes are then
warmed in the background. The React client shows camera/tracker/attributes
steps rather than presenting the backend's approximate progress number as an
exact percentage. Browser camera readiness is local to `getUserMedia()` and is
therefore not reported by `/ready`.

All application errors use a compact envelope such as:

```json
{
  "detail": {
    "code": "live_session_capacity_reached",
    "message": "Live demo capacity is 1 session(s); close the existing session first."
  }
}
```

## REST control and dashboard

Create a session only when testing the lifecycle via REST.  A WebRTC offer
creates its own session, so do not create a second one first.

```bash
curl -X POST http://127.0.0.1:8000/api/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"mode":"default","camera_id":"demo-camera"}'
```

The only allowed modes are `default` and `classroom_demo`.  `classroom_demo`
uses the deployed classroom profile; it reports an unconfigured/calibration
state until a real camera geometry config has been supplied.

For a manually-created REST session, connect the compatibility metadata
WebSocket instead of polling REST:

```bash
ws://127.0.0.1:8000/api/v1/sessions/demo_abc123/metadata
```

Its response is deliberately one complete snapshot:

```json
{
  "status": "ready",
  "session": {"id": "demo_abc123", "mode": "default"},
  "frame": {"sequence": 42},
  "analytics": {
    "identity": {},
    "crowd": {},
    "spatial": {},
    "runtime": {}
  },
  "live_stream": {}
}
```

Before the first media frame, `status` is `waiting_for_frame` and `analytics`
is `null`.  Once frames arrive, `analytics` contains the current pipeline
envelope: local/confirmed tracks, session `person_id` mappings and recovery
counts, visual-presentation estimates, motion/crossing counters, spatial
heatmap and zone values, classroom state, detector recovery telemetry, and
latency/FPS/drop measurements.  `live_stream` contains the newest-frame queue
and worker telemetry used by the realtime path.

Resetting is intentionally destructive to only that in-memory session:

```bash
curl -X POST http://127.0.0.1:8000/api/v1/sessions/demo_abc123/reset
curl -X DELETE http://127.0.0.1:8000/api/v1/sessions/demo_abc123
```

## WebRTC send-only camera + metadata WebSocket

`WebSocket /api/v1/webrtc/connect` is the React client's media entry point. It
accepts a complete **non-trickle ICE** offer, returns an SDP answer plus a newly
allocated `session_id`, then pushes sequence-gated metadata on the same socket:

```json
{
  "sdp": "v=0\\r\\n...",
  "type": "offer",
  "mode": "default",
  "camera_id": "browser-camera"
}
```

The offer creates an **inbound-only media path**. aiortc consumes the browser
camera track and submits frames to the capacity-one live processor; it does
not create an annotated output track. The browser keeps its local raw
`<video>` smooth and receives the newest compact analytics/overlay envelope on
that lifecycle socket to draw on Canvas. REST `/stats` and
`/sessions/{id}/metadata` remain useful compatibility paths for control/debug
and manually-created sessions, but are not the primary React live data path.
Self-hosted clients may still use `POST /webrtc/offer`; Modal rejects that
detached route so the peer cannot outlive its Function Call.

The demo does not implement a DataChannel, candidate endpoint, TURN
credentials, or multi-camera routing. It uses `stun:stun.l.google.com:19302` by default; set
`WEBRTC_STUN_SERVERS` to a comma-separated `stun:`/`stuns:` allow-list when
self-hosting. For a simple public test, configure the browser peer with that
same STUN service:

```js
new RTCPeerConnection({
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
})
```

It expects the browser to wait for ICE gathering to complete before sending
the offer. An empty `WEBRTC_STUN_SERVERS` value disables server-side STUN;
TURN URLs and credentials are deliberately rejected by this demo. If the
optional media packages were not installed, the endpoint returns `503` with
code `webrtc_unavailable`.

### Modal WebRTC boundary

The React client uses `WebSocket /api/v1/webrtc/connect` for the complete SDP
offer, SDP answer, and sequence-gated metadata push. That socket remains open
for the peer lifetime, so Modal keeps the owning Function Call active instead
of depending on an aiortc task after a POST response has returned. The Modal
profile rejects the detached `POST /webrtc/offer` route; that compatibility
route remains available for conventional self-hosted ASGI deployments.

This is still a bounded one-container MVP, not a multi-peer Modal worker pool.
STUN succeeds on many networks, while restrictive NAT/firewall environments
need a managed TURN relay. See [Modal's WebRTC YOLO
example](https://modal.com/docs/examples/webrtc_yolo) for the scalable spawned
peer and TURN pattern.

## Short video fallback

Upload one short clip with `multipart/form-data`:

```bash
curl -X POST http://127.0.0.1:8000/api/v1/video/analyze \
  -F "file=@sample.mp4;type=video/mp4" \
  -F "mode=default" \
  -F "job_id=0123456789abcdef0123456789abcdef"
```

The demo accepts `.mp4`, `.mov`, `.avi`, `.mkv`, and `.webm`, with default
limits of 64 MiB, 60 seconds, and 1,800 frames. The submit response is `202`
with a `job_id` and `status_url`; inference and H.264 encoding continue in one
background worker instead of keeping the response body open. On Modal the API
spawns `Backend.run_video_job`, which has its own 900-second Function Call and
shares the one-container T4 pool with the API. The browser still receives
`202` immediately:

```json
{
  "status": "queued",
  "job_id": "opaque-id",
  "status_url": "/api/v1/video/jobs/opaque-id",
  "poll_after_ms": 1000
}
```

Poll only that status URL. A completed snapshot contains final analytics,
processing performance, and a short-lived annotated-video URL. The browser may
leave the page and resume the same job without running inference again. Source
uploads are deleted after processing; job snapshots are in-process and expire,
so they do not survive an API restart. `job_id` is an optional opaque 20-64
character idempotency token; retrying a submit with the same token returns the
existing job instead of consuming another inference run.

## Demo boundaries

- Session IDs are ephemeral; `person_id` is session-scoped and resets with
  `POST /reset`, session expiry, or `DELETE`.
- A second live session is rejected with `429` until the first is closed or
  expires. This preserves tracker/session affinity on one demo GPU container.
- No authentication, durable job/storage service, TURN service, scalable
  Modal peer pool, or multi-camera scheduler is included at this stage.
