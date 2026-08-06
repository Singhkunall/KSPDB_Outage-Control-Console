# Decision Log
(newest first)

## Localization approach for the 60% missing-topology case
Chose: fall back to DT-zone localization (report DT coordinates + pole
count, explicitly labelled "topology unknown", MEDIUM confidence) rather
than geometric inference from GPS coordinates.
Rejected: inferring line order from pole GPS distance, because our
synthetic pole placement scatters poles in a box around the DT rather than
laying them out along an actual line path -- geometric inference would be
guessing on top of a guess, and we'd rather report an honest coarser answer
than a false-precision wrong one.
Known gap: seed data does not generate branching topology (spurs) or
realistic line geometry -- the localization algorithm itself supports
branches (tree traversal via parent_pole_id, tested against a hand-built
branching topology in localization.test.js), but the synthetic data
generator does not yet produce them.

## Scheduled outages: downgrade instead of suppress
Chose: a fault whose DT/feeder falls inside a scheduled outage window still
becomes a ticket, but at LOW confidence with the outage ID attached.
Rejected: silently suppressing any ticket inside a scheduled window.
Reasoning: the brief states ~1 in 10 scheduled outages are cancelled
without the feed being updated -- full suppression would systematically
hide real faults during exactly those windows.

## Fault simulator drives real telemetry, not a shortcut
Chose: /api/simulate/fault synthesizes realistic packets (including ~30%
lost power_lost messages and firmware-1.2.x silent devices) and pushes them
through the same ingestion path a real device would use.
Rejected (earlier draft): an endpoint that accepted a raw list of
dark_pole_ids and called the localization function directly, bypassing
ingestion entirely. Changed because it meant the ingestion/detection layer
was never actually exercised by "testing" the system.

## Ticket verification is telemetry-gated, not button-gated
'verified' and 'closed' cannot be set via manual PATCH; verified only
happens when telemetry confirms every pole tied to that specific incident
is live again. A manual attempt returns 409 with an explanation.

## Stack
Node/Express backend (fast to iterate, simple JSON handling), React + Vite
frontend, Leaflet + OpenStreetMap tiles for the map (free, no API key
needed for a public reviewer to open the deployed URL).

## What we'd do with two more weeks
- Generate branching, geometrically realistic synthetic topology so the
  60%-missing-topology fallback could be compared against a geometric-
  inference approach on real-shaped data.
- An LLM-backed plain-language ticket summary for the operator (see
  ARCHITECTURE.md "AI feature") -- not built, to avoid shipping an
  unvalidated cost/latency dependency under time pressure.
- Persistent storage (currently in-memory; state resets on backend
  restart) -- fine for this exercise's scope but not production-real.
- Tighter test coverage around ticketStore's restoration-matching logic,
  not just localization.

## Known current gaps / fragile areas
- In-memory storage only; no database.
- Seed data topology is a straight chain per DT, no spurs.
- Simulator UI assumes the network summary loads before allowing fault
  injection; no explicit loading/error state if that call fails.
