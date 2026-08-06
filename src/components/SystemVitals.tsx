import type { RadioTelemetry, HardwareTelemetry, BatteryTelemetry } from '../types/telemetry'

const NA = '--'

interface Props {
  radio: RadioTelemetry
  hardware: HardwareTelemetry
  battery: BatteryTelemetry
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between leading-[1.8]">
      <span>{label}</span>
      <span>{value ?? NA}</span>
    </div>
  )
}

function StatusRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between leading-[1.8]">
      <span>{label}</span>
      <span>{value ?? NA}</span>
    </div>
  )
}

function BatteryBar({ percent }: { percent: number | null }) {
  if (percent === null) return <span>[----------] {NA}</span>
  const filled = Math.min(10, Math.max(0, Math.round(percent / 10)))
  const empty = 10 - filled
  return (
    <span className="tracking-[1px]">
      [<span className="text-green">{'█'.repeat(filled)}</span>
      <span className="text-green-dark">{'█'.repeat(empty)}</span>] {percent}%
    </span>
  )
}

function SignalBar({ percent }: { percent: number | null }) {
  if (percent === null) return <span>[----------] {NA}</span>
  const filled = Math.min(10, Math.max(0, Math.round(percent / 10)))
  const empty = 10 - filled
  return (
    <span className="tracking-[1px]">
      [<span className="text-green">{'|'.repeat(filled)}</span>
      <span className="text-green-dark">{'-'.repeat(empty)}</span>] {percent}%
    </span>
  )
}

export default function SystemVitals({ radio, hardware, battery }: Props) {
  return (
    <div className="border border-green">
      <div className="px-2 pt-[6px] pb-1 text-[11px] font-bold">SYSTEM VITALS</div>
      <hr className="border-t border-dashed border-green opacity-50 mx-2 mb-[6px]" />
      <div className="grid grid-cols-3 gap-x-4 px-2 pb-2">

        {/* COMMS & SIGNAL */}
        <div>
          <div className="text-[10px] font-bold mb-1">COMMS &amp; SIGNAL</div>
          <hr className="border-t border-dashed border-green opacity-50 mb-1" />
          <Row label="LINK:" value={radio.linkQuality} />
          <Row label="LATENCY:" value={radio.latency !== null ? `${radio.latency} MS` : null} />
          <div className="flex justify-between leading-[1.8]">
            <span>SIGNAL:</span>
            <SignalBar percent={radio.signalPercent} />
          </div>
        </div>

        {/* HARDWARE STATUS */}
        <div>
          <div className="text-[10px] font-bold mb-1">HARDWARE STATUS</div>
          <hr className="border-t border-dashed border-green opacity-50 mb-1" />
          <StatusRow label="STM32_MCU:" value={hardware.stm32} />
          <StatusRow label="ESP32_COM:" value={hardware.esp32} />
          <StatusRow label="MQTT_BROKER:" value={hardware.mqtt} />
          <StatusRow label="WIFI_LINK:" value={hardware.wifi} />
          <Row
            label="CORE TEMP:"
            value={hardware.coreTemp !== null ? `${hardware.coreTemp}°C` : null}
          />
        </div>

        {/* BATTERY */}
        <div className="text-right">
          <div className="text-[10px] font-bold mb-1">BATTERY</div>
          <hr className="border-t border-dashed border-green opacity-50 mb-1" />
          <div className="leading-[1.8]">
            <div><BatteryBar percent={battery.percent} /></div>
            <div>VOLTAGE: {battery.voltage !== null ? `${battery.voltage}V` : NA}</div>
            <div>EST TIME: {battery.estTime ?? NA}</div>
            <div>DISCHARGE: {battery.discharge ?? NA}</div>
          </div>
        </div>

      </div>
    </div>
  )
}
