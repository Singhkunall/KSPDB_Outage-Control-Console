import React, { useMemo } from 'react';

const OPEN_STATUSES = ['detected', 'acknowledged', 'crew_assigned', 'resolved'];

export default function StatusBar({ tickets, connectionOk }) {
    const stats = useMemo(() => {
        const open = tickets.filter(t => OPEN_STATUSES.includes(t.status));
        const high = open.filter(t => t.confidence === 'HIGH').length;
        const affectedPoles = open.reduce((sum, t) => sum + (t.affected_poles_count || 0), 0);
        return { openCount: open.length, high, affectedPoles };
    }, [tickets]);

    const worst = stats.high > 0 ? 'high' : (stats.openCount > 0 ? 'medium' : 'clear');

    return (
        <header className="status-bar">
            <div className="status-bar-brand">
                <span className="status-dot" data-state={worst} />
                <span className="status-bar-title">KSPDB &mdash; Outage Control Console</span>
            </div>

            <div className="status-bar-stats">
                <div className="stat">
                    <span className="stat-value">{stats.openCount}</span>
                    <span className="stat-label">open incidents</span>
                </div>
                <div className="stat">
                    <span className="stat-value">{stats.high}</span>
                    <span className="stat-label">high confidence</span>
                </div>
                <div className="stat">
                    <span className="stat-value mono">{stats.affectedPoles}</span>
                    <span className="stat-label">poles affected</span>
                </div>
            </div>

            <div className="status-bar-conn">
                <span className={`conn-dot ${connectionOk ? 'conn-ok' : 'conn-bad'}`} />
                {connectionOk ? 'Live' : 'Reconnecting…'}
            </div>
        </header>
    );
}