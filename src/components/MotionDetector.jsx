const NA = '--'

const LEVEL_LABELS = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
}

const TERRAIN_PATH =
  'M0,28 L30,28 L38,22 L46,16 L54,22 L62,28 L80,28 L88,22 L96,28 L110,28 L116,23 L120,19 L124,23 L128,18 L132,22 L136,28 L155,28 L162,24 L168,28 L200,28'

export default function MotionDetector({ motion }) {
  const level =
    motion.level !== null && motion.level !== undefined
      ? (LEVEL_LABELS[motion.level] ?? motion.level)
      : null

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-title">MOTION DETECTOR</div>
      <hr className="divider" />

      <div className="section-inner" style={{ display: 'flex', gap: '12px', alignItems: 'baseline' }}>
        <span style={{ color: 'var(--green-dark)', fontSize: '9px' }}>STATE:</span>
        <span style={{ fontWeight: 'bold', letterSpacing: '1px' }}>
          {level !== null ? level : NA}
        </span>
      </div>

      <div style={{ flex: 1, padding: '0 8px 6px 8px', display: 'flex', flexDirection: 'column' }}>
        <svg
          viewBox="0 0 200 110"
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
          style={{ display: 'block' }}
        >
          {/*  Rover body  */}
          {/* chassis */}
          <rect x="83" y="6" width="34" height="10" fill="none" stroke="#00ff66" strokeWidth="1" />
          {/* antenna */}
          <line x1="100" y1="6" x2="100" y2="2" stroke="#00ff66" strokeWidth="1" />
          <circle cx="100" cy="1" r="1" fill="#00ff66" />
          {/* left wheel */}
          <rect x="80" y="13" width="8" height="4" rx="1" fill="none" stroke="#00ff66" strokeWidth="0.8" />
          {/* right wheel */}
          <rect x="112" y="13" width="8" height="4" rx="1" fill="none" stroke="#00ff66" strokeWidth="0.8" />

          {/* ── Terrain surface ── */}
          <path
            d={TERRAIN_PATH}
            fill="none"
            stroke="#00ff66"
            strokeWidth="1.2"
          />

          {/* Terrain label */}
          <text x="2" y="36" fontSize="5" fill="#004422" fontFamily="Courier New, monospace">TERRAIN</text>

          {/* ── Ground Penetrating Radar wavefronts ── */}
          {/* Each arc is centered beneath the rover (cx=100), propagating downward */}
          {/* Arc 1 — nearest */}
          <path d="M88,42 Q100,50 112,42" fill="none" stroke="#00aa44" strokeWidth="0.9" opacity="0.9" />
          {/* Arc 2 */}
          <path d="M80,52 Q100,64 120,52" fill="none" stroke="#00aa44" strokeWidth="0.9" opacity="0.75" />
          {/* Arc 3 */}
          <path d="M70,63 Q100,78 130,63" fill="none" stroke="#00aa44" strokeWidth="0.9" opacity="0.6" />
          {/* Arc 4 — farthest */}
          <path d="M58,76 Q100,94 142,76" fill="none" stroke="#00aa44" strokeWidth="0.9" opacity="0.4" />

          {/* GPR label */}
          <text x="2" y="48" fontSize="5" fill="#004422" fontFamily="Courier New, monospace">GPR</text>

          {/*  Survivor detection zone  */}
          {/* Dashed bounding box — reserved for future detections */}
          <rect
            x="85" y="84" width="30" height="18"
            fill="none"
            stroke="#004422"
            strokeWidth="0.7"
            strokeDasharray="2,2"
          />
          {/* Static placeholder marker */}
          <circle cx="100" cy="93" r="2.5" fill="none" stroke="#00aa44" strokeWidth="0.9" />
          <text x="88" y="107" fontSize="4.5" fill="#004422" fontFamily="Courier New, monospace">SURVIVOR ZONE</text>
        </svg>
      </div>

      <div style={{
        padding: '4px 8px',
        borderTop: '1px dashed var(--green)',
        opacity: 0.7,
        fontSize: '10px',
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>LAST EVENT: {motion.lastEventSeconds !== null ? `T - ${motion.lastEventSeconds}S` : NA}</span>
        <span style={{ color: 'var(--green-dark)' }}>GPR STATIC</span>
      </div>
    </div>
  )
}
