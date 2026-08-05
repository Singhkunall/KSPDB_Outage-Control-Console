# KSPDB Outage Detection and Localization System

A real-time fault detection and localization platform built for the Karnataka State Power Distribution Board (KSPDB)[cite: 2]. This system ingests pole-level telemetry, performs deterministic fault boundary detection, groups multiple dark poles into single incidents, and displays actionable alerts on an operator console.

## Quick Start (One Command)
Ensure you have Docker and Docker Compose installed, then run:
```bash
docker compose up --build

*B. Paste this into `ARCHITECTURE.md`:**
```markdown
# Architecture Overview

## Data Flow
Pole Device ──(HTTPS/Telemetry)──> Express Backend ──> Localization Engine ──> Incident / Ticket Store ──> Operator Console (React)

## Key Components
- **Ingestion & De-duplication:** Handles at-least-once delivery, sequence ordering (`seq`), and bursts[cite: 3, 4].
- **Localization Algorithm:** Uses graph/spatial traversal and handles the 60% missing topology case by falling back to transformer-level zone inference[cite: 3, 5].
- **Noise Filtering:** Distinguishes line faults from dead sensors and scheduled maintenance[cite: 3, 4].# KSPDB_Outage-Control-Console
