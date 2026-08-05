/**
 * scheduledOutages.js
 *
 * Mocks the department's scheduled outage feed (GET /scheduled-outages) and
 * provides the check detection.js uses to decide "is this darkness explained
 * by a planned shutdown, or is it a real fault."
 *
 * Important per 02-data-and-systems.md §4: this feed is NOT gospel.
 * - Shutdowns start late / overrun by 20-40 min routinely.
 * - ~1 in 10 is cancelled without the feed being updated.
 * Treating it as authoritative would cause us to miss real faults that occur
 * during a window where nothing was actually switched off, and to suppress
 * real tickets past the stated end time.
 *
 * Our mitigation (documented choice, not the only valid one):
 * - Apply a grace buffer around [start, end] (default 40 min each side) so we
 *   don't fight the "starts late / overruns" reality.
 * - We do NOT suppress a ticket purely because it falls inside a scheduled
 *   window -- we DOWNGRADE it: mark it as "possibly explained by scheduled
 *   outage SO-xxxx" and lower confidence, rather than dropping it silently.
 *   This protects against the ~10% cancelled-but-not-marked case: a real
 *   fault during a "scheduled" outage still becomes a low-confidence ticket
 *   an operator can glance at and dismiss in seconds, instead of vanishing.
 */

const GRACE_MS = 40 * 60 * 1000; // 40 min either side of stated window

// Mock data, seeded fresh on each server start. In production this would be
// a real GET to the department's feed; see ARCHITECTURE.md for the adapter note.
let scheduledOutages = [];

function seedScheduledOutages(feederIds = [], dtIds = []) {
    scheduledOutages = [];
    // Not required for every demo run -- callers can also POST new ones via
    // the mock endpoint below to drive specific test scenarios.
}

/** Mimics GET /scheduled-outages?from=&to= -- simple range filter. */
function getScheduledOutages({ from, to } = {}) {
    if (!from || !to) return scheduledOutages;
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    return scheduledOutages.filter(so => {
        const s = new Date(so.start).getTime();
        const e = new Date(so.end).getTime();
        return s <= toMs && e >= fromMs;
    });
}

function addScheduledOutage(so) {
    scheduledOutages.push(so);
    return so;
}

/**
 * Returns the matching scheduled outage (with grace window applied) covering
 * this feeder/dt at this moment, or null if none applies.
 * Does NOT distinguish "confirmed happening" from "merely scheduled" --
 * caller decides how to weight that; see module docstring.
 */
function findApplicableOutage({ feederId, dtId, atTime = new Date() }) {
    const atMs = atTime.getTime();
    return scheduledOutages.find(so => {
        const matchesScope =
            (so.scope === 'feeder' && so.target_id === feederId) ||
            (so.scope === 'dt' && so.target_id === dtId);
        if (!matchesScope) return false;

        const startMs = new Date(so.start).getTime() - GRACE_MS;
        const endMs = new Date(so.end).getTime() + GRACE_MS;
        return atMs >= startMs && atMs <= endMs;
    }) || null;
}

module.exports = {
    seedScheduledOutages,
    getScheduledOutages,
    addScheduledOutage,
    findApplicableOutage,
    GRACE_MS,
};