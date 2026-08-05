/**
 * ticketStore.js
 *
 * Owns the ticket lifecycle: detected -> acknowledged -> crew_assigned ->
 * resolved -> verified -> closed.
 *
 * Key rule from the brief: restoration must be verified from telemetry, not
 * from a button click. We enforce this here, not just hope the caller
 * checks first:
 *   - A human can freely move a ticket through detected -> acknowledged ->
 *     crew_assigned -> resolved (these are "the crew says they did the work"
 *     states, and the brief is explicit that dispatch/crew work is the
 *     department's job, not something we verify).
 *   - Moving from resolved -> verified is NOT allowed via manual PATCH.
 *     It only happens when checkRestoration() confirms, from live telemetry,
 *     that every pole downstream of the incident is live again.
 *   - If a human PATCHes straight to 'verified' or 'closed' without that
 *     telemetry check having passed, we reject with 409 (see app.js).
 */
const registry = require('./registry');
const poleState = require('./poleState');

const LIFECYCLE = ['detected', 'acknowledged', 'crew_assigned', 'resolved', 'verified', 'closed'];

let tickets = new Map(); // incident_id -> ticket

function createTicketsFromIncidents(incidents) {
    const created = [];
    for (const inc of incidents) {
        if (isDuplicateOfOpenTicket(inc)) continue;
        const ticket = {
            ...inc,
            status: 'detected',
            created_at: new Date().toISOString(),
            resolved_at: null,
            verified_at: null,
            closed_at: null,
            // affected_pole_ids is needed so restoration checks know exactly
            // which poles to look at -- recompute from the incident shape.
            affected_pole_ids: resolveAffectedPoleIds(inc),
        };
        tickets.set(ticket.incident_id, ticket);
        created.push(ticket);
    }
    return created;
}

function resolveAffectedPoleIds(inc) {
    if (inc.type === 'SPAN_FAULT' && inc.failed_span) {
        const childId = inc.failed_span.split(' -> ')[1];
        const { collectDownstream } = require('./localization');
        return collectDownstream(childId).map(p => p.pole_id);
    }
    if (inc.dt_id) {
        return registry.getDtPoles(inc.dt_id).map(p => p.pole_id);
    }
    if (inc.feeder_id) {
        const dts = registry.load().transformers.filter(dt => dt.feeder_id === inc.feeder_id);
        return dts.flatMap(dt => registry.getDtPoles(dt.dt_id).map(p => p.pole_id));
    }
    return [];
}

/**
 * Avoid creating a second ticket for a fault that's already open and covers
 * the same span/DT/feeder. Cheap heuristic: same type + same key location
 * (failed_span, or dt_id, or feeder_id) with an ticket not yet closed.
 */
function isDuplicateOfOpenTicket(inc) {
    for (const t of tickets.values()) {
        if (t.status === 'closed') continue;
        if (t.type !== inc.type) continue;
        if (inc.failed_span && t.failed_span === inc.failed_span) return true;
        if (inc.dt_id && t.dt_id === inc.dt_id && !inc.failed_span) return true;
        if (inc.feeder_id && t.feeder_id === inc.feeder_id && !inc.dt_id) return true;
    }
    return false;
}

function getAllTickets() {
    return Array.from(tickets.values());
}

function getTicket(id) {
    return tickets.get(id) || null;
}

/**
 * Manual status transition (operator action via PATCH). Rejects any attempt
 * to set 'verified' or 'closed' directly -- those require telemetry
 * confirmation via checkRestoration(). 'closed' is allowed manually ONLY
 * from 'verified' (operator closing out an already-verified ticket).
 */
function setStatus(id, newStatus) {
    const ticket = tickets.get(id);
    if (!ticket) return { ok: false, error: 'not_found' };
    if (!LIFECYCLE.includes(newStatus)) return { ok: false, error: 'invalid_status' };

    if (newStatus === 'verified') {
        return { ok: false, error: 'verified_requires_telemetry', message: 'Ticket can only move to verified when live telemetry confirms all affected poles are energized again. It cannot be set manually.' };
    }
    if (newStatus === 'closed' && ticket.status !== 'verified') {
        return { ok: false, error: 'must_verify_before_close', message: 'Ticket must be verified (telemetry-confirmed) before it can be closed.' };
    }

    ticket.status = newStatus;
    tickets.set(id, ticket);
    return { ok: true, ticket };
}

/**
 * Called after telemetry changes. Checks every open ticket (status
 * 'resolved' or earlier, not yet verified) to see if ALL of its
 * affected_pole_ids are now live. Only those tickets get moved to
 * 'verified' -- this is what makes restoration telemetry-driven rather than
 * "restore any pole and everything gets marked fixed."
 *
 * Note: we check tickets in 'resolved' status primarily (crew claims done),
 * but we also auto-verify tickets still in earlier states if telemetry
 * shows genuine restoration -- the brief's priority is "trust the poles,"
 * not "trust the ticket status," so we don't gate this on the crew having
 * clicked 'resolved' first.
 */
function checkRestoration() {
    const verifiedNow = [];
    for (const ticket of tickets.values()) {
        if (ticket.status === 'verified' || ticket.status === 'closed') continue;
        if (!ticket.affected_pole_ids || ticket.affected_pole_ids.length === 0) continue;

        const registryData = registry.load();
        const allLive = ticket.affected_pole_ids.every(poleId => {
            const pole = registryData.byPoleId.get(poleId);
            const hasDevice = !!(pole && pole.device_id);
            const classification = poleState.classifyPole(poleId, hasDevice);
            // no_device poles can't confirm or deny -- don't let them block
            // verification forever; treat as non-blocking.
            if (classification === 'no_device') return true;
            return classification === 'live';
        });

        if (allLive) {
            ticket.status = 'verified';
            ticket.verified_at = new Date().toISOString();
            tickets.set(ticket.incident_id, ticket);
            verifiedNow.push(ticket);
        }
    }
    return verifiedNow;
}

function reset() {
    tickets = new Map();
}

module.exports = {
    LIFECYCLE,
    createTicketsFromIncidents,
    getAllTickets,
    getTicket,
    setStatus,
    checkRestoration,
    reset,
};