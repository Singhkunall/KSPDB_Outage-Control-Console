import React, { useState } from 'react';
import api from '../api';

const NEXT_MANUAL_STATUS = {
    detected: 'acknowledged',
    acknowledged: 'crew_assigned',
    crew_assigned: 'resolved',
};

const NEXT_MANUAL_LABEL = {
    detected: 'Acknowledge',
    acknowledged: 'Mark crew assigned',
    crew_assigned: 'Mark resolved (crew reports fixed)',
};

export default function TicketDetail({ ticket, onChanged, onRunRepair }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    if (!ticket) {
        return (
            <div className="detail-panel detail-empty">
                Select an incident to see details and actions.
            </div>
        );
    }

    async function setStatus(status) {
        setBusy(true);
        setError(null);
        try {
            await api.setTicketStatus(ticket.incident_id, status);
            onChanged();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    }

    async function advance() {
        const next = NEXT_MANUAL_STATUS[ticket.status];
        if (next) await setStatus(next);
    }

    async function repair() {
        setBusy(true);
        setError(null);
        try {
            await onRunRepair(ticket.incident_id);
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="detail-panel">
            <div className="detail-header">
                <span className="mono detail-id">{ticket.incident_id}</span>
                <span className={`badge badge-${ticket.confidence?.toLowerCase()}`}>{ticket.confidence}</span>
            </div>

            <h2 className="detail-title">{ticket.description}</h2>

            <dl className="detail-facts">
                <dt>Location</dt>
                <dd className="mono">{ticket.lat?.toFixed(6)}, {ticket.lon?.toFixed(6)}</dd>

                <dt>PIN code</dt>
                <dd className="mono">{ticket.pincode || 'Unknown -- verify on arrival'}</dd>

                {ticket.failed_span && (
                    <>
                        <dt>Failed span</dt>
                        <dd className="mono">{ticket.failed_span}</dd>
                    </>
                )}
                {ticket.dt_id && (
                    <>
                        <dt>Transformer</dt>
                        <dd className="mono">{ticket.dt_id}</dd>
                    </>
                )}
                {ticket.feeder_id && (
                    <>
                        <dt>Feeder</dt>
                        <dd className="mono">{ticket.feeder_id}</dd>
                    </>
                )}
                <dt>Poles affected</dt>
                <dd>{ticket.affected_poles_count}</dd>
            </dl>

            <div className="detail-reason">
                <div className="detail-reason-label">Why this confidence</div>
                <p>{ticket.confidence_reason}</p>
            </div>

            <div className="detail-status-row">
                <span className="detail-status-label">Status</span>
                <span className="detail-status-value">{ticket.status}</span>
            </div>

            {error && <div className="detail-error">{error}</div>}

            <div className="detail-actions">
                {NEXT_MANUAL_STATUS[ticket.status] && (
                    <button className="btn btn-primary" disabled={busy} onClick={advance}>
                        {NEXT_MANUAL_LABEL[ticket.status]}
                    </button>
                )}

                {ticket.status === 'resolved' && (
                    <p className="detail-hint">
                        Waiting on telemetry to confirm the poles are live again.
                        This ticket will move to <strong>verified</strong> automatically
                        &mdash; it cannot be forced.
                    </p>
                )}

                {['detected', 'acknowledged', 'crew_assigned', 'resolved'].includes(ticket.status) && (
                    <button className="btn btn-ghost" disabled={busy} onClick={repair}>
                        Simulate: repair &amp; send restoration telemetry
                    </button>
                )}

                {ticket.status === 'verified' && (
                    <button className="btn btn-primary" disabled={busy} onClick={() => setStatus('closed')}>
                        Close ticket
                    </button>
                )}

                {ticket.status === 'closed' && <p className="detail-hint">Closed.</p>}
            </div>
        </div>
    );
}