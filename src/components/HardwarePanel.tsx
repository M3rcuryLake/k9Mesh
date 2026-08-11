import type { HardwareTelemetry } from '../types/telemetry'

const NA = '--'

interface Props {
  hardware: HardwareTelemetry
}

function StatusBadge({ value }: { value: string | null }) {
  if (value === null) return <span style={{ color: 'var(--cyan-label)' }}>{NA}</span>
  const color = value === 'OK' ? '#00ff88' : value === 'FAULT' ? '#ff4444' : '#e0a000'
  return (
    <span style={{
      color,
      border: `1px solid ${color}`,
      padding: '0 4px',
      fontSize: 9,
      fontWeight: 'bold',
    }}>
      {value}
    </span>
  )
}

export default function HardwarePanel({ hardware }: Props) {
  const tempColor = hardware.coreTemp !== null
    ? hardware.coreTemp > 70 ? '#ff4444' : hardware.coreTemp > 50 ? '#e0a000' : '#e000a8'
    : 'var(--cyan-label)'

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--panel)',
      border: '1px solid var(--cyan-border)',
      flex: 1,
    }}>
      <div style={{
        padding: '4px 8px',
        borderBottom: '1px solid var(--cyan-border)',
        fontSize: 10,
        fontWeight: 'bold',
        letterSpacing: '0.08em',
        color: 'var(--cyan)',
      }}>
        HARDWARE
      </div>

      <div style={{ padding: '6px 10px', flex: 1, fontSize: 10, lineHeight: 2.1 }}>
        {[
          ['STM32_MCU:', hardware.stm32],
          ['ESP32_COM:', hardware.esp32],
          ['MQTT_BROKER:', hardware.mqtt],
          ['WIFI_LINK:', hardware.wifi],
        ].map(([label, val]) => (
          <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--cyan-label)' }}>{label}</span>
            <StatusBadge value={val as string | null} />
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--cyan-label)' }}>CORE TEMP:</span>
          <span style={{ color: tempColor, fontWeight: 'bold' }}>
            {hardware.coreTemp !== null ? `${hardware.coreTemp}°C` : NA}
          </span>
        </div>
      </div>
    </div>
  )
}
