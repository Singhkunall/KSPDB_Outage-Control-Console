/**
 * api.js
 *
 * Thin fetch wrapper for the backend. BASE_URL is read from an env var so
 * the same build works locally (docker compose, same-origin or a fixed
 * port) and on the deployed public URL -- see DEPLOYMENT.md for the exact
 * value to set in each environment.
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

async function request(path, options = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err = new Error(body.message || body.error || `Request failed: ${res.status}`);
        err.status = res.status;
        err.body = body;
        throw err;
    }
    return res.json();
}

export const api = {
    getTickets: () => request('/api/tickets'),
    getTicket: (id) => request(`/api/tickets/${id}`),
    setTicketStatus: (id, status) =>
        request(`/api/tickets/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),

    simulateFault: (payload) =>
        request('/api/simulate/fault', { method: 'POST', body: JSON.stringify(payload) }),
    simulateRepair: (incidentId) =>
        request('/api/simulate/repair', { method: 'POST', body: JSON.stringify({ incident_id: incidentId }) }),
    simulateScheduledOutage: (payload) =>
        request('/api/simulate/scheduled-outage', { method: 'POST', body: JSON.stringify(payload) }),

    getScheduledOutages: (from, to) =>
        request(`/scheduled-outages?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),

    getNetworkSummary: () => request('/api/network/summary'),
    getDtPoles: (dtId) => request(`/api/network/dt/${dtId}/poles`),
};

export default api;