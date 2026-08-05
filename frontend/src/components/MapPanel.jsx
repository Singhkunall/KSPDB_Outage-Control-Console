import React, { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const CONFIDENCE_COLOR = {
    HIGH: '#E8A33D',
    MEDIUM: '#5C7CFA',
    LOW: '#E05C5C',
};

const DEFAULT_CENTER = [12.965, 77.58]; // Bengaluru-ish, matches seed data's fixed lat/lon box

function FlyToSelected({ tickets, selectedId }) {
    const map = useMap();
    useEffect(() => {
        if (!selectedId) return;
        const t = tickets.find(x => x.incident_id === selectedId);
        if (t && t.lat && t.lon) {
            map.flyTo([t.lat, t.lon], 16, { duration: 0.6 });
        }
    }, [selectedId, tickets, map]);
    return null;
}

export default function MapPanel({ tickets, selectedId, onSelect }) {
    const withCoords = tickets.filter(t => t.lat && t.lon);

    return (
        <MapContainer center={DEFAULT_CENTER} zoom={13} className="map-container">
            <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FlyToSelected tickets={withCoords} selectedId={selectedId} />
            {withCoords.map(t => (
                <CircleMarker
                    key={t.incident_id}
                    center={[t.lat, t.lon]}
                    radius={t.incident_id === selectedId ? 12 : 8}
                    pathOptions={{
                        color: CONFIDENCE_COLOR[t.confidence] || CONFIDENCE_COLOR.MEDIUM,
                        fillColor: CONFIDENCE_COLOR[t.confidence] || CONFIDENCE_COLOR.MEDIUM,
                        fillOpacity: t.status === 'closed' ? 0.15 : 0.7,
                        weight: t.incident_id === selectedId ? 3 : 1.5,
                    }}
                    eventHandlers={{ click: () => onSelect(t.incident_id) }}
                >
                    <Popup>
                        <div className="mono" style={{ fontSize: 12 }}>
                            <strong>{t.incident_id}</strong><br />
                            {t.type}<br />
                            {t.failed_span || t.dt_id || t.feeder_id}<br />
                            PIN {t.pincode || 'unknown'}
                        </div>
                    </Popup>
                </CircleMarker>
            ))}
        </MapContainer>
    );
}