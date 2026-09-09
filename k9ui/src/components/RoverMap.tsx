import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTelemetry } from '@/telemetry/TelemetryProvider';
import { poseToLatLng } from '@/telemetry/mockGenerator';
import type { GpsOrigin } from '@/types/telemetry';

const MAP_ZOOM = 18;
const CACHE_KEY = 'k9mesh:gps-origin';
const NEUTRAL_ORIGIN: GpsOrigin = { latitude: 0, longitude: 0 };

function loadCachedOrigin(): GpsOrigin | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GpsOrigin;
    if (
      typeof parsed.latitude === 'number' &&
      typeof parsed.longitude === 'number'
    ) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

function cacheOrigin(origin: GpsOrigin): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(origin));
  } catch {
    // ignore
  }
}

function createGridLayer(): L.GridLayer {
  return L.gridLayer({
    tileSize: 256,
    className: 'offline-grid',
  });
}

function createRoverIcon(theta: number, stale: boolean): L.DivIcon {
  const color = stale ? '#64748b' : '#22d3ee';
  const glowColor = stale ? '#475569' : '#22d3ee';
  const svg = `
    <div style="transform: rotate(${theta}deg); transition: transform 0.3s ease;">
      <svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          <radialGradient id="halo">
            <stop offset="0%" stop-color="${glowColor}" stop-opacity="0.4"/>
            <stop offset="100%" stop-color="${glowColor}" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <circle cx="18" cy="18" r="16" fill="url(#halo)"/>
        <g filter="url(#glow)">
          <path d="M18 6 L24 24 L18 20 L12 24 Z" fill="${color}" stroke="${glowColor}" stroke-width="1.5" opacity="${stale ? 0.5 : 1}"/>
        </g>
        <circle cx="18" cy="18" r="2" fill="${stale ? '#94a3b8' : '#fff'}"/>
      </svg>
    </div>
  `;
  return L.divIcon({
    html: svg,
    className: 'rover-marker',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

export function RoverMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const roverMarkerRef = useRef<L.Marker | null>(null);
  const moveCircleRef = useRef<L.Circle | null>(null);
  const breathCircleRef = useRef<L.Circle | null>(null);
  const trailRef = useRef<L.Polyline | null>(null);
  const trailPointsRef = useRef<{ lat: number; lng: number }[]>([]);
  const sweepMarkerRef = useRef<L.Marker | null>(null);
  const [stale, setStale] = useState(false);
  const [origin, setOrigin] = useState<GpsOrigin>(
    () => loadCachedOrigin() ?? NEUTRAL_ORIGIN
  );
  const [locationUnavailable, setLocationUnavailable] = useState(false);

  const mountedRef = useRef(true);

  const { telemetry, connectionStatus } = useTelemetry();

  // Init map — always renders immediately, never gated on data
  useEffect(() => {
    if (!mountedRef.current) return;
    if (!containerRef.current || mapRef.current) return;

    const initialOrigin = loadCachedOrigin() ?? NEUTRAL_ORIGIN;
    setOrigin(initialOrigin);

    const map = L.map(containerRef.current, {
      center: [initialOrigin.latitude, initialOrigin.longitude],
      zoom: MAP_ZOOM,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
    });

    const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 22,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    let tilesLoaded = 0;
    let tilesErrored = 0;
    let fallbackGrid: L.GridLayer | null = null;

    tileLayer.on('tileerror', () => {
      tilesErrored++;
      if (tilesLoaded === 0 && tilesErrored >= 4 && !fallbackGrid) {
        fallbackGrid = createGridLayer();
        fallbackGrid.addTo(map);
        fallbackGrid.bringToBack();
      }
    });
    tileLayer.on('tileload', () => {
      tilesLoaded++;
    });

    // If we're at neutral origin (no cache, no data), try device GPS
    if (
      initialOrigin.latitude === 0 &&
      initialOrigin.longitude === 0 &&
      navigator.geolocation
    ) {
      navigator.geolocation.getCurrentPosition(
        (position: GeolocationPosition) => {
          const loc: GpsOrigin = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
          cacheOrigin(loc);
          setOrigin(loc);
          map.setView([loc.latitude, loc.longitude], MAP_ZOOM, { animate: true });
        },
        () => {
          setLocationUnavailable(true);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
    }

    const roverIcon = createRoverIcon(0, false);
    const roverMarker = L.marker([initialOrigin.latitude, initialOrigin.longitude], {
      icon: roverIcon,
      zIndexOffset: 1000,
    }).addTo(map);

    const moveCircle = L.circle(
      [initialOrigin.latitude, initialOrigin.longitude],
      {
        radius: 12,
        color: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 0,
        weight: 1.5,
        opacity: 0,
      }
    ).addTo(map);

    const breathCircle = L.circle(
      [initialOrigin.latitude, initialOrigin.longitude],
      {
        radius: 8,
        color: '#fbbf24',
        fillColor: '#fbbf24',
        fillOpacity: 0,
        weight: 1.5,
        opacity: 0,
      }
    ).addTo(map);

    const trail = L.polyline([], {
      color: '#22d3ee',
      weight: 2,
      opacity: 0.4,
      dashArray: '4,6',
    }).addTo(map);

    mapRef.current = map;
    roverMarkerRef.current = roverMarker;
    moveCircleRef.current = moveCircle;
    breathCircleRef.current = breathCircle;
    trailRef.current = trail;

    return () => {
      mountedRef.current = false;
      if (mapRef.current) mapRef.current.remove();
      roverMarkerRef.current = null;
      moveCircleRef.current = null;
      breathCircleRef.current = null;
      trailRef.current = null;
      fallbackGrid = null;
    };
  }, []);

  // When telemetry arrives with gps_origin, use it as the authoritative origin
  useEffect(() => {
    if (!mountedRef.current) return;
    if (!telemetry?.gps_origin) return;
    const go = telemetry.gps_origin;
    cacheOrigin(go);
    setOrigin(go);
  }, [telemetry?.gps_origin]);

  // Re-center map when origin changes (but not at neutral 0,0 unless that's all we have)
  useEffect(() => {
    if (!mountedRef.current) return;
    if (!mapRef.current) return;
    mapRef.current.setView([origin.latitude, origin.longitude], MAP_ZOOM, {
      animate: true,
    });
  }, [origin]);

  // Update from telemetry
  useEffect(() => {
    if (!mountedRef.current) return;
    if (!telemetry || !mapRef.current || !roverMarkerRef.current) return;
    if (telemetry.pose == null) return;

    const pos = poseToLatLng(
      { x: telemetry.pose.x ?? 0, y: telemetry.pose.y ?? 0 },
      origin
    );
    const rover = roverMarkerRef.current;
    const moveCircle = moveCircleRef.current;
    const breathCircle = breathCircleRef.current;
    const trail = trailRef.current;

    const isOffline = connectionStatus === 'offline';
    setStale(telemetry.stale || isOffline);

    rover.setIcon(createRoverIcon(telemetry.pose.theta_deg ?? 0, telemetry.stale));
    rover.setLatLng([pos.lat, pos.lng]);
    sweepMarkerRef.current?.setLatLng([pos.lat, pos.lng]);

    if (!telemetry.stale) {
      trailPointsRef.current.push({ lat: pos.lat, lng: pos.lng });
      if (trailPointsRef.current.length > 200) trailPointsRef.current.shift();
      trail?.setLatLngs(trailPointsRef.current);
    }

    const moveConf = telemetry.mvs?.confidence ?? 0;
    if (moveConf > 50 && moveCircle) {
      const opacity = ((moveConf - 50) / 50) * 0.45;
      moveCircle.setLatLng([pos.lat, pos.lng]);
      moveCircle.setStyle({
        fillOpacity: opacity,
        opacity: opacity * 0.7,
        weight: 1.5,
      });
    } else if (moveCircle) {
      moveCircle.setStyle({ fillOpacity: 0, opacity: 0 });
    }

    const breathConf = telemetry.breath?.confidence ?? 0;
    if (breathConf > 50 && breathCircle) {
      const opacity = ((breathConf - 50) / 50) * 0.45;
      breathCircle.setLatLng([pos.lat, pos.lng]);
      breathCircle.setStyle({
        fillOpacity: opacity,
        opacity: opacity * 0.7,
        weight: 1.5,
      });
    } else if (breathCircle) {
      breathCircle.setStyle({ fillOpacity: 0, opacity: 0 });
    }
  }, [telemetry, origin, connectionStatus]);

  // Radar sweep
  useEffect(() => {
    if (!mountedRef.current) return;
    const map = mapRef.current;
    if (!map) return;

    const sweepSize = 120;
    const sweepIcon = L.divIcon({
      className: 'radar-sweep',
      html: `<div style="width:${sweepSize}px;height:${sweepSize}px;">
        <svg width="${sweepSize}" height="${sweepSize}" viewBox="0 0 100 100" style="animation: radar-sweep 4s linear infinite;">
          <defs>
            <radialGradient id="sweep-bg" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.06"/>
              <stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/>
            </radialGradient>
            <linearGradient id="sweep-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.5"/>
              <stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="48" fill="url(#sweep-bg)"/>
          <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(34,211,238,0.12)" stroke-width="0.5"/>
          <path d="M50 50 L50 2 A48 48 0 0 1 98 50 Z" fill="url(#sweep-grad)"/>
        </svg>
      </div>`,
      iconSize: [sweepSize, sweepSize],
      iconAnchor: [sweepSize / 2, sweepSize / 2],
    });

    const sweepMarker = L.marker([origin.latitude, origin.longitude], {
      icon: sweepIcon,
      interactive: false,
      zIndexOffset: 500,
    }).addTo(map);

    sweepMarkerRef.current = sweepMarker;

    return () => {
      sweepMarker.remove();
      sweepMarkerRef.current = null;
    };
  }, [origin.latitude, origin.longitude]);

  const atNeutralOrigin = origin.latitude === 0 && origin.longitude === 0;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-ink-500/40 bg-ink-800">
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* Header overlay */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-[500] flex items-start justify-between px-5 py-4">
        <div>
          <h2 className="text-sm font-medium tracking-wide text-slate-200">
            Rover Position — Live Map
          </h2>
          <p className="mt-1 font-mono text-[10px] text-slate-500">
            {origin.latitude.toFixed(4)}, {origin.longitude.toFixed(4)} · 50m × 50m · GPS
          </p>
        </div>
        <div className="flex items-center gap-2">
          {stale && (
            <div className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              <span className="font-mono text-[10px] text-amber-300">STALE</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-500/5 px-2.5 py-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
            <span className="font-mono text-[10px] text-cyan-300">
              {telemetry
                ? `${telemetry.pose.x?.toFixed(1) ?? '—'}, ${telemetry.pose.y?.toFixed(1) ?? '—'}m · ${telemetry.pose.theta_deg?.toFixed(0) ?? '—'}°`
                : 'awaiting pose…'}
            </span>
          </div>
        </div>
      </div>

      {/* Location unavailable hint */}
      {atNeutralOrigin && locationUnavailable && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-[500] -translate-x-1/2 rounded-lg border border-amber-500/30 bg-ink-900/80 px-3 py-1.5 backdrop-blur-sm">
          <span className="font-mono text-[10px] text-amber-300">
            Location unavailable — showing default view
          </span>
        </div>
      )}

      {/* Legend */}
      <div className="pointer-events-none absolute bottom-4 right-4 z-[500] flex flex-col gap-1.5 rounded-lg border border-ink-500/40 bg-ink-900/80 px-3.5 py-2.5 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 shadow-glow" />
          <span className="font-mono text-[10px] text-slate-400">Rover</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-500/60" />
          <span className="font-mono text-[10px] text-slate-400">Movement</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/60" />
          <span className="font-mono text-[10px] text-slate-400">Breathing</span>
        </div>
      </div>

      {/* Gradient vignette */}
      <div className="pointer-events-none absolute inset-0 z-[450] rounded-xl shadow-inner-glow" />
    </div>
  );
}
