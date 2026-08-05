const NA = '--'

function Row({ label, value, unit = '' }) {
  const display = value === null || value === undefined ? NA : `${value}${unit}`
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', lineHeight: '1.8' }}>
      <span>{label}</span>
      <span>{display}</span>
    </div>
  )
}

function StatusRow({ label, value }) {
  const display = value === null || value === undefined ? NA : value
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', lineHeight: '1.8' }}>
      <span>{label}</span>
      <span>{display}</span>
    </div>
  )
}

function BatteryBar({ percent }) {
  if (percent === null || percent === undefined) {
    return <span>[----------] {NA}</span>
  }
  const filled = Math.min(10, Math.max(0, Math.round(percent / 10)))
  const empty = 10 - filled
  return (
    <span style={{ fontFamily: 'monospace', letterSpacing: '1px' }}>
      [<span style={{ color: '#00ff66' }}>{'█'.repeat(filled)}</span><span style={{ color: '#004422' }}>{'█'.repeat(empty)}</span>] {percent}%
    </span>
  )
}

export default function SystemVitals({ radio, hardware, battery }) {
  return (
    <div className="panel">
      <div className="panel-title">SYSTEM VITALS</div>
      <hr className="divider" />
      <div className="section-inner" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px' }}>

        <div>
          <div style={{ fontSize: '10px', fontWeight: 'bold', marginBottom: '4px' }}>COMMS &amp; SIGNAL</div>
          <hr className="divider" style={{ margin: '0 0 4px 0' }} />
          <Row label="LINK:" value={radio.linkQuality} />
          <Row label="RSSI:" value={radio.rssi} unit=" DBM" />
          <Row label="LATENCY:" value={radio.latency} unit=" MS" />
          <Row label="SIGNAL:" value={radio.signalPercent} unit="%" />
        </div>

        <div>
          <div style={{ fontSize: '10px', fontWeight: 'bold', marginBottom: '4px' }}>HARDWARE STATUS</div>
          <hr className="divider" style={{ margin: '0 0 4px 0' }} />
          <StatusRow label="STM32_MCU:" value={hardware.stm32} />
          <StatusRow label="ESP32_COM:" value={hardware.esp32} />
          <StatusRow label="MQTT_BROKER:" value={hardware.mqtt} />
          <StatusRow label="WIFI_LINK:" value={hardware.wifi} />
          <Row label="CORE TEMP:" value={hardware.coreTemp} unit="°C" />
        </div>

        <div>
          <div style={{ fontSize: '10px', fontWeight: 'bold', marginBottom: '4px', textAlign: 'right' }}>BATTERY</div>
          <hr className="divider" style={{ margin: '0 0 4px 0' }} />
          <div style={{ textAlign: 'right', lineHeight: '1.8' }}>
            <div><BatteryBar percent={battery.percent} /></div>
            <div>VOLTAGE: {battery.voltage !== null ? `${battery.voltage}V` : NA}</div>
            <div>EST TIME: {battery.estTime !== null ? battery.estTime : NA}</div>
            <div>DISCHARGE: {battery.discharge !== null ? battery.discharge : NA}</div>
          </div>
        </div>

      </div>
    </div>
  )
}
