import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap, Circle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MissionState } from '../hooks/useMissionState';
import type { RoverTelemetry } from '../types/telemetry';

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

const getRoverIcon = (thetaDeg: number | null, isLastKnown: boolean) => {
  const rotation = thetaDeg !== null ? thetaDeg : 0;
  const color = isLastKnown ? 'var(--yellow)' : 'var(--cyan)';
  return new L.DivIcon({
    className: 'directional-rover-icon',
    html: `<div style="transform: rotate(${rotation}deg); width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; opacity: ${isLastKnown ? 0.6 : 1}">
             <svg width="24" height="24" viewBox="0 0 24 24" fill="${isLastKnown ? 'transparent' : 'rgba(0, 255, 255, 0.2)'}" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               <polygon points="12 2 20 20 12 16 4 20 12 2" />
             </svg>
           </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
};

// Component to handle auto-centering on the rover initially
function MapController({ center }: { center: [number, number] | null }) {
  const map = useMap();
  const initialized = useRef(false);

  useEffect(() => {
    if (center && !initialized.current) {
      map.setView(center, 19); // ~50m working scale
      initialized.current = true;
    }
  }, [center, map]);

  return null;
}

interface OperationalMapProps {
  telemetry: RoverTelemetry;
  missionState: MissionState;
}

export default function OperationalMap({ telemetry, missionState }: OperationalMapProps) {
  const [operatorLoc, setOperatorLoc] = useState<[number, number] | null>(null);
  const [operatorError, setOperatorError] = useState<string | null>(null);
  
  const [lastKnownPos, setLastKnownPos] = useState<[number, number] | null>(null);
  const [trail, setTrail] = useState<[number, number][]>([]);

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

  // 2. Rover Location tracking (strictly GPS)
  const isLinkLost = missionState === 'LINK_LOST' || missionState === 'RECONNECTING';
  
  useEffect(() => {
    if (telemetry.gps.latitude !== null && telemetry.gps.longitude !== null && !isLinkLost) {
      const pos: [number, number] = [telemetry.gps.latitude, telemetry.gps.longitude];
      setLastKnownPos(pos);
      setTrail((prev) => {
        if (prev.length > 0) {
          const last = prev[prev.length - 1];
          if (last[0] === pos[0] && last[1] === pos[1]) return prev;
        }
        return [...prev, pos].slice(-1000);
      });
    }
  }, [telemetry.gps.latitude, telemetry.gps.longitude, isLinkLost]);

  // Determine current active display position
  const activeRoverPos = (telemetry.gps.latitude !== null && telemetry.gps.longitude !== null && !isLinkLost)
    ? [telemetry.gps.latitude, telemetry.gps.longitude] as [number, number]
    : null;
    
  const displayPos = activeRoverPos || lastKnownPos;

  // 3. Motion Detection region logic
  const confidence = telemetry.csi.confidence ? Number(telemetry.csi.confidence) : 0;
  const showMotion = confidence > 50 && activeRoverPos !== null;
  const motionOpacity = showMotion ? Math.min(0.8, Math.max(0.1, (confidence - 50) / 50)) : 0;

  // 4. Breathing Detection logic
  const respConfidence = telemetry.respiration?.confidence ?? 0;
  const respSnr = telemetry.respiration?.snr ?? 0;
  const showRespiration = respSnr > 3 && respConfidence > 50 && activeRoverPos !== null;
  const respOpacity = showRespiration ? Math.min(0.8, Math.max(0.1, (respConfidence - 50) / 50)) : 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        border: 'none',
        background: 'var(--navy)',
        padding: 4,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--cyan)', paddingBottom: 4, marginBottom: 4 }}>
        <span style={{ fontWeight: 'bold' }}>OPERATIONAL MAP</span>
        <span>
          {isLinkLost && lastKnownPos ? (
             <span style={{ color: 'var(--yellow)', fontWeight: 'bold' }}>LAST KNOWN: {lastKnownPos[0].toFixed(5)}, {lastKnownPos[1].toFixed(5)}</span>
          ) : activeRoverPos ? (
             `ROVER: ${activeRoverPos[0].toFixed(5)}, ${activeRoverPos[1].toFixed(5)}`
          ) : (
             <span style={{ color: 'var(--yellow)' }}>NO POSITION FIX</span>
          )}
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

          <MapController center={displayPos || operatorLoc || null} />

          {/* Operator Marker */}
          {operatorLoc && (
            <Marker position={operatorLoc} icon={operatorIcon}>
              <Popup>CONTROL_UNIT</Popup>
            </Marker>
          )}

          {/* Rover Marker & Heading Sprite */}
          {displayPos && (
            <Marker 
              position={displayPos} 
              icon={getRoverIcon(telemetry.pose?.thetaDeg ?? null, isLinkLost || activeRoverPos === null)}
            >
              <Popup>{isLinkLost ? 'LAST KNOWN POSE' : 'ROVER LIVE POSE'}</Popup>
            </Marker>
          )}

          {/* Rover Trail */}
          <Polyline positions={trail} color="var(--cyan)" weight={3} opacity={0.7} />

          {/* MVS Motion Region (Blue, ~5m radius) */}
          {showMotion && activeRoverPos && (
            <Circle 
              center={activeRoverPos} 
              radius={5} 
              pathOptions={{ color: '#00ccff', fillColor: '#00ccff', fillOpacity: motionOpacity, weight: 1 }} 
            />
          )}

          {/* Future Respiration Region (Yellow, ~3m radius) */}
          {showRespiration && activeRoverPos && (
            <Circle 
              center={activeRoverPos} 
              radius={3} 
              pathOptions={{ color: '#ffcc00', fillColor: '#ffcc00', fillOpacity: respOpacity, weight: 1 }} 
            />
          )}

        </MapContainer>

        <style>{`
          .operator-marker-icon { filter: hue-rotate(180deg); }
          .directional-rover-icon { background: transparent; border: none; }
        `}</style>
      </div>
      
      <div style={{ marginTop: 4, fontSize: 10, display: 'flex', justifyContent: 'space-between' }}>
        <span>OPERATOR: {operatorLoc ? `${operatorLoc[0].toFixed(4)}, ${operatorLoc[1].toFixed(4)}` : operatorError || 'ACQUIRING...'}</span>
        <span>TRAIL POINTS: {trail.length} | LOCAL POSE: {telemetry.pose?.x !== null ? `[${telemetry.pose?.x?.toFixed(2)}m, ${telemetry.pose?.y?.toFixed(2)}m]` : 'UNAVAILABLE'}</span>
      </div>
    </div>
  );
}
