# REST API contract

The executable schema is exposed by FastAPI at `/openapi.json` and `/docs`.
The response models live in `src/api/contracts.py`; the matching browser
types live in `frontend/src/api/contracts.ts`.

## Browser origin policy

FastAPI is an API-only service. It does not serve the React bundle or a root
frontend redirect. CORS allows `http://localhost:3000` and
`http://127.0.0.1:3000` by default. Production deployments must set
`FRONTEND_ORIGINS` to a comma-separated list of deployed frontend origins;
wildcard (`*`) origins are rejected.

## Stable envelopes

Session endpoints return:

```json
{
  "status": "created|active|reset",
  "session": {
    "id": "demo_abc123",
    "mode": "default",
    "camera_id": "browser-camera",
    "created_at": "2026-08-17T00:00:00+00:00",
    "last_used_at": "2026-08-17T00:00:00+00:00",
    "expires_in_seconds": 600,
    "status": "active"
  }
}
```

`GET /api/v1/sessions/{id}/stats` returns one complete snapshot with
`status`, `session`, optional `frame`, optional `analytics`, and
`live_stream` telemetry.

`POST /api/v1/sessions/{id}/frame` returns:

```json
{
  "status": "accepted",
  "sequence": 12,
  "result_sequence": 11,
  "analytics": {},
  "overlay": {
    "coordinate_space": "processed_frame",
    "frame_size": [640, 480],
    "tracks": []
  }
}
```

`overlay` is a top-level field. The backend intentionally does not return an
`annotated_frame` image; the browser keeps the raw video local and draws the
metadata overlay. The optional `after_sequence` query parameter suppresses a
stale result when no newer worker result is available.

The overlay may also contain compact `zones` and `seats` polygons, plus
per-track `motion` and `trajectory` metadata. Coordinates are always in the
`processed_frame` coordinate space described by `frame_size`.

For deployments with the optional `aiortc` runtime, the browser can use
`POST /api/v1/webrtc/offer` with a complete non-trickle SDP offer. The response
contains `session_id`, an SDP answer, and `ice_mode: "non_trickle"`. The React
live monitor exposes this as an optional transport and falls back to HTTP
frames when the WebRTC runtime or negotiation is unavailable.

## Session classroom configuration

`PATCH /api/v1/sessions/{id}/layout` updates only the active session's
`template`, `rows`, and `disabled_seats`. `PATCH /api/v1/sessions/{id}/calibration`
stores paired `floor_points_px`/`floor_points_m` correspondences (at least four
points). Both return `{status: "updated", session, classroom}`. The worker
serializes these mutations with inference, preserving tracker/person IDs and
avoiding a model reload. Configuration is session-scoped; it is not written
back to YAML automatically.
The current engine records and validates these correspondences; it does not yet
derive a homography or replace the configured `visible_floor_area_m2` from them.

## Error envelope

Application errors use one shape regardless of status code:

```json
{
  "detail": {
    "code": "live_session_capacity_reached",
    "message": "Close the existing session first."
  }
}
```

The React client converts this into `CrowdApiError`, preserving HTTP status,
machine-readable code, message, and the raw payload. Network failures,
cancellation and timeout are represented separately and are never converted
into fake/demo data.

## Client rules

- Use `frontend/src/api/crowdApi.ts`; do not call `fetch` directly from pages.
- Use same-origin `/api` in development through the Vite proxy.
- Close a session with `DELETE /api/v1/sessions/{id}` when the owning flow is
  stopped. The React `LivePage` owns this lifecycle and performs best-effort
  cleanup even when camera startup or a frame request fails.
- Treat analytics sections as extensible; rely on the explicit envelope fields
  for lifecycle and transport state.
