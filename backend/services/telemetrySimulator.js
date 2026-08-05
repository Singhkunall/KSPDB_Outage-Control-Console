/**
 * telemetrySimulator.js
 *
 * Deliverable #6. Produces telemetry that a real fault would actually cause
 * -- not a shortcut list of "these poles are dark". Modeling this honestly
 * is what lets the rest of the pipeline (poleState, detection) be exercised
 * the same way it would be by real hardware.
 *
 * Modeled per 02-data-and-systems.md §2 and §6:
 *  - ~70% of firmware >=1.3 devices successfully send a single power_lost
 *    packet from capacitor reserve before dying; ~30% never get the message
 *    out at all (silence only).
 *  - ~8% of the fleet is on firmware 1.2.x, which NEVER sends power_lost --
 *    it just stops heartbeating. We model this per-device, consistently
 *    (a device's fw is fixed, not re-rolled per fault).
 *  - Duplicate and out-of-order delivery: some packets are sent twice, and
 *    packet order isn't guaranteed to be delivery order.
 */
const registry = require('./registry');
const poleState = require('./poleState');

const FW_1_2_FRACTION = 0.08;
const POWER_LOST_SUCCESS_RATE = 0.70;

// Assign each device a fixed firmware bucket once, deterministically-ish,
// so repeated faults on the same pole behave consistently within a run.
const fwAssignment = new Map(); // device_id -> boolean (true = fw 1.2.x, silent-only)

function isFw12(deviceId) {
    if (!fwAssignment.has(deviceId)) {
        fwAssignment.set(deviceId, Math.random() < FW_1_2_FRACTION);
    }
    return fwAssignment.get(deviceId);
}

function nextSeqFor(deviceId) {
    return Date.now() % 1000000 + Math.floor(Math.random() * 100);
}

function powerLostPacket(pole) {
    return {
        device_id: pole.device_id,
        pole_id: pole.pole_id,
        event: 'power_lost',
        energized: false,
        ts: new Date().toISOString(),
        seq: nextSeqFor(pole.device_id),
        battery_mv: 3300 + Math.floor(Math.random() * 200),
        rssi: -85 - Math.floor(Math.random() * 15),
        fw: '1.4.2',
    };
}

/**
 * For a set of poles that should go dark, decide per-device what actually
 * gets transmitted: a real power_lost packet, or nothing (fw 1.2.x, or the
 * ~30% capacitor-message failure for fw >= 1.3). Returns only the packets
 * that would actually be sent -- callers relying purely on this list will
 * correctly see some poles go "silent" rather than "confirmed dark", which
 * is the whole point.
 */
function packetsForPolesGoingDark(poles) {
    const packets = [];
    for (const pole of poles) {
        if (!pole.device_id) continue; // no device fitted -- nothing to send, ever

        if (isFw12(pole.device_id)) {
            continue; // fw 1.2.x: never sends power_lost, just goes quiet
        }
        if (Math.random() < POWER_LOST_SUCCESS_RATE) {
            packets.push(powerLostPacket(pole));
        }
        // else: capacitor died before the message got out -- silence only
    }
    return packets;
}

function restoredPacket(pole) {
    return {
        device_id: pole.device_id,
        pole_id: pole.pole_id,
        event: 'power_restored',
        energized: true,
        ts: new Date().toISOString(),
        seq: nextSeqFor(pole.device_id),
        battery_mv: 3600 + Math.floor(Math.random() * 200),
        rssi: -80 - Math.floor(Math.random() * 15),
        fw: isFw12(pole.device_id) ? '1.2.7' : '1.4.2',
    };
}

function generateRestorationTelemetry(poleIds) {
    const packets = [];
    for (const id of poleIds) {
        const pole = registry.getPole(id);
        if (!pole || !pole.device_id) continue;
        packets.push(restoredPacket(pole));
    }
    return packets;
}

/**
 * type: 'span' | 'dt' | 'feeder'
 * span: requires span_child_pole_id (child and everything downstream of it
 *       goes dark).
 * dt:   requires dt_id (every pole under that DT goes dark).
 * feeder: requires feeder_id (every pole under every DT on that feeder).
 */
function generateFaultTelemetry({ type, dt_id, feeder_id, span_parent_pole_id, span_child_pole_id }) {
    const { collectDownstream } = require('./localization');

    if (type === 'span') {
        if (!span_child_pole_id) throw new Error('span fault requires span_child_pole_id');
        const affected = collectDownstream(span_child_pole_id);
        if (affected.length === 0) throw new Error('No poles found downstream of span_child_pole_id');
        return packetsForPolesGoingDark(affected);
    }

    if (type === 'dt') {
        if (!dt_id) throw new Error('dt fault requires dt_id');
        const affected = registry.getDtPoles(dt_id);
        if (affected.length === 0) throw new Error(`No poles found for dt_id ${dt_id}`);
        return packetsForPolesGoingDark(affected);
    }

    if (type === 'feeder') {
        if (!feeder_id) throw new Error('feeder fault requires feeder_id');
        const dts = registry.load().transformers.filter(dt => dt.feeder_id === feeder_id);
        const affected = dts.flatMap(dt => registry.getDtPoles(dt.dt_id));
        if (affected.length === 0) throw new Error(`No poles found for feeder_id ${feeder_id}`);
        return packetsForPolesGoingDark(affected);
    }

    throw new Error(`Unknown fault type '${type}'. Expected one of: span, dt, feeder`);
}

module.exports = {
    generateFaultTelemetry,
    generateRestorationTelemetry,
};