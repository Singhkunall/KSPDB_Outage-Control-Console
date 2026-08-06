# Architecture

## Data flow
Pole device --(HTTPS POST /api/telemetry)--> Express backend
  -> poleState.js (per-device seq-based dedup/ordering, derives live/dark per pole)
  -> detection.js (rebuilds dark-pole set for the affected DT, checks scheduled outages)
  -> localization.js (finds live/dark boundary, classifies fault type, computes confidence)
  -> ticketStore.js (creates/dedupes tickets, checks telemetry for auto-restoration)
  -> React operator console (polls /api/tickets every 5s, renders map + incident list)

## Ingestion & de-duplication
- Ordering/dedup keys on (device_id, seq), never on device ts (clock skew is
  up to +/-90s per the brief, so ts is untrustworthy for ordering).
- At-least-once delivery is assumed; duplicate/stale seq values are accepted
  but ignored, not treated as errors.
- `boot` resets a device's seq counter; handled as a new epoch, not staleness.
- Devices going dark are represented as `silent_ambiguous` (haven't heard in
  >2x heartbeat interval, no firm power_lost) vs `dark_confirmed` (explicit
  power_lost/energized=false). This is what lets us tell a dead sensor
  (firmware 1.2.x never sends power_lost, just goes quiet) from a real fault.

## Topology representation
Each pole carries `dt_id` and `parent_pole_id`. Poles are indexed once at
startup (registry.js) into: byPoleId, byDt (dt_id -> poles), childrenOf
(parent_pole_id -> child poles). Localization walks this as a tree from each
DT's root pole(s) outward, rather than sorting by seq_on_line -- this
correctly handles branches/spurs, not just a single straight line.

## Localization algorithm
For a DT with recorded topology:
1. Filter out isolated dead sensors: a dark pole whose children are ALL live
   is a broken sensor, not a fault (a real line fault cannot leave a dark
   pole's downstream poles live).
2. If every pole under the DT is dark, classify as DT_FAULT (transformer/HT
   fuse level), not a guessed span.
3. Otherwise, walk the tree from DT root(s); every live-parent -> dark-child
   edge found is a separate SPAN_FAULT boundary. This naturally supports
   multiple simultaneous faults on different branches of the same DT.
4. If every DT under a feeder is fully dark, collapse into one FEEDER_FAULT
   incident instead of N separate DT incidents.

For a DT with NO recorded topology (~60% of DTs, per the brief):
We fall back to DT-zone localization: report the DT's coordinates and pole
count, explicitly labelled as topology-unknown, at MEDIUM confidence rather
than fabricating a span. We chose this over geometric inference from GPS
because our synthetic pole placement isn't laid out as a real line (poles
are scattered in a box around the DT, not walked along a path) -- so
distance-based inference would be guessing on top of guessing. A real
deployment could add geometric inference or outage-history-based topology
learning as a second pass; we scoped that out given the time budget and
documented it as a known limitation rather than building something we
couldn't validate.

Complexity: O(poles in the affected DT) per detection pass -- no quadratic
behavior, since the child index is built once at startup.

## Noise handling
- Scheduled outages are checked (mock feed, /scheduled-outages) but NOT used
  to silently suppress tickets, because the brief notes ~10% of scheduled
  outages are cancelled without the feed being updated. Instead, a fault
  inside a scheduled window is created as a ticket but confidence is
  downgraded to LOW and tagged with the outage ID, so a real fault during a
  cancelled-but-unmarked outage still surfaces instead of vanishing.
- silent_ambiguous poles are usable as boundary evidence (so a genuinely
  faulted line with one dead sensor near the boundary still gets detected)
  but downgrade the resulting incident's confidence to MEDIUM.
- Duplicate ticket creation is prevented by checking existing open tickets
  with the same type + location before creating a new one.

## Ticket lifecycle
detected -> acknowledged -> crew_assigned -> resolved -> verified -> closed.
'verified' cannot be set manually via PATCH -- it only happens when
ticketStore.checkRestoration() confirms every pole affected by that specific
incident is reporting live via telemetry. A manual attempt to force
verified/closed out of order is rejected with 409, not silently accepted.

## API surface
| Method | Path | Purpose |
|---|---|---|
| POST | /api/telemetry | Real ingestion endpoint |
| POST | /api/simulate/fault | Simulator: synthesizes realistic telemetry (incl. message loss, fw 1.2.x silence) and pushes it through the same ingestion path |
| POST | /api/simulate/repair | Simulator: sends restoration telemetry for a ticket's affected poles |
| GET | /api/tickets | List all tickets |
| GET | /api/tickets/:id | Single ticket |
| PATCH | /api/tickets/:id/status | Manual lifecycle transitions (verified/closed are telemetry-gated) |
| GET | /scheduled-outages | Mock scheduled outage feed |
| POST | /api/simulate/scheduled-outage | Inject a scheduled outage window for testing |
| GET | /api/network/summary | DT/feeder list, for the simulator UI |
| GET | /api/network/dt/:dtId/poles | Poles under a DT, for the simulator UI |

## UI reasoning
Information hierarchy: status bar (open count, worst severity) -> incident
list (sorted by confidence then recency) -> map -> full detail only on
click. Each incident card shows a "boundary strip" -- a small live/dark
visual of the actual fault boundary -- so severity/type is readable without
opening the ticket. Deliberately excluded: raw per-device telemetry feed,
historical charts, crew routing -- out of scope per the brief.

## AI feature
The fault simulator's telemetry synthesis (message-loss modelling,
firmware-1.2.x behavior) and doc drafting were AI-assisted, but the
core localization decision-making is deliberately NOT LLM-based -- it's a
deterministic tree traversal, which is instant, free, explainable, and
testable, unlike an LLM call. We considered an LLM-backed feature for
turning a ticket's structured fields into a plain-language summary line for
the operator (e.g. "span fault near P-0234, 12 homes affected, medium
confidence due to a silent sensor at the boundary") but did not implement
it in the time available; documented as a "what we'd do next" item in
DECISIONS.md rather than building it without validating cost/latency.
