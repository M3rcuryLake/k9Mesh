import { useRef } from 'react'
import type { CsiTelemetry } from '../types/telemetry'

const NA = '--'
const MAX_POINTS = 100
const W = 280
const H = 120
const CYAN = '#00e5ff'

function mkPoints(hist: (number | null)[], yMin: number, yMax: number): string {
  const range = yMax - yMin || 1
  return hist
    .map((v, i) => {
      if (v === null) return null
      const x = (i / Math.max(hist.length - 1, 1)) * W
      const y = H - ((v - yMin) / range) * H * 0.9 - H * 0.05
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .filter(Boolean)
    .join(' ')
}

interface Props {
  csi: CsiTelemetry
}

export default function BreathingPanel({ csi }: Props) {
  const histRef = useRef<(number | null)[]>([])

  // Push current value during render (ref mutation is safe outside effects)
  const h = histRef.current
  h.push(csi.breathingRate)
  if (h.length > MAX_POINTS) h.shift()

  const nonNull = h.filter((v): v is number => v !== null)
  const hasData = nonNull.length > 0
  const yMin = hasData ? Math.max(0, Math.min(...nonNull) - 2) : 0
  const yMax = hasData ? Math.max(...nonNull) + 3 : 30
  const points = hasData ? mkPoints(h, yMin, yMax) : ''

  const rateStr = csi.breathingRate !== null ? `${csi.breathingRate.toFixed(1)} BPM` : NA
  const confStr = csi.confidence !== null ? `${csi.confidence}%` : NA
  const stateStr = csi.state ?? NA
  const arrayStr = csi.arrayOnline === true ? 'ONLINE' : csi.arrayOnline === false ? 'OFFLINE' : NA

  const stateColor =
    csi.state === 'STABLE' ? '#00ff88'
    : csi.state === 'MOTION' ? '#e000a8'
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
          BREATHING FREQUENCY
        </span>
        <span style={{ fontSize: 9, color: 'var(--cyan-label)', border: '1px solid var(--cyan-border)', padding: '1px 5px' }}>
          CSI_ARRAY: {arrayStr}
        </span>
      </div>

      {/* Rate readout */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 8px 2px', flexShrink: 0 }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 9, color: 'var(--cyan-label)' }}>RATE</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: 'var(--cyan)', letterSpacing: '0.04em' }}>
            {rateStr}
          </div>
        </div>
      </div>

      {/* Graph */}
      <div style={{ flex: 1, padding: '0 8px', minHeight: 80, position: 'relative' }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map(f => (
            <line key={f} x1={0} y1={H * f} x2={W} y2={H * f}
              stroke="var(--cyan-grid)" strokeWidth={0.5} />
          ))}
          {[0.25, 0.5, 0.75].map(f => (
            <line key={f + 'v'} x1={W * f} y1={0} x2={W * f} y2={H}
              stroke="var(--cyan-grid)" strokeWidth={0.5} />
          ))}
          {/* Baseline */}
          <line x1={0} y1={H * 0.95} x2={W} y2={H * 0.95}
            stroke={CYAN} strokeWidth={0.4} strokeDasharray="4 4" opacity={0.3} />
          {/* Waveform */}
          {hasData && points && (
            <polyline points={points} fill="none" stroke={CYAN} strokeWidth={1.5} strokeLinejoin="round" />
          )}
          {!hasData && (
            <text x={W / 2} y={H / 2} textAnchor="middle" dominantBaseline="middle"
              fill="var(--cyan-label)" fontSize={10} fontFamily="'Courier New', monospace">
              AWAITING SIGNAL...
            </text>
          )}
        </svg>
      </div>

      {/* Footer metadata */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '4px 8px',
        borderTop: '1px solid var(--cyan-border)',
        flexShrink: 0,
        fontSize: 10,
      }}>
        <div>
          <div style={{ color: 'var(--cyan-label)' }}>CONFIDENCE</div>
          <div style={{ color: 'var(--cyan)', fontWeight: 'bold' }}>{confStr}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: 'var(--cyan-label)' }}>STATE</div>
          <div style={{ color: stateColor, fontWeight: 'bold' }}>{stateStr}</div>
        </div>
      </div>
    </div>
  )
}
