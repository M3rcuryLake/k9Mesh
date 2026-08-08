import type { CsiTelemetry } from '../types/telemetry'

const NA = '--'

interface Props {
  csi: CsiTelemetry
}

export default function CSISurvivorDetection({ csi }: Props) {
  // Breathing status read directly from telemetry — no frontend inference
  let breathingStatus = NA
  if (csi.breathingDetected === true)  breathingStatus = 'BREATHING DETECTED'
  if (csi.breathingDetected === false) breathingStatus = 'NO BREATHING DETECTED'

  const breathingRate =
    csi.breathingRate !== null && csi.breathingRate !== undefined
      ? `${csi.breathingRate} BPM`
      : NA

  // Render raw telemetry string — UI never rounds or truncates precision
  const confidence =
    csi.confidence !== null && csi.confidence !== undefined
      ? `${csi.confidence}%`
      : NA

  const state =
    csi.state !== null && csi.state !== undefined ? csi.state : NA

  return (
    <div className="border border-green flex flex-col h-full">
      <div className="px-2 pt-[6px] pb-1 text-[11px] font-bold">CSI SURVIVOR DETECTION</div>
      <hr className="border-t border-dashed border-green opacity-50 mx-2 mb-[6px]" />

      <div className="px-2 pb-2 flex-1 leading-[2]">

        <div className="mb-[6px]">
          <span className="mr-2 font-bold">&#x25A0;</span>
          <span className="font-bold tracking-[1px]">{breathingStatus}</span>
        </div>

        <div>
          <span className="text-green-dark mr-1">&gt;</span>
          <span className="text-green-dark">ESTIMATED RATE: </span>
          <span className="font-bold">{breathingRate}</span>
        </div>

        <div>
          <span className="text-green-dark mr-1">&gt;</span>
          <span className="text-green-dark">CONFIDENCE: </span>
          <span className="font-bold">{confidence}</span>
        </div>

        <div>
          <span className="text-green-dark mr-1">&gt;</span>
          <span className="text-green-dark">STATE: </span>
          <span className="font-bold">{state}</span>
        </div>

      </div>

      {/* Footer — static placeholders; future: OFFLINE / CALIBRATING / FAULT / DEGRADED */}
      <div className="flex justify-between px-2 py-1 border-t border-dashed border-green opacity-70 text-[10px] tracking-[0.5px]">
        <span>CSI ARRAY: ONLINE</span>
        <span>CALIBRATED</span>
      </div>
    </div>
  )
}
