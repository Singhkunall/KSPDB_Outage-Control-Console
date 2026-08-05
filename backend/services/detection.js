/**
 * detection.js
 *
 * The glue between "one telemetry packet arrived" and "a ticket exists".
 * Called by app.js after poleState.applyTelemetry() on every accepted packet.
 *
 * Flow for a single event:
 *  1. Only re-run detection for the DT the changed pole belongs to (cheap;
 *     avoids re-scanning the whole network on every heartbeat).
 *  2. Classify every pole under that DT: dark_confirmed / silent_ambiguous /
 *     live / no_device / never_reported.
 *  3. Build the "darkClassified" set localization.js expects (dark_confirmed
 *     + silent_ambiguous poles only -- live/no_device/never_reported are
 *     excluded from the dark set; never_reported is treated as unknown, not
 *     dark, since we have no evidence either way).
 *  4. Check scheduled outages for this DT/feeder. If one applies, we still
 *     run localization (so a real fault during a "cancelled but not marked"
 *     scheduled outage isn't silently dropped -- see scheduledOutages.js
 *     docstring) but tag+downgrade the resulting incidents.
 *  5. Hand off to localization.localizeFault(), then ticketStore to create
 *     tickets (which itself dedupes against already-open incidents).
 *  6. Also run ticketStore.checkRestoration() -- cheap enough to run on
 *     every event, and is how "poles came back -> ticket auto-verifies"
 *     actually happens.
 */
const registry = require('./registry');
const poleState = require('./poleState');
const scheduledOutages = require('./scheduledOutages');
const { localizeFault } = require('./localization');
const ticketStore = require('./ticketStore');

function buildDarkClassifiedForDt(dtId) {
    const dtPoles = registry.getDtPoles(dtId);
    const darkClassified = new Map(); // pole_id -> 'dark_confirmed' | 'silent_ambiguous'

    for (const pole of dtPoles) {
        const hasDevice = !!pole.device_id;
        const classification = poleState.classifyPole(pole.pole_id, hasDevice);
        if (classification === 'dark_confirmed' || classification === 'silent_ambiguous') {
            darkClassified.set(pole.pole_id, classification);
        }
        // 'live', 'no_device', 'never_reported' are not added -- they are
        // NOT treated as dark. 'never_reported' in particular is a pole we
        // have zero telemetry history for; absence of evidence isn't
        // evidence of an outage, so it can't anchor or join a fault group.
    }
    return darkClassified;
}

function applyScheduledOutageDowngrade(incidents) {
    return incidents.map(inc => {
        const applicable = scheduledOutages.findApplicableOutage({
            feederId: inc.feeder_id,
            dtId: inc.dt_id,
        });
        if (!applicable) return inc;

        return {
            ...inc,
            confidence: 'LOW',
            confidence_reason: `${inc.confidence_reason} NOTE: falls within scheduled outage ${applicable.id} ("${applicable.reason}"), window ${applicable.start} to ${applicable.end} (± grace buffer). Not auto-suppressed, since scheduled outages are sometimes cancelled without the feed updating -- flagged for quick operator review instead.`,
            possibly_scheduled: applicable.id,
        };
    });
}

/**
 * Entry point called from app.js after each accepted telemetry packet.
 * dtId: the DT of the pole that just changed state.
 */
function runDetectionForDt(dtId) {
    if (!dtId) return { incidents: [], newTickets: [], verifiedTickets: [] };

    const darkClassified = buildDarkClassifiedForDt(dtId);
    let incidents = localizeFault(darkClassified);
    incidents = applyScheduledOutageDowngrade(incidents);

    const newTickets = ticketStore.createTicketsFromIncidents(incidents);
    const verifiedTickets = ticketStore.checkRestoration();

    return { incidents, newTickets, verifiedTickets };
}

/**
 * For feeder-level faults, a single DT's local dark set isn't enough context
 * -- localization.js needs to see darkness across ALL DTs on that feeder to
 * decide "is this feeder-wide". Call this after runDetectionForDt when you
 * want the feeder-level check to have full visibility (e.g. periodically, or
 * after any DT-total-dark event). Kept separate so the common case (one span
 * fault on one DT) stays cheap.
 */
function runDetectionForFeeder(feederId) {
    const dts = registry.load().transformers.filter(dt => dt.feeder_id === feederId);
    const darkClassified = new Map();
    for (const dt of dts) {
        const dtDark = buildDarkClassifiedForDt(dt.dt_id);
        for (const [poleId, cls] of dtDark.entries()) darkClassified.set(poleId, cls);
    }

    let incidents = localizeFault(darkClassified);
    incidents = applyScheduledOutageDowngrade(incidents);

    const newTickets = ticketStore.createTicketsFromIncidents(incidents);
    const verifiedTickets = ticketStore.checkRestoration();

    return { incidents, newTickets, verifiedTickets };
}

module.exports = {
    runDetectionForDt,
    runDetectionForFeeder,
    buildDarkClassifiedForDt,
};