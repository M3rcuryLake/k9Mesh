import type { BatteryTelemetry } from '../types/telemetry'

const NA = '--'

interface Props {
  battery: BatteryTelemetry
}

function BatteryBar({ percent }: { percent: number | null }) {
  if (percent === null) {
    return (
      <div style={{ height: 10, background: 'rgba(0,229,255,0.06)', border: '1px solid var(--cyan-border)', marginTop: 4 }}>
        <div style={{ fontSize: 9, color: 'var(--cyan-label)', textAlign: 'center', lineHeight: '10px' }}>NO DATA</div>
      </div>
    )
  }
  const pct = Math.min(100, Math.max(0, percent))
  const color = pct > 50 ? '#00ff88' : pct > 20 ? '#e0a000' : '#ff4444'
  return (
    <div style={{ height: 10, background: 'rgba(0,229,255,0.06)', border: '1px solid var(--cyan-border)', marginTop: 4, position: 'relative' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, opacity: 0.7 }} />
    </div>
  )
}

export default function BatteryPanel({ battery }: Props) {
  const pct = battery.percent !== null ? `${battery.percent}%` : NA
  const pctColor = battery.percent !== null
    ? battery.percent > 50 ? '#00ff88' : battery.percent > 20 ? '#e0a000' : '#ff4444'
    : 'var(--cyan-label)'

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--panel)',
      border: '1px solid var(--cyan-border)',
      flexShrink: 0,
    }}>
      <div style={{
        padding: '4px 8px',
        borderBottom: '1px solid var(--cyan-border)',
        fontSize: 10,
        fontWeight: 'bold',
        letterSpacing: '0.08em',
        color: 'var(--cyan)',
      }}>
        BATTERY
      </div>

      <div style={{ padding: '8px 10px' }}>
        {/* Large percent */}
        <div style={{ fontSize: 28, fontWeight: 'bold', color: pctColor, lineHeight: 1 }}>
          {pct}
        </div>
        <BatteryBar percent={battery.percent} />

        {/* Details */}
        <div style={{ marginTop: 8, fontSize: 10, lineHeight: 1.9 }}>
          {[
            ['VOLTAGE', battery.voltage !== null ? `${battery.voltage}V` : NA],
            ['EST TIME', battery.estTime ?? NA],
            ['DISCHARGE', battery.discharge ?? NA],
          ].map(([label, val]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--cyan-label)' }}>{label}</span>
              <span style={{ color: 'var(--cyan)' }}>{val}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
