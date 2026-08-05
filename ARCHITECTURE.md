# System Architecture

## Overview
The KSPDB Outage Control Console is architected as a microservices-ready distributed system designed to handle live/dark pole telemetry ingestion, resilient topology inference under missing data, and real-time operator ticket management.

## Component Breakdown
* **Telemetry Ingestion Engine:** Handles high-throughput, at-least-once telemetry packets with deduplication and clock skew handling ($\pm 90\text{s}$).
* **Deterministic Localization Service:** Employs graph traversal and spatial logic (non-LLM) to map live/dark boundaries, filtering out dead sensors and scheduled outages.
* **Backend API Layer:** Built with Node.js and Express to manage state machines, ticket correlation, and restoration verification.
* **Operator Console Frontend:** Built with React and Vite to deliver a responsive, low-latency single-page application dashboard.
* **Fault Simulator:** Generates realistic telemetry streams modeling various failure signatures (span breaks, blown fuses, dead sensors).

## Data Flow
1. Telemetry packets are sent by poles/simulators to the ingestion pipeline.
2. The engine normalizes timestamps, handles retries, and updates pole state models.
3. The localization service evaluates the topological boundary to detect faults and group symptoms into unified tickets.
4. Operators view and manage verified incidents through the React console interface.
