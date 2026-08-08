import './index.css'
import type { RoverTelemetry } from './types/telemetry'
import SystemVitals from './components/SystemVitals'
import CSISurvivorDetection from './components/CSISurvivorDetection'
import MotionDetector from './components/MotionDetector'
import GpsNav from './components/GpsNav'
import HeadingIMU from './components/HeadingIMU'
import Odometry from './components/Odometry'

import { useMemo } from 'react'
import { TelemetryProviderFactory } from './providers/TelemetryProviderFactory'
import { useTelemetry } from './hooks/useTelemetry'

export default function App() {
  const provider = useMemo(
    () =>
      TelemetryProviderFactory.create('auto', {
        json: { initialScenario: 'survivor_detected' },
      }),
    []
  )

  const { telemetry } = useTelemetry(provider)

  return (
    <div className="bg-black text-green font-mono text-[11px] min-h-screen p-[10px] flex flex-col gap-2">

      {/* Header */}
      <div className="text-center text-[22px] font-bold tracking-[8px] py-2">
        K9MESH
      </div>

      {/* Row 1 — System Vitals */}
      <SystemVitals
        radio={telemetry.radio}
        hardware={telemetry.hardware}
        battery={telemetry.battery}
      />

      {/* Row 2 — CSI | Motion | GPS */}
      <div className="grid grid-cols-[2fr_1fr_1fr] gap-2">
        <CSISurvivorDetection csi={telemetry.csi} />
        <MotionDetector motion={telemetry.motion} />
        <GpsNav gps={telemetry.gps} />
      </div>

      {/* Row 3 — Heading/IMU | Odometry */}
      <div className="grid grid-cols-2 gap-2">
        <HeadingIMU imu={telemetry.imu} />
        <Odometry odometry={telemetry.odometry} />
      </div>

    </div>
  )
}
