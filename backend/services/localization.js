/**
 * localization.js
 *
 * Turns a set of pole classifications (from poleState.classifyPole, via
 * detection.js) into located fault incidents.
 *
 * Input contract: darkPoleIds is the set of poles currently classified as
 * dark_confirmed OR silent_ambiguous for a given DT (detection.js decides
 * which classifications count as "dark enough to consider"). This function
 * does NOT talk to poleState directly -- keeps it a pure, testable function
 * of (dark pole ids, registry), per the brief's ask for reimplementable,
 * testable localization logic.
 *
 * silentPoleIds (subset of darkPoleIds) marks poles that are silent_ambiguous
 * rather than dark_confirmed -- used to downgrade confidence, not to exclude
 * them from boundary consideration (see DECISIONS.md).
 *
 * Complexity: for a DT with N poles, tree construction is O(N) (already done
 * once in registry.js), and boundary-walking is O(N) per DT since each pole
 * is visited once. Overall O(total poles across affected DTs) per detection
 * pass -- no quadratic behavior.
 */
const registry = require('./registry');

function makeIncidentId() {
    return `INC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}

/**
 * Rule: a dark pole whose direct children (per parent_pole_id) are ALL live
 * is not a line fault -- it's a broken sensor point (01-problem-context.md §2:
 * "a single isolated dark pole with live children is physically impossible
 * as a line fault"). We only apply this when we KNOW the children (i.e. the
 * DT has recorded topology) -- with no topology we can't tell isolated poles
 * apart from boundary poles, so we don't filter, we just report lower
 * confidence at the DT level instead.
 */
function isIsolatedDeadSensor(pole, darkSet) {
    const children = registry.childrenOfPole(pole.pole_id);
    if (children.length === 0) return false; // leaf pole -- can't distinguish this way
    return children.every(child => !darkSet.has(child.pole_id));
}

/**
 * Walk the tree from the DT root(s) outward. A "root" pole for a DT is any
 * pole in that DT with no parent_pole_id recorded (i.e. seq_on_line === 1,
 * or simply no parent within this DT's pole set).
 * Returns an array of boundary spans: { parent_pole_id, child_pole_id }
 * for every parent-live/child-dark transition found. Supports multiple
 * boundaries per DT (multiple simultaneous faults on different branches).
 */
function findBoundaries(dtId, darkSet) {
    const dtPoles = registry.getDtPoles(dtId);
    const byId = new Map(dtPoles.map(p => [p.pole_id, p]));

    const roots = dtPoles.filter(p => !p.parent_pole_id || !byId.has(p.parent_pole_id));
    const boundaries = [];
    const visited = new Set();

    function walk(pole) {
        if (visited.has(pole.pole_id)) return; // guard against malformed cycles
        visited.add(pole.pole_id);

        const isDark = darkSet.has(pole.pole_id);
        const children = registry.childrenOfPole(pole.pole_id).filter(c => byId.has(c.pole_id));

        if (!isDark) {
            for (const child of children) {
                if (darkSet.has(child.pole_id)) {
                    boundaries.push({ parent_pole_id: pole.pole_id, child_pole_id: child.pole_id });
                    // Don't recurse into this dark child's subtree for boundary-
                    // finding -- everything under it is a symptom of THIS boundary,
                    // not a separate one. We still need it counted, see collectDownstream.
                } else {
                    walk(child);
                }
            }
        }
        // If pole itself is dark, we don't walk further down for boundary-finding;
        // its parent (already live, by construction) is what recorded the boundary.
    }

    roots.forEach(walk);
    return boundaries;
}

/** All poles downstream (inclusive) of a given pole, via the child index. */
function collectDownstream(poleId) {
    const result = [];
    const stack = [poleId];
    while (stack.length) {
        const id = stack.pop();
        const pole = registry.getPole(id);
        if (pole) result.push(pole);
        for (const child of registry.childrenOfPole(id)) {
            stack.push(child.pole_id);
        }
    }
    return result;
}

/**
 * Main entry point. darkClassified: Map<pole_id, 'dark_confirmed'|'silent_ambiguous'>
 * scoped to poles believed dark right now, already filtered to a single DT's
 * worth of poles by the caller (detection.js) OR spanning multiple DTs on one
 * feeder if a feeder-level fault is suspected (see feeder handling below).
 */
function localizeFault(darkClassified) {
    const darkPoleIds = Array.from(darkClassified.keys());
    if (darkPoleIds.length === 0) return [];

    const darkPoles = darkPoleIds.map(id => registry.getPole(id)).filter(Boolean);
    const darkSet = new Set(darkPoleIds);

    // Group by DT first.
    const byDt = new Map();
    for (const p of darkPoles) {
        if (!byDt.has(p.dt_id)) byDt.set(p.dt_id, []);
        byDt.get(p.dt_id).push(p);
    }

    // Feeder-level check: if EVERY DT under a feeder has dark poles, and for
    // each of those DTs either topology is missing or the whole DT reads
    // dark, treat it as one feeder-level incident instead of N DT incidents.
    const feederGroups = new Map(); // feeder_id -> [dt_id...]
    for (const [dtId, poles] of byDt.entries()) {
        const feederId = poles[0].feeder_id;
        if (!feederGroups.has(feederId)) feederGroups.set(feederId, []);
        feederGroups.get(feederId).push(dtId);
    }

    const incidents = [];
    const consumedDts = new Set();

    for (const [feederId, dtIds] of feederGroups.entries()) {
        const allDtsUnderFeeder = registry.load().transformers.filter(dt => dt.feeder_id === feederId).map(dt => dt.dt_id);
        const allDark = allDtsUnderFeeder.length > 0 && allDtsUnderFeeder.every(id => dtIds.includes(id));

        // Require more than one DT actually present and dark to call it a
        // feeder fault -- a feeder with only one DT would be indistinguishable
        // from a DT fault, so we let it fall through to DT-level handling.
        if (allDark && allDtsUnderFeeder.length > 1) {
            const samplePole = byDt.get(dtIds[0])[0];
            const totalAffected = dtIds.reduce((sum, id) => sum + registry.getDtPoles(id).length, 0);
            incidents.push({
                incident_id: makeIncidentId(),
                type: 'FEEDER_FAULT',
                feeder_id: feederId,
                dt_id: null,
                failed_span: null,
                affected_poles_count: totalAffected,
                lat: samplePole.lat,
                lon: samplePole.lon,
                pincode: samplePole.pincode || null,
                confidence: 'HIGH',
                confidence_reason: `All ${allDtsUnderFeeder.length} distribution transformers on feeder ${feederId} are dark. Consistent with an 11kV feeder-level fault upstream of every DT.`,
                description: `Feeder ${feederId} appears fully de-energized (${dtIds.length} DTs, ${totalAffected} poles affected).`,
            });
            dtIds.forEach(id => consumedDts.add(id));
        }
    }

    for (const [dtId, dPoles] of byDt.entries()) {
        if (consumedDts.has(dtId)) continue; // already covered by a feeder incident

        const samplePole = dPoles[0];
        const hasTopology = registry.dtHasTopology(dtId);
        const allDtPoles = registry.getDtPoles(dtId);
        const localDarkSet = new Set(dPoles.map(p => p.pole_id));

        if (!hasTopology) {
            // 60% case: no recorded pole ordering. Fall back to DT-level
            // localization -- report the DT's location, not a fabricated span.
            // (Alternative strategies -- geometric inference, outage-history
            // learning -- are discussed and rejected/deferred in ARCHITECTURE.md.)
            const anySilent = dPoles.some(p => darkClassified.get(p.pole_id) === 'silent_ambiguous');
            incidents.push({
                incident_id: makeIncidentId(),
                type: 'DT_ZONE_FAULT_TOPOLOGY_UNKNOWN',
                feeder_id: samplePole.feeder_id,
                dt_id: dtId,
                failed_span: null,
                affected_poles_count: dPoles.length,
                lat: samplePole.lat,
                lon: samplePole.lon,
                pincode: samplePole.pincode || null,
                confidence: anySilent ? 'LOW' : 'MEDIUM',
                confidence_reason: `DT ${dtId} has no recorded pole ordering (60% case). ${dPoles.length} of ${allDtPoles.length} poles under it are dark. Located to the DT's coordinates, not a specific span.${anySilent ? ' Some affected poles are silent rather than confirmed dark, lowering confidence further.' : ''}`,
                description: `${dPoles.length} poles dark under DT ${dtId}. Exact span undetermined -- no recorded line topology for this transformer.`,
            });
            continue;
        }

        // Topology known: is the WHOLE DT dark (no live pole anywhere under it)?
        const anyLive = allDtPoles.some(p => !localDarkSet.has(p.pole_id));
        if (!anyLive) {
            incidents.push({
                incident_id: makeIncidentId(),
                type: 'DT_FAULT',
                feeder_id: samplePole.feeder_id,
                dt_id: dtId,
                failed_span: null,
                affected_poles_count: dPoles.length,
                lat: samplePole.lat,
                lon: samplePole.lon,
                pincode: samplePole.pincode || null,
                confidence: 'HIGH',
                confidence_reason: `Every pole under DT ${dtId} (${dPoles.length}/${allDtPoles.length}) is dark, with no live pole beneath it anywhere on the line. Consistent with a DT/HT-fuse-level fault, not a span fault.`,
                description: `Transformer ${dtId} appears fully de-energized.`,
            });
            continue;
        }

        // Filter out isolated dead-sensor poles (dark, but all their children
        // are live -- physically impossible as a line fault).
        const isolatedSensorPoles = dPoles.filter(p => isIsolatedDeadSensor(p, localDarkSet));
        const isolatedIds = new Set(isolatedSensorPoles.map(p => p.pole_id));
        const realDarkSet = new Set(dPoles.filter(p => !isolatedIds.has(p.pole_id)).map(p => p.pole_id));

        if (realDarkSet.size === 0) continue; // everything dark here was just dead sensors

        // Find ALL live/dark boundaries under this DT (handles multiple
        // simultaneous span faults on different branches of the same DT).
        const boundaries = findBoundaries(dtId, realDarkSet);

        if (boundaries.length === 0) {
            // Dark poles exist but no clean live-parent boundary found -- can
            // happen if the dark region includes a device-less pole right at
            // the frontier. Report at DT-zone confidence rather than guessing.
            incidents.push({
                incident_id: makeIncidentId(),
                type: 'SPAN_FAULT_BOUNDARY_UNRESOLVED',
                feeder_id: samplePole.feeder_id,
                dt_id: dtId,
                failed_span: null,
                affected_poles_count: realDarkSet.size,
                lat: samplePole.lat,
                lon: samplePole.lon,
                pincode: samplePole.pincode || null,
                confidence: 'LOW',
                confidence_reason: `${realDarkSet.size} poles dark under DT ${dtId} but no clean live-to-dark boundary could be resolved (likely a device-less pole at the frontier). Located to DT zone.`,
                description: `Unresolved boundary under DT ${dtId}.`,
            });
            continue;
        }

        for (const b of boundaries) {
            const parentPole = registry.getPole(b.parent_pole_id);
            const childPole = registry.getPole(b.child_pole_id);
            const downstream = collectDownstream(b.child_pole_id).filter(p => realDarkSet.has(p.pole_id));
            const anySilentInGroup = downstream.some(p => darkClassified.get(p.pole_id) === 'silent_ambiguous');

            incidents.push({
                incident_id: makeIncidentId(),
                type: 'SPAN_FAULT',
                feeder_id: samplePole.feeder_id,
                dt_id: dtId,
                failed_span: `${parentPole.pole_id} -> ${childPole.pole_id}`,
                affected_poles_count: downstream.length,
                lat: childPole.lat,
                lon: childPole.lon,
                pincode: childPole.pincode || parentPole.pincode || null,
                confidence: anySilentInGroup ? 'MEDIUM' : 'HIGH',
                confidence_reason: `Live/dark boundary confirmed between ${parentPole.pole_id} (live) and ${childPole.pole_id} (dark), with ${downstream.length} poles downstream also dark.${anySilentInGroup ? ' Some downstream poles are silent rather than confirmed dark.' : ''}`,
                description: `Span fault between ${parentPole.pole_id} and ${childPole.pole_id}. ${downstream.length} downstream poles affected.`,
            });
        }
    }

    return incidents;
}

module.exports = { localizeFault, isIsolatedDeadSensor, findBoundaries, collectDownstream };