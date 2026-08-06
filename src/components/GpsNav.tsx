import type { GpsTelemetry } from '../types/telemetry'

const NA = '--'

interface Props {
  gps: GpsTelemetry
}

function StaticGrid() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 120 130" preserveAspectRatio="none">
      <line x1="30"  y1="0" x2="30"  y2="130" stroke="#00ff66" strokeWidth="0.5" opacity="0.3" />
      <line x1="60"  y1="0" x2="60"  y2="130" stroke="#00ff66" strokeWidth="0.5" opacity="0.3" />
      <line x1="90"  y1="0" x2="90"  y2="130" stroke="#00ff66" strokeWidth="0.5" opacity="0.3" />
      <line x1="0" y1="32"  x2="120" y2="32"  stroke="#00ff66" strokeWidth="0.5" opacity="0.3" />
      <line x1="0" y1="65"  x2="120" y2="65"  stroke="#00ff66" strokeWidth="0.5" opacity="0.3" />
      <line x1="0" y1="98"  x2="120" y2="98"  stroke="#00ff66" strokeWidth="0.5" opacity="0.3" />
    </svg>
  )
}

export default function GpsNav({ gps }: Props) {
  const lat = gps.latitude
  const lon = gps.longitude

  const latStr =
    lat !== null
      ? `${Math.abs(lat).toFixed(4)} ${lat >= 0 ? 'N' : 'S'}`
      : NA
  const lonStr =
    lon !== null
      ? `${Math.abs(lon).toFixed(4)} ${lon >= 0 ? 'E' : 'W'}`
      : NA

  return (
    <div className="border border-green flex flex-col h-full">
      <div className="px-2 pt-[6px] pb-1 text-[11px] font-bold">GPS NAV</div>
      <hr className="border-t border-dashed border-green opacity-50 mx-2 mb-[6px]" />

      <div className="px-2 pb-2 flex-1">
        <div className="leading-[1.8] mb-2">
          <div>LAT: {latStr}</div>
          <div>LON: {lonStr}</div>
        </div>

        {/* Map container — OpenStreetMap iframe placeholder */}
        <div className="border border-green relative overflow-hidden" style={{ height: 130 }}>
          <StaticGrid />
          {lat !== null && lon !== null && (
            <div
              className="absolute w-[5px] h-[5px] bg-green rounded-full"
              style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
            />
          )}
          {(lat === null || lon === null) && (
            <div className="absolute inset-0 flex items-center justify-center text-green-dark text-[9px]">
              NO FIX
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
