# Frontend migration baseline

## Source ownership

- `frontend/` is the only React/TypeScript/Vite frontend source of truth.
- FastAPI is API-only and does not mount frontend files.
- `frontend/dist` is a generated deployment artifact for Vercel/Netlify.

## Local topology

```text
browser :3000 or deployed FE origin
        │ VITE_API_BASE_URL (or local /api proxy)
        ▼
FastAPI :8000 (API only)
        ├── /api/v1/health
        ├── /api/v1/ready
        ├── /api/v1/sessions/...
        │   ├── /layout
        │   └── /calibration
        ├── /api/v1/webrtc/connect (lifecycle WebSocket)
        ├── /api/v1/webrtc/offer (self-hosted compatibility)
        ├── /api/v1/sessions/{id}/metadata (compatibility WebSocket)
        └── /api/v1/video
            ├── /analyze (submit job)
            ├── /jobs/{id} (status/result)
            └── /artifacts/{id} (annotated MP4)
```

The React dev server now uses same-origin `/api` requests. The proxy target is
configured with `VITE_API_PROXY_TARGET`; `VITE_API_BASE_URL` is reserved for an
intentional cross-origin deployment.

## Stage 0 gates

- Frontend files are inside the backend Git repository.
- `frontend/package-lock.json` is retained for reproducible installs.
- Generated dependencies/build output are ignored by the repository.
- `npm run check:workspace` passes without downloading packages.
- The Python environment is diagnosed before running model or API tests; the
  existing local `.venv` must be recreated if its `pyvenv.cfg` points to a
  machine-specific Python installation that is no longer available.

## Deployment gates

The backend has no `/`, `/app`, `/static`, or `/assets` frontend surface.
Deploy the frontend from the `frontend/` root and configure
`VITE_API_BASE_URL`; deploy the backend from the repository root with the
existing FastAPI/Docker/Modal setup and configure exact `FRONTEND_ORIGINS`.
The ordered production checklist is in
[deploy-modal-vercel.md](deploy-modal-vercel.md).

Stage 1 adds the first contract layer without switching the deployed client:
see [docs/api-contract.md](api-contract.md).

Stage 2 now owns a browser session from `LivePage`: camera start creates one
session after access succeeds, camera stop deletes it, and expired sessions
stop the loop. The dashboard also maps backend live-stream telemetry and
analytics into view models without demo fallbacks.

Stage 3 adds a metadata canvas overlay for tracks, motion, zones, and seats;
uses WebRTC as a send-only camera ingest path, pushes result envelopes over the
same lifecycle WebSocket used for signaling, and keeps the raw camera local.
The older HTTP-frame path is retained only as a bounded fallback when initial
WebRTC negotiation/runtime is unavailable.

Stage 4 removes dashboard-only demo values. Analytics now renders the
backend's dynamic zone list and bounded heatmap grid, preserves explicit
uncalibrated/null states, and derives room area/capacity from the classroom
analytics envelope. Overview no longer assumes a 64 m² room or a fixed
equilibrium score.

Stage 5 connects Room Setup to the live `classroom_demo` session. The layout
editor reads template blocks/rows from `/stats`, toggles disabled seats using
backend seat identifiers, and saves through the session layout endpoint. The
calibration tab collects four reference-frame points plus floor dimensions and
saves them through the session calibration endpoint. Editing is disabled when
no live session exists, so the UI cannot silently mutate a different camera or
global profile.

Stage 6 separates deployment boundaries: React builds to `frontend/dist` with
root-relative assets and deploys independently, while FastAPI serves only
`/api/v1` with explicit CORS origins. Tracker compatibility helpers were also
restored for legacy ByteTrack/Deep OC-SORT profiles, including private ReID
YAML materialization and actionable missing-checkpoint/runtime errors.
