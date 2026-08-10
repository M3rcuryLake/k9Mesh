import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import type { GpsTelemetry, CsiTelemetry } from '../types/telemetry';

// Fix for default leaflet icons not resolving in Vite builds
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

L.Icon.Default.mergeOptions({
  iconRetinaUrl,
  iconUrl,
  shadowUrl,
});

// Custom Icons
const operatorIcon = new L.Icon({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  className: 'operator-marker-icon'
});

const roverIcon = new L.Icon({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  className: 'rover-marker-icon' // Could be styled via CSS filters to change color
});

const detectionIcon = new L.Icon({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
  iconSize: [20, 32],
  iconAnchor: [10, 32],
  className: 'detection-marker-icon'
});

// Component to handle auto-centering on the rover initially
function MapController({ center }: { center: [number, number] | null }) {
  const map = useMap();
  const initialized = useRef(false);

  useEffect(() => {
    if (center && !initialized.current) {
      map.setView(center, 18);
      initialized.current = true;
    }
  }, [center, map]);

  return null;
}

interface OperationalMapProps {
  gps: GpsTelemetry;
  csi: CsiTelemetry;
}

export default function OperationalMap({ gps, csi }: OperationalMapProps) {
  const [operatorLoc, setOperatorLoc] = useState<[number, number] | null>(null);
  const [operatorError, setOperatorError] = useState<string | null>(null);
  
  const [trail, setTrail] = useState<[number, number][]>([]);
  const [detections, setDetections] = useState<[number, number][]>([]);
  
  const prevBreathing = useRef<boolean | null>(null);

  // 1. Operator Geolocation
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setOperatorLoc([pos.coords.latitude, pos.coords.longitude]),
        (err) => setOperatorError('LOCATION UNAVAILABLE'),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    } else {
      setOperatorError('LOCATION UNAVAILABLE');
    }
  }, []);

  // 2. Rover Trail accumulation (Valid GPS only)
  const roverPos: [number, number] | null = 
    (gps.latitude !== null && gps.longitude !== null) 
      ? [gps.latitude, gps.longitude] 
      : null;

  useEffect(() => {
    if (roverPos) {
      setTrail((prev) => {
        // Prevent duplicate consecutive points
        if (prev.length > 0) {
          const last = prev[prev.length - 1];
          if (last[0] === roverPos[0] && last[1] === roverPos[1]) return prev;
        }
        return [...prev, roverPos].slice(-1000); // Bound trail to 1000 items
      });
    }
  }, [gps.latitude, gps.longitude]);

  // 3. Detection Edge Trigger
  useEffect(() => {
    const isBreathing = csi.breathingDetected;
    const wasBreathing = prevBreathing.current;

    // False -> True transition
    if (isBreathing === true && wasBreathing === false && roverPos) {
      setDetections((prev) => [...prev, roverPos].slice(-100)); // Bound detections to 100 items
    }

    if (isBreathing !== null) {
      prevBreathing.current = isBreathing;
    }
  }, [csi.breathingDetected, gps.latitude, gps.longitude]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        border: '1px solid var(--cyan)',
        background: 'var(--navy)',
        padding: 4,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--cyan)', paddingBottom: 4, marginBottom: 4 }}>
        <span style={{ fontWeight: 'bold' }}>OPERATIONAL MAP</span>
        <span>
          {roverPos ? `ROVER: ${roverPos[0].toFixed(5)}, ${roverPos[1].toFixed(5)}` : <span style={{ color: 'var(--yellow)' }}>NO POSITION FIX</span>}
        </span>
      </div>
      
      <div style={{ flex: 1, position: 'relative' }}>
        <MapContainer 
          center={[0, 0]} 
          zoom={2} 
          style={{ height: '100%', width: '100%', background: '#001219' }}
          zoomControl={false}
          attributionControl={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapController center={roverPos || operatorLoc || null} />

          {/* Operator Marker */}
          {operatorLoc && (
            <Marker position={operatorLoc} icon={operatorIcon}>
              <Popup>CONTROL_UNIT</Popup>
            </Marker>
          )}

          {/* Rover Marker */}
          {roverPos && (
            <Marker position={roverPos} icon={roverIcon}>
              <Popup>ROVER_LOC</Popup>
            </Marker>
          )}

          {/* Rover Trail */}
          <Polyline positions={trail} color="var(--cyan)" weight={3} opacity={0.7} />

          {/* Detections */}
          {detections.map((pt, i) => (
            <Marker key={i} position={pt} icon={detectionIcon}>
              <Popup>LIFE SIGN</Popup>
            </Marker>
          ))}
        </MapContainer>

        {/* CSS override for marker colors if needed, purely visual */}
        <style>{`
          .operator-marker-icon { filter: hue-rotate(180deg); }
          .detection-marker-icon { filter: hue-rotate(0deg) saturate(3); }
        `}</style>
      </div>
      
      <div style={{ marginTop: 4, fontSize: 10, display: 'flex', justifyContent: 'space-between' }}>
        <span>OPERATOR: {operatorLoc ? `${operatorLoc[0].toFixed(4)}, ${operatorLoc[1].toFixed(4)}` : operatorError || 'ACQUIRING...'}</span>
        <span>TRAIL POINTS: {trail.length} | DETECTIONS: {detections.length}</span>
      </div>
    </div>
  );
}
