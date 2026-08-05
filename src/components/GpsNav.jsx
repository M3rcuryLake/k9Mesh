const NA = '--'

export default function GpsNav({ gps }) {
  const lat = gps.latitude
  const lon = gps.longitude

  const latStr = lat !== null ? `${Math.abs(lat).toFixed(4)} ${lat >= 0 ? 'N' : 'S'}` : NA
  const lonStr = lon !== null ? `${Math.abs(lon).toFixed(4)} ${lon >= 0 ? 'E' : 'W'}` : NA

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-title">GPS NAV</div>
      <hr className="divider" />
      <div className="section-inner" style={{ flex: 1 }}>
        <div style={{ fontSize: '10px', lineHeight: '1.8', marginBottom: '6px' }}>
          <div>LAT: {latStr}</div>
          <div>LON: {lonStr}</div>
        </div>
        <div style={{ border: '1px solid var(--green)', height: '130px', position: 'relative', overflow: 'hidden' }}>
          <StaticGrid />
          {lat !== null && lon !== null && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: '5px',
              height: '5px',
              background: '#00ff66',
              borderRadius: '50%',
              transform: 'translate(-50%, -50%)',
            }} />
          )}
          {(lat === null || lon === null) && (
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#004422',
              fontSize: '9px',
            }}>NO FIX</div>
          )}
        </div>
      </div>
    </div>
  )
}

function StaticGrid() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 120 130" preserveAspectRatio="none">
      <line x1="40" y1="0" x2="40" y2="130" stroke="#00ff66" strokeWidth="0.5" opacity="0.3" />
      <line x1="80" y1="0" x2="80" y2="130" stroke="#00ff66" strokeWidth="0.5" opacity="0.3" />
      <line x1="0" y1="43" x2="120" y2="43" stroke="#00ff66" strokeWidth="0.5" opacity="0.3" />
      <line x1="0" y1="86" x2="120" y2="86" stroke="#00ff66" strokeWidth="0.5" opacity="0.3" />
    </svg>
  )
}
