# Crowd Tracking frontend

This is the React/Vite dashboard for the `crowd_tracking` FastAPI project. It
is now stored at `frontend/` inside the backend repository so the two codebases
can be versioned and reviewed together.

## Local development

Start the FastAPI API from the repository root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn src.api.app:create_api_app --factory --host 127.0.0.1 --port 8000
```

In a second terminal, run the dashboard:

```powershell
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:3000/` in development.

The browser uses same-origin `/api` requests. Vite proxies them to
`http://127.0.0.1:8000` by default; override the target in `.env.local` with
`VITE_API_PROXY_TARGET` when needed. Set `VITE_API_BASE_URL` only when the API
is intentionally hosted on a different origin.

## Baseline commands

```powershell
npm run check:workspace
npm run lint
npm run build
```

`check:workspace` uses only Node's standard library and does not require
`node_modules`. The lint and build commands require `npm ci` first.

## Migration status

`frontend/` is the only frontend source of truth. The production build is
written to `frontend/dist` and can be uploaded directly to Vercel or Netlify.
Set `VITE_API_BASE_URL` to the public FastAPI origin in the hosting provider's
environment settings; do not rely on backend static-file hosting. Dashboard
pages and the Recharts radar panel are code-split, so the initial entry chunk
stays small and optional pages load on demand.

See [docs/frontend-migration.md](../docs/frontend-migration.md) for the
current ownership model, environment assumptions, and next migration gates.
