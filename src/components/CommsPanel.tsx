import type { RadioTelemetry } from '../types/telemetry'

const NA = '--'

interface Props {
  radio: RadioTelemetry
}

function SignalBlocks({ percent }: { percent: number | null }) {
  const filled = percent !== null ? Math.round(percent / 10) : 0
  return (
    <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} style={{
          width: 18,
          height: 8,
          background: i < filled ? 'var(--cyan)' : 'rgba(0,229,255,0.08)',
          border: '1px solid var(--cyan-border)',
        }} />
      ))}
    </div>
  )
}

export default function CommsPanel({ radio }: Props) {
  const signalPct = radio.signalPercent !== null ? `SIGNAL ${radio.signalPercent}%` : 'SIGNAL --'

  const lqColor =
    radio.linkQuality === 'EXCELLENT' ? '#00ff88'
    : radio.linkQuality === 'GOOD' ? '#00cc66'
    : radio.linkQuality === 'FAIR' ? '#e0a000'
    : radio.linkQuality === 'POOR' ? '#ff4444'
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
        COMMS
      </div>

      <div style={{ padding: '6px 10px', fontSize: 10 }}>
        {/* Signal bar */}
        <div style={{ fontSize: 9, color: 'var(--cyan-label)', marginBottom: 2 }}>{signalPct}</div>
        <SignalBlocks percent={radio.signalPercent} />

        {/* Details */}
        <div style={{ marginTop: 8, lineHeight: 2.0 }}>
          {[
            ['RSSI', radio.rssi !== null ? `${radio.rssi} dBm` : NA],
            ['CHANNEL', radio.channel !== null ? String(radio.channel) : NA],
            ['DROPPED', radio.dropped !== null ? String(radio.dropped) : NA],
            ['LATENCY', radio.latency !== null ? `${radio.latency} MS` : NA],
          ].map(([label, val]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--cyan-label)' }}>{label}</span>
              <span style={{ color: 'var(--cyan)' }}>{val}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--cyan-label)' }}>QUALITY</span>
            <span style={{ color: lqColor, fontWeight: 'bold' }}>{radio.linkQuality ?? NA}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
