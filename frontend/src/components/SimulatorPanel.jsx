import React, { useEffect, useState } from 'react';
import api from '../api';

/**
 * Deliverable #6: the fault simulator, drivable from the UI.
 * Sends synthetic telemetry (not a raw dark-pole-id list) through
 * /api/simulate/fault, which pushes it through the same ingestion path a
 * real device would use -- see telemetrySimulator.js.
 */
export default function SimulatorPanel({ onFaultInjected }) {
    const [network, setNetwork] = useState({ feeders: [], transformers: [] });
    const [faultType, setFaultType] = useState('dt');
    const [dtId, setDtId] = useState('');
    const [feederId, setFeederId] = useState('');
    const [poles, setPoles] = useState([]);
    const [spanChildPoleId, setSpanChildPoleId] = useState('');
    const [busy, setBusy] = useState(false);
    const [lastResult, setLastResult] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        api.getNetworkSummary()
            .then(data => {
                setNetwork(data);
                if (data.transformers[0]) setDtId(data.transformers[0].dt_id);
                if (data.feeders[0]) setFeederId(data.feeders[0]);
            })
            .catch(e => setError(e.message));
    }, []);

    useEffect(() => {
        if (faultType !== 'span' || !dtId) return;
        api.getDtPoles(dtId).then(setPoles).catch(() => setPoles([]));
    }, [faultType, dtId]);

    async function inject() {
        setBusy(true);
        setError(null);
        setLastResult(null);
        try {
            const payload = { type: faultType };
            if (faultType === 'dt') payload.dt_id = dtId;
            if (faultType === 'feeder') payload.feeder_id = feederId;
            if (faultType === 'span') payload.span_child_pole_id = spanChildPoleId;

            const result = await api.simulateFault(payload);
            setLastResult(result);
            onFaultInjected();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    }

    async function injectScheduledOutage() {
        setBusy(true);
        setError(null);
        try {
            const now = new Date();
            const end = new Date(now.getTime() + 60 * 60 * 1000);
            await api.simulateScheduledOutage({
                id: `SO-TEST-${Date.now()}`,
                scope: faultType === 'feeder' ? 'feeder' : 'dt',
                target_id: faultType === 'feeder' ? feederId : dtId,
                start: now.toISOString(),
                end: end.toISOString(),
                reason: 'Simulated load shedding (test)',
            });
            setLastResult({ message: 'Scheduled outage window added. Inject a fault on the same DT/feeder now to see confidence downgrade instead of suppression.' });
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="simulator-panel">
            <div className="simulator-header">Fault simulator</div>

            <label className="sim-label">
                Fault type
                <select className="sim-select" value={faultType} onChange={e => setFaultType(e.target.value)}>
                    <option value="span">Span fault</option>
                    <option value="dt">Transformer fault</option>
                    <option value="feeder">Feeder fault</option>
                </select>
            </label>

            {faultType !== 'feeder' && (
                <label className="sim-label">
                    Transformer
                    <select className="sim-select" value={dtId} onChange={e => setDtId(e.target.value)}>
                        {network.transformers.map(dt => (
                            <option key={dt.dt_id} value={dt.dt_id}>{dt.dt_id} ({dt.feeder_id})</option>
                        ))}
                    </select>
                </label>
            )}

            {faultType === 'feeder' && (
                <label className="sim-label">
                    Feeder
                    <select className="sim-select" value={feederId} onChange={e => setFeederId(e.target.value)}>
                        {network.feeders.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                </label>
            )}

            {faultType === 'span' && (
                <label className="sim-label">
                    Pole (fault occurs on the span just above this pole)
                    <select className="sim-select" value={spanChildPoleId} onChange={e => setSpanChildPoleId(e.target.value)}>
                        <option value="">Select a pole…</option>
                        {poles.filter(p => p.parent_pole_id).map(p => (
                            <option key={p.pole_id} value={p.pole_id}>{p.pole_id}</option>
                        ))}
                    </select>
                    {poles.length > 0 && poles.every(p => !p.parent_pole_id) && (
                        <span className="sim-hint">This transformer has no recorded topology -- try a different one, or use a DT-level fault instead.</span>
                    )}
                </label>
            )}

            <div className="sim-actions">
                <button className="btn btn-primary" disabled={busy || (faultType === 'span' && !spanChildPoleId)} onClick={inject}>
                    Inject fault
                </button>
                <button className="btn btn-ghost" disabled={busy} onClick={injectScheduledOutage}>
                    Add scheduled outage window
                </button>
            </div>

            {error && <div className="detail-error">{error}</div>}
            {lastResult && <div className="sim-result">{lastResult.message}</div>}
        </div>
    );
}