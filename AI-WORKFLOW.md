# AI Workflow

## Tools used
Claude (via chat/code assistance) for the majority of the backend
detection/localization pipeline, the React operator console components,
and drafting these docs. Used interactively -- reviewed and corrected
output at each step rather than accepting large blocks unchecked.

## What was delegated vs. reviewed by hand
Delegated: boilerplate (Express route wiring, React component scaffolding,
CSS), the telemetry simulator's message-loss modelling, first drafts of
all five markdown docs.
Reviewed/corrected by hand: the localization algorithm's core logic
(dead-sensor filtering rule, DT-vs-span-vs-feeder classification, the
missing-topology fallback decision) -- these required understanding the
physical network model in the brief, not just generating code that
compiles. Verified with a hand-built test suite (localization.test.js)
against known topologies before trusting the logic.

## Cases where AI output was wrong or had to be thrown away
1. An early version of the localization function only found the FIRST
   live/dark boundary under a DT and stopped -- it would have merged two
   genuinely separate simultaneous faults into one ticket, or silently
   dropped the second one. Caught by writing a branching-topology test case
   with two independent faults and seeing it fail (initially returned 1
   incident instead of 2).
2. An early ticket-restoration endpoint accepted a list of pole_ids but
   never actually checked them against the ticket -- it verified EVERY open
   ticket regardless of which poles were restored. This directly
   contradicted the brief's "verified from telemetry, not a button click"
   requirement and was caught by re-reading the endpoint's own code against
   the stated requirement, not by a test (there wasn't one at that point --
   the fix included adding checkRestoration() with real per-ticket pole
   checks).
3. A default PIN code fallback (a hardcoded literal) was used for any pole
   missing a PIN, which would silently report a wrong real-world PIN code
   for unrelated poles. Caught during a targeted code review pass, not by
   the AI flagging it -- it looked reasonable at a glance and required
   checking it against the actual requirement (report unknown rather than
   fabricate).

## Roughly how much of the final code is AI-assisted
Majority of the initial code was AI-drafted; core algorithmic decisions
(what counts as a boundary, what counts as noise, the missing-topology
strategy) were specified by us and verified against tests, not accepted
as-is.

## Best prompt/session excerpt
Asking for the localization rewrite specifically requested: dead-sensor
filtering using children-still-live as the disqualifying signal, DT-total-
dark as a distinct case from a span guess, and multiple boundaries per DT
supported via tree traversal rather than a flat sorted list -- then
verifying each requirement against a dedicated test case before accepting
the rewrite.
