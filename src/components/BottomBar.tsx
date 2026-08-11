import type { OdometryTelemetry } from '../types/telemetry'

const NA = '--'

interface Props {
  odometry: OdometryTelemetry
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '4px 10px', borderRight: '1px solid var(--cyan-border)' }}>
      <div style={{ fontSize: 9, color: 'var(--cyan-label)' }}>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--cyan)', fontWeight: 'bold' }}>{value}</div>
    </div>
  )
}

export default function BottomBar({ odometry }: Props) {
  const { speed, distance, motors } = odometry
  return (
    <div style={{
      display: 'flex',
      alignItems: 'stretch',
      flexShrink: 0,
      background: 'var(--panel)',
      border: '1px solid var(--cyan-border)',
      borderTop: 'none',
    }}>
      <Cell label="SPD" value={speed !== null ? `${speed} M/S` : NA} />
      <Cell label="DST" value={distance !== null ? `${distance} M` : NA} />
      <div style={{ flex: 1 }} />
      <Cell label="FL" value={motors.FL !== null ? `${motors.FL}` : NA} />
      <Cell label="FR" value={motors.FR !== null ? `${motors.FR}` : NA} />
      <Cell label="RL" value={motors.RL !== null ? `${motors.RL}` : NA} />
      <div style={{ padding: '4px 10px' }}>
        <div style={{ fontSize: 9, color: 'var(--cyan-label)' }}>RR</div>
        <div style={{ fontSize: 11, color: 'var(--cyan)', fontWeight: 'bold' }}>
          {motors.RR !== null ? `${motors.RR}` : NA}
        </div>
      </div>
    </div>
  )
}
