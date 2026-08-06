# Deployment

## Prerequisites
- Docker + Docker Compose (for local run)
- Node.js 18+ (only needed if running services outside Docker)

## Local: one-command start
```bash
git clone <this repo>
cd Propel
docker compose up --build
```
- Backend: http://localhost:3000
- Frontend: http://localhost:5173
- Data is seeded automatically on first boot (synthetic poles/transformers).

## Environment variables
| Variable | Where | Required | Default | Purpose |
|---|---|---|---|---|
| PORT | backend | No | 3000 | Backend listen port |
| FRONTEND_URL | backend (deployed) | No | * (all origins) | Restricts CORS to the deployed frontend origin |
| VITE_API_BASE_URL | frontend | Yes for deployed builds | http://localhost:3000 | Backend URL the frontend talks to. Baked in at BUILD time (Vite), not runtime -- must be set before `npm run build` / before the Vercel build step |

Commit a `.env.example` in both `backend/` and `frontend/` reflecting these.

## Manual (non-Docker) run
```bash
cd backend && npm install && npm start
cd frontend && npm install && npm run dev
```

## Deployed (public) hosting
- Backend: Render (Node web service), root directory `backend`, build
  `npm install`, start `npm start`. Free tier cold-starts after inactivity
  (~30-60s) -- noted in README so a reviewer doesn't assume it's broken.
- Frontend: Vercel, root directory `frontend`, build `npm run build`,
  output `dist`. `VITE_API_BASE_URL` set to the Render backend URL in
  Vercel's project environment variables before building.

## Verifying it worked
1. Open the frontend URL. You should see "KSPDB -- Outage Control Console"
   with an empty incident list (no errors in the browser console).
2. Use the simulator panel to inject a DT fault. A ticket should appear in
   the list within a few seconds.
3. `curl <backend-url>/health` should return `{"status":"healthy",...}`.

## Troubleshooting
- **CORS error in browser console**: backend needs `app.use(cors())`
  (or restricted to `FRONTEND_URL`) registered before routes in server.js.
- **react-leaflet peer dependency conflict on `npm install`**: this repo
  uses React 18; install `react-leaflet@4.2.1` specifically, not latest
  (latest requires React 19). Do not use `--legacy-peer-deps` to force it.
- **Frontend shows stale/wrong backend URL after changing .env**: Vite
  bakes `VITE_API_BASE_URL` in at build time. Changing `.env` requires a
  rebuild (`npm run build` or a fresh Vercel deploy), not just a restart.
- **`ERESOLVE` / dependency tree errors on `npm install`**: check for a
  version mismatch between an added package and existing React version
  before forcing with `--force`.
- **Backend crashes with "X is not defined"**: a `require(...)` was
  removed or never added for a used package (e.g. `cors`) -- check the
  top of `server.js` against actual usage.
- **`docker compose up` fails to find data files**: confirm
  `backend/services/seed.js` writes to `../data`, matching the actual
  `backend/services -> backend/data` folder structure, not a stale
  `../../data` path from an earlier scaffold.
- **Port already in use**: another process is bound to 3000 or 5173;
  stop it or change `PORT` / Vite's dev port.

## Resetting to a clean state
```bash
docker compose down -v
rm -rf backend/data/*.json   # forces re-seed on next boot
docker compose up --build
```
