import React from 'react';

const TYPE_LABELS = {
    SPAN_FAULT: 'Span fault',
    DT_FAULT: 'Transformer fault',
    FEEDER_FAULT: 'Feeder fault',
    DT_ZONE_FAULT_TOPOLOGY_UNKNOWN: 'Zone fault (topology unknown)',
    SPAN_FAULT_BOUNDARY_UNRESOLVED: 'Boundary unresolved',
};

const CONFIDENCE_BADGE = {
    HIGH: 'badge-high',
    MEDIUM: 'badge-medium',
    LOW: 'badge-low',
};

const STATUS_LABELS = {
    detected: 'Detected',
    acknowledged: 'Acknowledged',
    crew_assigned: 'Crew assigned',
    resolved: 'Awaiting verification',
    verified: 'Verified',
    closed: 'Closed',
};

/**
 * The "boundary strip": a literal small visualization of the live -> dark
 * transition this incident represents. For span faults it shows exactly two
 * poles (last live, first dark) with a break in the line between them. For
 * DT/feeder/zone faults, where there's no single clean boundary pole pair,
 * it shows a solid dark band instead -- deliberately a different shape, so
 * an operator learns to read "this is a whole-zone problem" at a glance
 * without reading the label.
 */
function BoundaryStrip({ incident }) {
    if (incident.type === 'SPAN_FAULT' && incident.failed_span) {
        const [liveId, darkId] = incident.failed_span.split(' -> ');
        return (
            <div className="boundary-strip" aria-hidden="true">
                <span className="b-dot b-live" title={`${liveId} (live)`} />
                <span className="b-line-live" />
                <span className="b-break" />
                <span className="b-line-dark" />
                <span className="b-dot b-dark" title={`${darkId} (dark)`} />
            </div>
        );
    }
    return (
        <div className="boundary-strip boundary-strip-zone" aria-hidden="true">
            <span className="b-band" />
        </div>
    );
}

export default function IncidentCard({ incident, selected, onSelect }) {
    return (
        <button
            className={`incident-card${selected ? ' incident-card-selected' : ''}`}
            onClick={() => onSelect(incident.incident_id)}
        >
            <div className="incident-card-top">
                <span className={`badge ${CONFIDENCE_BADGE[incident.confidence] || 'badge-medium'}`}>
                    {incident.confidence} confidence
                </span>
                <span className="incident-status">{STATUS_LABELS[incident.status] || incident.status}</span>
            </div>

            <div className="incident-title">{TYPE_LABELS[incident.type] || incident.type}</div>

            <BoundaryStrip incident={incident} />

            <div className="incident-meta">
                <span className="mono">{incident.affected_poles_count} pole{incident.affected_poles_count === 1 ? '' : 's'} affected</span>
                {incident.pincode && <span className="mono">PIN {incident.pincode}</span>}
            </div>

            {incident.possibly_scheduled && (
                <div className="incident-flag">
                    May match scheduled outage {incident.possibly_scheduled} -- review before dispatching
                </div>
            )}
        </button>
    );
}