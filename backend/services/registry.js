/**
 * registry.js
 *
 * Loads poles.json / transformers.json ONCE and builds the indices the rest
 * of the system needs. localization.js and detection.js both use this
 * instead of independently re-reading/re-parsing the JSON files on every
 * telemetry packet.
 *
 * Indices built:
 *  - byPoleId:      pole_id -> pole row
 *  - byDt:           dt_id -> [pole rows]
 *  - childrenOf:    pole_id -> [child pole rows]   (via parent_pole_id)
 *  - dtById:         dt_id -> transformer row
 */
const fs = require('fs');
const path = require('path');

let loaded = null;

function load(force = false) {
    if (loaded && !force) return loaded;

    const polesRaw = fs.readFileSync(path.join(__dirname, '../data/poles.json'), 'utf8');
    const dtRaw = fs.readFileSync(path.join(__dirname, '../data/transformers.json'), 'utf8');

    const poles = JSON.parse(polesRaw);
    const transformers = JSON.parse(dtRaw);

    const byPoleId = new Map();
    const byDt = new Map();
    const childrenOf = new Map();
    const dtById = new Map();

    for (const p of poles) {
        byPoleId.set(p.pole_id, p);

        if (!byDt.has(p.dt_id)) byDt.set(p.dt_id, []);
        byDt.get(p.dt_id).push(p);

        if (p.parent_pole_id) {
            if (!childrenOf.has(p.parent_pole_id)) childrenOf.set(p.parent_pole_id, []);
            childrenOf.get(p.parent_pole_id).push(p);
        }
    }

    for (const dt of transformers) {
        dtById.set(dt.dt_id, dt);
    }

    loaded = { poles, transformers, byPoleId, byDt, childrenOf, dtById };
    return loaded;
}

/** True if this DT has recorded line order for ALL its poles (the 40% case). */
function dtHasTopology(dtId) {
    const { byDt } = load();
    const dtPoles = byDt.get(dtId) || [];
    if (dtPoles.length === 0) return false;
    return dtPoles.every(p => p.seq_on_line !== '' && p.seq_on_line !== undefined && p.seq_on_line !== null);
}

/** Children of a pole, via parent_pole_id. Empty array if none or unknown topology. */
function childrenOfPole(poleId) {
    const { childrenOf } = load();
    return childrenOf.get(poleId) || [];
}

function getPole(poleId) {
    const { byPoleId } = load();
    return byPoleId.get(poleId) || null;
}

function getDtPoles(dtId) {
    const { byDt } = load();
    return byDt.get(dtId) || [];
}

function getDt(dtId) {
    const { dtById } = load();
    return dtById.get(dtId) || null;
}

function reload() {
    return load(true);
}

module.exports = {
    load,
    dtHasTopology,
    childrenOfPole,
    getPole,
    getDtPoles,
    getDt,
    reload,
};