/**
 * poleState.js
 *
 * In-memory store of "what do we currently believe about each pole's power state".
 * This is the thing that turns a stream of individual telemetry packets into
 * a queryable snapshot ("which poles are dark right now under DT D-0112").
 *
 * Design notes (see ARCHITECTURE.md for the full writeup):
 * - Ordering/dedup is done on (device_id, seq), NOT on ts. Device clocks skew
 *   by up to ±90s and are not trustworthy for ordering. seq is monotonic per
 *   device and resets to 0 on boot, so we track last-seen seq per device and
 *   reset our expectation when we see a `boot` event.
 * - At-least-once delivery means duplicates are normal and must be dropped
 *   silently (not treated as new state changes).
 * - A device can be swapped on a pole (device_id changes, pole_id doesn't).
 *   We always key physical state by pole_id, never device_id -- device_id is
 *   only used for ordering/dedup of *that device's* packet stream.
 * - "energized" is the derived truth for a pole. It only changes on
 *   power_lost / power_restored / boot (assume energized=true on boot,
 *   corrected by the immediate heartbeat that follows) -- heartbeats while
 *   already energized just refresh last_seen_at (liveness), not more.
 */

// pole_id -> {
//   energized: boolean,
//   last_seen_at: ISO string (server receipt time, NOT device ts -- see note),
//   last_event: 'heartbeat' | 'power_lost' | 'power_restored' | 'boot',
//   last_device_ts: string,        // device-reported ts, kept for debugging only
//   device_id: string | null,
//   last_seq_by_device: Map<device_id, number>,
//   stale_since: string | null,    // set when we haven't heard from this pole
//                                   // in > ~2x heartbeat interval and it has no
//                                   // firm power_lost -- "silence", not "dark"
// }
const poleState = new Map();

// device_id -> last accepted seq. Kept separately from poleState because a
// pole can have its device swapped, and a device's seq history shouldn't be
// wiped just because we're indexing state by pole_id.
const lastSeqByDevice = new Map();

const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;
const HEARTBEAT_JITTER_MS = 45 * 1000;
// If we haven't heard anything from a pole in this long, we no longer trust
// "last known energized state" at face value -- it's gone quiet, which is
// ambiguous (dead modem vs actually dark, esp. for fw 1.2.x devices that
// never send power_lost at all). Detection logic (not this file) decides
// what to do with that ambiguity.
const SILENCE_THRESHOLD_MS = 2 * (HEARTBEAT_INTERVAL_MS + HEARTBEAT_JITTER_MS);

function getOrInitPole(poleId) {
    if (!poleState.has(poleId)) {
        poleState.set(poleId, {
            energized: true, // optimistic default until we hear otherwise
            last_seen_at: null,
            last_event: null,
            last_device_ts: null,
            device_id: null,
            stale_since: null,
        });
    }
    return poleState.get(poleId);
}

/**
 * Apply one telemetry packet to state.
 * Returns { applied: boolean, reason: string, changed: boolean, pole_id }
 * so the detection layer can decide whether this packet is worth reacting to.
 */
function applyTelemetry(payload) {
    const { device_id, pole_id, event, energized, ts, seq } = payload;

    if (!device_id || !pole_id || !event || typeof seq !== 'number') {
        return { applied: false, reason: 'malformed_payload', changed: false, pole_id };
    }

    // --- Ordering / dedup on (device_id, seq) ---
    // `boot` resets the device's seq counter to 0. If we see a boot with a
    // lower seq than what we've stored, that's expected (new epoch), not staleness.
    const priorSeq = lastSeqByDevice.get(device_id);
    if (event !== 'boot' && priorSeq !== undefined && seq <= priorSeq) {
        // Duplicate or out-of-order-and-superseded packet. At-least-once
        // delivery + up-to-6h-stale retries mean this is routine, not an error.
        return { applied: false, reason: 'duplicate_or_stale_seq', changed: false, pole_id };
    }
    lastSeqByDevice.set(device_id, seq);

    const pole = getOrInitPole(pole_id);
    const wasEnergized = pole.energized;
    const now = new Date().toISOString();

    pole.device_id = device_id;
    pole.last_seen_at = now;
    pole.last_device_ts = ts || null;
    pole.last_event = event;
    pole.stale_since = null; // hearing from it at all clears silence

    switch (event) {
        case 'heartbeat':
            pole.energized = true;
            break;
        case 'power_lost':
            pole.energized = false;
            break;
        case 'power_restored':
            pole.energized = true;
            break;
        case 'boot':
            // Device just came back up. Treat as energized; the power_restored
            // or heartbeat that follows will confirm. If a boot arrives with no
            // energized info, don't flip a previously-dark pole to live purely
            // on a boot event without corroboration -- but for simplicity here,
            // trust explicit `energized` field if present.
            if (typeof energized === 'boolean') pole.energized = energized;
            break;
        default:
            return { applied: false, reason: 'unknown_event_type', changed: false, pole_id };
    }

    return {
        applied: true,
        reason: 'ok',
        changed: wasEnergized !== pole.energized,
        pole_id,
        energized: pole.energized,
    };
}

function getPole(poleId) {
    return poleState.get(poleId) || null;
}

function getAllPoles() {
    return poleState;
}

/**
 * A pole is "confirmed dark" if we have a firm power_lost/energized=false
 * reading and it isn't stale-silence-only.
 * A pole is "silent" if we haven't heard from it in > SILENCE_THRESHOLD_MS --
 * this is ambiguous (dead modem vs actually dark) and handled separately by
 * detection logic, not folded into "dark" here.
 */
function classifyPole(poleId, registryHasDevice) {
    const p = poleState.get(poleId);
    if (!registryHasDevice) return 'no_device'; // ~9% of poles, never expect telemetry
    if (!p || !p.last_seen_at) return 'never_reported';

    const silentMs = Date.now() - new Date(p.last_seen_at).getTime();
    if (p.energized === false) return 'dark_confirmed';
    if (silentMs > SILENCE_THRESHOLD_MS) return 'silent_ambiguous';
    return 'live';
}

module.exports = {
    applyTelemetry,
    getPole,
    getAllPoles,
    classifyPole,
    SILENCE_THRESHOLD_MS,
};