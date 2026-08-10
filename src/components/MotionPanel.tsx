import { useRef } from 'react'
import type { MotionTelemetry } from '../types/telemetry'

const NA = '--'
const MAX_POINTS = 100
const W = 280
const H = 110
const MAGENTA = '#e000a8'
const CYAN_DIM = 'rgba(0,229,255,0.45)'

function mkPoints(hist: (number | null)[], yMin: number, yMax: number): string {
  const range = yMax - yMin || 1
  return hist
    .map((v, i) => {
      if (v === null) return null
      const x = (i / Math.max(hist.length - 1, 1)) * W
      const y = H - ((v - yMin) / range) * H * 0.85 - H * 0.05
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .filter(Boolean)
    .join(' ')
}

interface Props {
  motion: MotionTelemetry
}

export default function MotionPanel({ motion }: Props) {
  const varRef = useRef<(number | null)[]>([])
  const thrRef = useRef<(number | null)[]>([])

  // Push during render
  const vHist = varRef.current
  const tHist = thrRef.current
  vHist.push(motion.variance)
  tHist.push(motion.threshold)
  if (vHist.length > MAX_POINTS) vHist.shift()
  if (tHist.length > MAX_POINTS) tHist.shift()

  const allVals = [
    ...vHist.filter((v): v is number => v !== null),
    ...tHist.filter((v): v is number => v !== null),
  ]
  const hasData = allVals.length > 0
  const yMin = hasData ? Math.min(...allVals) * 0.9 : 0
  const yMax = hasData ? Math.max(...allVals) * 1.1 || 0.001 : 0.001

  const varPoints = hasData ? mkPoints(vHist, yMin, yMax) : ''
  const thrPoints = hasData ? mkPoints(tHist, yMin, yMax) : ''

  const levelStr = motion.level ?? NA
  const varStr = motion.variance !== null ? motion.variance.toFixed(5) : NA
  const thrStr = motion.threshold !== null ? motion.threshold.toFixed(5) : NA
  const confPct = motion.variance !== null && motion.threshold !== null && motion.threshold > 0
    ? Math.min(100, Math.round((motion.variance / motion.threshold) * 100))
    : null

  const levelColor =
    motion.level === 'HIGH' ? MAGENTA
    : motion.level === 'MEDIUM' ? '#e0a000'
    : motion.level === 'LOW' ? '#00ff88'
    : 'var(--cyan-label)'

  return (
    <div style={{
      flex: '0 0 auto',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--panel)',
      border: '1px solid var(--cyan-border)',
      minHeight: 0,
    }}>
      {/* Title bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '4px 8px',
        borderBottom: '1px solid var(--cyan-border)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, fontWeight: 'bold', letterSpacing: '0.08em', color: 'var(--cyan)' }}>
          MOTION DETECTION
        </span>
        <span style={{ fontSize: 9, color: 'var(--cyan-label)', border: '1px solid var(--cyan-border)', padding: '1px 5px' }}>
          CSI_ARRAY
        </span>
      </div>

      {/* Intensity readout */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 8px 2px', flexShrink: 0 }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 9, color: 'var(--cyan-label)' }}>INTENSITY</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: MAGENTA, letterSpacing: '0.04em' }}>
            {confPct !== null ? `${String(confPct).padStart(2, '0')}%` : NA}
          </div>
        </div>
      </div>

      {/* Graph */}
      <div style={{ flex: 1, padding: '0 8px', minHeight: 70, position: 'relative' }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {/* Grid */}
          {[0.25, 0.5, 0.75].map(f => (
            <line key={f} x1={0} y1={H * f} x2={W} y2={H * f}
              stroke="var(--cyan-grid)" strokeWidth={0.5} />
          ))}
          {/* Threshold trace (dim) */}
          {hasData && thrPoints && (
            <polyline points={thrPoints} fill="none" stroke={CYAN_DIM} strokeWidth={1} strokeDasharray="4 3" />
          )}
          {/* Variance trace (magenta) */}
          {hasData && varPoints && (
            <polyline points={varPoints} fill="none" stroke={MAGENTA} strokeWidth={1.5} strokeLinejoin="round" />
          )}
          {!hasData && (
            <text x={W / 2} y={H / 2} textAnchor="middle" dominantBaseline="middle"
              fill="var(--cyan-label)" fontSize={10} fontFamily="'Courier New', monospace">
              AWAITING SIGNAL...
            </text>
          )}
        </svg>
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '4px 8px',
        borderTop: '1px solid var(--cyan-border)',
        flexShrink: 0,
        fontSize: 10,
      }}>
        <div>
          <div style={{ color: 'var(--cyan-label)' }}>THRESHOLD</div>
          <div style={{ color: 'var(--text-mid)', fontWeight: 'bold' }}>{thrStr}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: 'var(--cyan-label)' }}>STATE</div>
          <div style={{ color: levelColor, fontWeight: 'bold' }}>{levelStr}</div>
        </div>
      </div>
    </div>
  )
}
