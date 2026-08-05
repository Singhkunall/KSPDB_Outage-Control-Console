import React, { useMemo } from 'react';
import IncidentCard from './IncidentCard';
import './IncidentCard.css';

const CONFIDENCE_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const OPEN_STATUSES = ['detected', 'acknowledged', 'crew_assigned', 'resolved'];

/**
 * Sort: open incidents before closed ones; within open, higher confidence
 * first (a confirmed HIGH-confidence fault is more actionable right now
 * than a LOW-confidence "might be scheduled outage" flag -- an operator's
 * attention should go there first), then most recent first.
 */
function sortIncidents(tickets) {
    return [...tickets].sort((a, b) => {
        const aOpen = OPEN_STATUSES.includes(a.status);
        const bOpen = OPEN_STATUSES.includes(b.status);
        if (aOpen !== bOpen) return aOpen ? -1 : 1;

        const confDiff = (CONFIDENCE_RANK[b.confidence] ?? 1) - (CONFIDENCE_RANK[a.confidence] ?? 1);
        if (confDiff !== 0) return confDiff;

        return new Date(b.created_at) - new Date(a.created_at);
    });
}

export default function IncidentList({ tickets, selectedId, onSelect }) {
    const sorted = useMemo(() => sortIncidents(tickets), [tickets]);

    if (sorted.length === 0) {
        return (
            <div className="empty-state">
                <div className="empty-state-title">No incidents</div>
                <div className="empty-state-body">
                    Network is reporting clean. Use the simulator below to inject a test fault.
                </div>
            </div>
        );
    }

    return (
        <div className="incident-list">
            {sorted.map(t => (
                <IncidentCard
                    key={t.incident_id}
                    incident={t}
                    selected={t.incident_id === selectedId}
                    onSelect={onSelect}
                />
            ))}
        </div>
    );
}