import React, { useEffect, useState, useCallback } from 'react';
import StatusBar from '../components/StatusBar';
import IncidentList from '../components/IncidentList';
import MapPanel from '../components/MapPanel';
import TicketDetail from '../components/TicketDetail';
import SimulatorPanel from '../components/SimulatorPanel';
import api from '../api';
import '../components/StatusBar.css';

const POLL_INTERVAL_MS = 5000;
// Polling, not WebSockets: justified in ARCHITECTURE.md -- the deployed
// target's proxy support for WS upgrades is a known deployment failure
// mode (see doc 03 troubleshooting requirements), and a 5s poll comfortably
// clears the <120s p95 "fault visible in UI" target with room to spare.

export default function App() {
    const [tickets, setTickets] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [connectionOk, setConnectionOk] = useState(true);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        try {
            const data = await api.getTickets();
            setTickets(data.tickets || []);
            setConnectionOk(true);
        } catch (e) {
            setConnectionOk(false);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
        const interval = setInterval(refresh, POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [refresh]);

    const selectedTicket = tickets.find(t => t.incident_id === selectedId) || null;

    async function runRepair(incidentId) {
        await api.simulateRepair(incidentId);
        await refresh();
    }

    return (
        <div className="app-shell">
            <StatusBar tickets={tickets} connectionOk={connectionOk} />

            <div className="main-grid">
                <div className="left-column scroll-panel">
                    {loading ? (
                        <div className="empty-state">Loading…</div>
                    ) : (
                        <IncidentList tickets={tickets} selectedId={selectedId} onSelect={setSelectedId} />
                    )}
                    <SimulatorPanel onFaultInjected={refresh} />
                </div>

                <div className="right-column">
                    <div className="map-wrap">
                        <MapPanel tickets={tickets} selectedId={selectedId} onSelect={setSelectedId} />
                    </div>
                    <TicketDetail
                        ticket={selectedTicket}
                        onChanged={refresh}
                        onRunRepair={runRepair}
                    />
                </div>
            </div>
        </div>
    );
}