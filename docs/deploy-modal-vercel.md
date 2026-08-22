# Deploy the API to Modal and the dashboard to Vercel

This is the production checklist for the one-camera MVP. It deliberately
keeps one stateful GPU container (`max_containers=1`), one live tracker, and
one video-analysis job at a time.

## Runtime contract

- Vercel serves only `frontend/dist`.
- Modal serves only `/api/v1` and owns the T4 pipeline.
- Live camera uses `WebSocket /api/v1/webrtc/connect` for both non-trickle SDP
  signaling and metadata push. Keeping that socket open also keeps the Modal
  Function Call that owns aiortc alive. HTTP JPEG frames are fallback only.
- Video upload returns `202`; Modal spawns `Backend.run_video_job` with its own
  900-second Function Call while keeping the web request short. Job/result
  state is still in-memory demo state and is not durable across container
  replacement.
- Modal does not warm a model for `/health` or `/ready`. The live page starts
  one idempotent warmup only after the user starts the camera workflow.

## 1. Run local ship checks

From the repository root:

```powershell
.\.venv\Scripts\python.exe tools\prepare_production_assets.py
.\.venv\Scripts\python.exe -m unittest discover -s tests
Set-Location frontend
npm ci
npm run check:ship
Set-Location ..
```

The asset command verifies the manifest size and SHA-256 values without
downloading or running inference. `deploy/modal_app.py` repeats the integrity
check before building an image.

## 2. Reserve the Vercel production origin

Create the Vercel project with `frontend/` as its Root Directory. Keep the
framework preset as Vite. `frontend/vercel.json` pins `npm ci`, the ship check,
the `dist` output directory, immutable hashed-asset caching, and basic browser
security headers.

Use the stable production alias
`https://crowd-tracking-z317.vercel.app` for CORS. Do not add `*.vercel.app`:
wildcard origins are intentionally rejected. A preview deployment needs its
own exact origin or a stable preview/custom-domain alias.

## 3. Configure and deploy Modal

Create the required Modal Secret before deployment:

```powershell
.\.venv\Scripts\modal.exe secret create crowd-analytics-production FRONTEND_ORIGINS=https://crowd-tracking-z317.vercel.app
.\.venv\Scripts\modal.exe deploy deploy\modal_app.py
```

If the Secret already exists, update it in the Modal dashboard or rerun the
command with `--force`. Record the public HTTPS endpoint printed by `modal
deploy`; it becomes the frontend's `VITE_API_BASE_URL`.

For reliable mobile/4G/5G WebRTC, add a TURN relay to the same backend Secret.
With coturn `--use-auth-secret`, prefer temporary HMAC credentials:

```powershell
.\.venv\Scripts\modal.exe secret create crowd-analytics-production `
  FRONTEND_ORIGINS=https://crowd-tracking-z317.vercel.app `
  WEBRTC_TURN_SERVERS="turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp,turns:turn.example.com:5349?transport=tcp" `
  WEBRTC_TURN_SHARED_SECRET="replace-with-the-coturn-shared-secret" `
  WEBRTC_TURN_CREDENTIAL_TTL_SECONDS=3600 `
  --force
```

The `turn.example.com` host and shared secret above are placeholders. Do not
deploy them literally. Until a real TURN service is available, create the
Secret with only `FRONTEND_ORIGINS`; the application will use STUN first and
fall back to bounded JPEG frames over the lifecycle WebSocket.

Managed TURN providers that issue a username/password can instead use
`WEBRTC_TURN_USERNAME` and `WEBRTC_TURN_CREDENTIAL`. Never place either TURN
password or the coturn shared secret in `VITE_*`: Vite values are public build
assets. The browser obtains short-cached ICE entries from
`GET /api/v1/webrtc/ice-config`; STUN/direct candidates stay enabled, so relay
bandwidth is used only when ICE selects TURN.

The Modal profile uses:

- `API_WARM_ON_START=false` to avoid loading models for health checks;
- `FRONTEND_INCLUDE_LOCAL_ORIGINS=false` so production CORS contains only the
  exact Vercel origins from the Modal Secret;
- `WEBRTC_REQUIRE_LIFECYCLE_SOCKET=true` so detached POST-only peers fail fast;
- optional server-side TURN credentials exposed to the browser only as a
  short-lived ICE configuration, never as a frontend environment variable;
- spawned `run_warmup` and `run_video_job` methods for work that must outlive a
  short web request, without creating a second GPU pool;
- eight lightweight concurrent ASGI inputs for the long-lived socket, health,
  controls, and job polling, while GPU work remains capacity-bounded;
- a 180-second idle scale-down window to limit unused T4 time.

STUN works on many networks. Restrictive corporate/mobile NATs still require a
TURN provider and credentials; do not interpret HTTP fallback on those
networks as proof that the WebRTC implementation is broken.

## 4. Configure and deploy Vercel

Set this Production environment variable in the Vercel project:

```text
VITE_API_BASE_URL=https://your-workspace--crowd-analytics-mvp-web.modal.run
```

The build fails if this value is missing, non-HTTPS, or contains a path. Then
deploy from the Vercel dashboard/connected Git branch, or use the Vercel CLI
from `frontend/` if it is already installed and authenticated.

## 5. Smoke test without wasting GPU quota

1. Call `<MODAL_URL>/api/v1/health`; it must return `200` without warming.
2. Call `<MODAL_URL>/api/v1/ready`; it must return `200` when all assets and
   configs are present.
3. Open the Vercel site and start Live Monitor once. Browser Network should
   show one persistent `wss://.../api/v1/webrtc/connect`; the transport badge
   should read `webrtc`, and there should be no repeating `/frame` requests.
4. Move to Analytics and back. The same session ID and WebSocket should remain
   active.
5. Stop Live Monitor. Confirm the socket closes and the session delete is
   either `204` or already-cleaned `404`.
6. Upload one short video only after Live Monitor is stopped. Confirm the job
   reaches `completed` and the annotated MP4 plays before the idle container
   is allowed to scale down.

Do not run a model warmup or video inference as a generic uptime check. Use
`/health` and `/ready` for monitoring.
