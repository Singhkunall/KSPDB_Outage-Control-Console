# KSPDB Outage Detection & Localization Console

A fault detection and localization system built for the Karnataka State
Power Distribution Board (KSPDB) -- a fictional but realistically modelled
ESCOM. Domestic supply-line faults currently take the department's control
room around two hours to locate, because the only telemetry available is
"is this pole energized or not" -- there is no sensor on the wire itself.

This system ingests that pole-level telemetry, infers where on the network a
fault actually is (down to a specific span of wire where topology is known),
groups the resulting symptoms into a single incident instead of one alert
per dark pole, and tracks each fault through a ticket lifecycle that is only
closed once telemetry -- not a person clicking a button -- confirms the
poles are live again.

## What's here

- **`backend/`** -- Express API: telemetry ingestion, pole state tracking,
  fault detection and localization, ticket lifecycle, and a telemetry
  simulator.
- **`frontend/`** -- React operator console: incident list, map, ticket
  detail, and a UI to drive the fault simulator.
- **`docker-compose.yml`** -- brings up both services together.

## Quick start (one command)

Requires Docker and Docker Compose installed. From the repo root:

```bash
docker compose up --build
```

This will:
- Install and start the backend on `http://localhost:3000`
- Install and start the frontend on `http://localhost:5173`
- Seed a synthetic pole/transformer network on first boot -- no manual data
  loading step

Open `http://localhost:5173` in a browser. You should see the operator
console with an empty incident list and a fault simulator panel. Use the
simulator to inject a span, transformer, or feeder fault and watch a ticket
appear, localized, within seconds.

## Live deployment

- **Public app:** `[PASTE YOUR VERCEL URL HERE]`
- **Public backend API:** `[PASTE YOUR RENDER URL HERE]`
- **Demo video:** `[PASTE YOUR LOOM/YOUTUBE/DRIVE LINK HERE]`

> The backend is hosted on Render's free tier, which cold-starts after a
> period of inactivity. If the app looks like it's not loading tickets on
> first open, wait 30-60 seconds for the backend to wake up and refresh.

## Other documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) -- data flow, the localization
  algorithm, how the missing-topology problem is handled, noise/false-positive
  handling, API surface, and UI reasoning.
- [`DEPLOYMENT.md`](DEPLOYMENT.md) -- environment variables, exact deploy
  steps, and a troubleshooting section for the failure modes actually hit
  while building this.
- [`DECISIONS.md`](DECISIONS.md) -- a running log of design decisions,
  documented assumptions, and known gaps.
- [`AI-WORKFLOW.md`](AI-WORKFLOW.md) -- which AI tools were used, what was
  delegated versus written by hand, and where AI output was wrong and had to
  be caught.

## Running tests

```bash
cd backend
npm install
npm test
```

Tests cover the localization logic specifically -- known topologies (linear,
branching, missing-topology, feeder-wide) against expected fault
classification and span output. See `backend/tests/localization.test.js`.
