const W = 240
const H = 52

/** Static terrain silhouette — explicitly a visual UI placeholder, NOT real sensor data */
export default function TerrainPanel() {
  return (
    <div style={{
      flex: '0 0 auto',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--panel)',
      border: '1px solid var(--cyan-border)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '4px 8px',
        borderBottom: '1px solid var(--cyan-border)',
      }}>
        <span style={{ fontSize: 10, fontWeight: 'bold', letterSpacing: '0.08em', color: 'var(--cyan)' }}>
          TERRAIN RADAR
        </span>
        <span style={{ fontSize: 9, color: 'var(--cyan-label)', border: '1px solid var(--cyan-border)', padding: '1px 5px' }}>
          SONAR
        </span>
      </div>

      <div style={{ padding: '4px 8px', fontSize: 9, color: 'var(--cyan-label)' }}>
        STATE: <span style={{ color: 'var(--text-mid)' }}>NO SENSOR DATA</span>
      </div>

      <div style={{ padding: '0 8px 6px', flex: 1 }}>
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {/* Grid */}
          {[W * 0.33, W * 0.66].map(x => (
            <line key={x} x1={x} y1={0} x2={x} y2={H} stroke="var(--cyan-grid)" strokeWidth={0.5} />
          ))}
          <line x1={0} y1={H * 0.5} x2={W} y2={H * 0.5} stroke="var(--cyan-grid)" strokeWidth={0.5} />

          {/* Terrain profile silhouette — static decorative element */}
          <polyline
            points={`0,${H} 20,${H} 40,${H - 2} 60,${H - 3} 80,${H - 5} 100,${H - 8} 115,${H - 14} 125,${H - 20} 135,${H - 18} 145,${H - 16} 160,${H - 10} 180,${H - 5} 200,${H - 3} ${W},${H - 2}`}
            fill="none" stroke="rgba(0,229,255,0.5)" strokeWidth={1.5}
          />

          {/* Rover silhouette on peak */}
          <rect x={108} y={H - 34} width={18} height={8} fill="none" stroke="var(--cyan)" strokeWidth={1} />
          <rect x={104} y={H - 28} width={4} height={3} fill="rgba(0,229,255,0.7)" />
          <rect x={126} y={H - 28} width={4} height={3} fill="rgba(0,229,255,0.7)" />
          <line x1={117} y1={H - 34} x2={117} y2={H - 40} stroke="var(--cyan)" strokeWidth={0.8} />
          {/* Sonar arcs */}
          <path d={`M 112,${H - 26} Q 117,${H - 20} 122,${H - 26}`} fill="none" stroke="var(--cyan)" strokeWidth={0.8} opacity={0.5} />
          <path d={`M 108,${H - 26} Q 117,${H - 14} 126,${H - 26}`} fill="none" stroke="var(--cyan)" strokeWidth={0.8} opacity={0.3} />
        </svg>
      </div>
    </div>
  )
}
