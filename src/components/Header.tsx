import type { RadioTelemetry } from '../types/telemetry'
import type { ConnectionStatus } from '../types/provider'

const NA = '--'

interface Props {
  radio: RadioTelemetry
  status: ConnectionStatus
}

export default function Header({ radio, status }: Props) {
  const linkLabel =
    status === 'CONNECTED' ? 'ACTIVE'
    : status === 'CONNECTING' ? 'CONNECTING'
    : status === 'RECONNECTING' ? 'RECONNECTING'
    : status === 'ERROR' ? 'ERROR'
    : 'OFFLINE'

  const linkColor =
    status === 'CONNECTED' ? '#00ff88'
    : status === 'CONNECTING' || status === 'RECONNECTING' ? '#e0a000'
    : '#ff4444'

  const latStr = radio.latency !== null ? `${radio.latency}MS` : NA

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 10px',
      height: 36,
      borderBottom: '1px solid var(--cyan-border-bright)',
      background: '#060810',
      flexShrink: 0,
    }}>
      {/* Left */}
      <div style={{ color: 'var(--cyan-label)', fontSize: 10, letterSpacing: '0.05em' }}>
        RAW CSI DATA // SYS-OP
      </div>

      {/* Center */}
      <div style={{
        fontSize: 18,
        fontWeight: 'bold',
        letterSpacing: '0.35em',
        color: 'var(--cyan)',
        border: '1px solid var(--cyan-border-bright)',
        padding: '2px 16px',
      }}>
        K9MESH
      </div>

      {/* Right */}
      <div style={{ textAlign: 'right', fontSize: 10, lineHeight: 1.7 }}>
        <div>
          <span style={{ color: 'var(--cyan-label)' }}>LINK:&nbsp;</span>
          <span style={{ color: linkColor, fontWeight: 'bold' }}>{linkLabel}</span>
        </div>
        <div>
          <span style={{ color: 'var(--cyan-label)' }}>LAT:&nbsp;</span>
          <span style={{ color: 'var(--cyan)' }}>{latStr}</span>
        </div>
      </div>
    </div>
  )
}
