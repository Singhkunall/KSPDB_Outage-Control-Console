const express = require('express');
const { seedRegistryData } = require('./services/seed');
const poleState = require('./services/poleState');
const detection = require('./services/detection');
const ticketStore = require('./services/ticketStore');
const scheduledOutages = require('./services/scheduledOutages');
const registry = require('./services/registry');
const simulator = require('./services/telemetrySimulator');
const cors = require('cors');
seedRegistryData();
registry.load(); // build indices once at startup

const app = express();
app.use(cors()); 
const PORT = process.env.PORT || 3000;
app.use(express.json());

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

/**
 * 1. Real ingestion endpoint. This is the ONLY path that updates pole state
 * and triggers detection -- the simulator (below) synthesizes packets and
 * pushes them through this exact same handler logic, it does not bypass it.
 */
function handleTelemetry(payload) {
    if (!payload.device_id || !payload.pole_id || !payload.event || typeof payload.seq !== 'number') {
        return { status: 400, body: { error: 'Invalid telemetry payload structure' } };
    }

    const result = poleState.applyTelemetry(payload);
    if (!result.applied) {
        // Duplicate/stale/malformed -- accepted-but-ignored, not an error.
        // At-least-once delivery means this is the common, expected case.
        return { status: 202, body: { status: 'accepted', applied: false, reason: result.reason, seq: payload.seq } };
    }

    let detectionResult = { incidents: [], newTickets: [], verifiedTickets: [] };
    if (result.changed) {
        const pole = registry.getPole(payload.pole_id);
        if (pole) {
            detectionResult = detection.runDetectionForDt(pole.dt_id);
        }
    } else {
        // Even without a state flip (e.g. a routine heartbeat), still worth
        // checking restoration cheaply -- covers the case where this
        // heartbeat is the corroborating signal that flips confidence, not
        // the state, of an already-open low-confidence ticket. Kept minimal
        // here; see DECISIONS.md for what we didn't build out further.
        ticketStore.checkRestoration();
    }

    return {
        status: 202,
        body: {
            status: 'accepted',
            applied: true,
            state_changed: result.changed,
            new_tickets: detectionResult.newTickets.length,
            auto_verified: detectionResult.verifiedTickets.length,
            seq: payload.seq,
        },
    };
}

app.post('/api/telemetry', (req, res) => {
    const result = handleTelemetry(req.body);
    res.status(result.status).json(result.body);
});

/**
 * 2. Scheduled outages mock feed + a way to inject one for testing the
 * "must not fire on load shedding" self-check.
 */
app.get('/scheduled-outages', (req, res) => {
    const { from, to } = req.query;
    res.status(200).json(scheduledOutages.getScheduledOutages({ from, to }));
});

app.post('/api/simulate/scheduled-outage', (req, res) => {
    const so = scheduledOutages.addScheduledOutage(req.body);
    res.status(201).json(so);
});

/**
 * 3. Fault simulator. Synthesizes REALISTIC telemetry -- including the ~30%
 * of dying power_lost messages that never arrive, and firmware-1.2 devices
 * that just go silent -- and pushes every packet through handleTelemetry(),
 * i.e. the exact same path a real device's HTTPS POST would take. This is
 * deliberately not a shortcut that calls localizeFault directly (see
 * DECISIONS.md for why we changed this from the earlier version).
 */
app.post('/api/simulate/fault', (req, res) => {
    const { type, dt_id, feeder_id, span_parent_pole_id, span_child_pole_id } = req.body;

    let packets;
    try {
        packets = simulator.generateFaultTelemetry({ type, dt_id, feeder_id, span_parent_pole_id, span_child_pole_id });
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    const results = packets.map(pkt => handleTelemetry(pkt));
    const ticketsAfter = ticketStore.getAllTickets();

    res.status(201).json({
        message: `Injected ${packets.length} telemetry packets simulating a ${type} fault.`,
        packets_sent: packets.length,
        packets_applied: results.filter(r => r.body.applied).length,
        current_open_tickets: ticketsAfter.filter(t => t.status !== 'closed').length,
    });
});

/**
 * 4. Repair simulator. Sends power_restored/boot telemetry for the poles
 * affected by a given incident, through the real ingestion path -- so
 * verification happens the same way it would from a real repaired line.
 */
app.post('/api/simulate/repair', (req, res) => {
    const { incident_id } = req.body;
    const ticket = ticketStore.getTicket(incident_id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const packets = simulator.generateRestorationTelemetry(ticket.affected_pole_ids);
    const results = packets.map(pkt => handleTelemetry(pkt));
    const updatedTicket = ticketStore.getTicket(incident_id);

    res.status(200).json({
        message: `Injected ${packets.length} restoration packets for ${ticket.affected_pole_ids.length} poles.`,
        packets_applied: results.filter(r => r.body.applied).length,
        ticket_status: updatedTicket.status,
    });
});

/**
 * 4b. Network listing, for the simulator UI's dropdowns (pick a DT, feeder,
 * or specific pole to fault). Not part of the core product surface -- this
 * exists purely to drive the simulator, so it stays deliberately minimal.
 */
app.get('/api/network/summary', (req, res) => {
    const { transformers } = registry.load();
    res.status(200).json({
        feeders: [...new Set(transformers.map(dt => dt.feeder_id))],
        transformers: transformers.map(dt => ({ dt_id: dt.dt_id, feeder_id: dt.feeder_id, lat: dt.lat, lon: dt.lon })),
    });
});

app.get('/api/network/dt/:dtId/poles', (req, res) => {
    const poles = registry.getDtPoles(req.params.dtId);
    res.status(200).json(poles.map(p => ({ pole_id: p.pole_id, lat: p.lat, lon: p.lon, seq_on_line: p.seq_on_line, parent_pole_id: p.parent_pole_id })));
});

/**
 * 5. Operator view.
 */
app.get('/api/tickets', (req, res) => {
    const tickets = ticketStore.getAllTickets();
    res.status(200).json({ count: tickets.length, tickets });
});

app.get('/api/tickets/:id', (req, res) => {
    const ticket = ticketStore.getTicket(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Not found' });
    res.status(200).json(ticket);
});

/**
 * 6. Manual lifecycle transitions (operator acknowledges, assigns crew,
 * marks resolved). 'verified'/'closed' are telemetry-gated -- see
 * ticketStore.setStatus. A manual attempt to force them returns 409, with
 * an explanatory message rather than silently accepting it.
 */
app.patch('/api/tickets/:id/status', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const result = ticketStore.setStatus(id, status);
    if (!result.ok) {
        const code = result.error === 'not_found' ? 404 : 409;
        return res.status(code).json({ error: result.error, message: result.message });
    }
    res.status(200).json({ message: `Ticket ${id} updated to ${status}`, ticket: result.ticket });
});

app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
});

module.exports = app; // exported for tests