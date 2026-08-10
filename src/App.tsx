import './index.css'
import { useMemo } from 'react'
import { TelemetryProviderFactory } from './providers/TelemetryProviderFactory'
import { useTelemetry } from './hooks/useTelemetry'

import Header from './components/Header'
import BreathingPanel from './components/BreathingPanel'
import MotionPanel from './components/MotionPanel'
import TerrainPanel from './components/TerrainPanel'
import DeadReckoningPanel from './components/DeadReckoningPanel'
import BottomBar from './components/BottomBar'
import BatteryPanel from './components/BatteryPanel'
import HardwarePanel from './components/HardwarePanel'
import CommsPanel from './components/CommsPanel'

export default function App() {
  const provider = useMemo(
    () => TelemetryProviderFactory.create('auto'),
    []
  )
  const { telemetry, status } = useTelemetry(provider)

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      overflow: 'hidden',
      background: 'var(--navy)',
      fontFamily: "'Courier New', Courier, monospace",
      fontSize: 11,
      color: 'var(--cyan)',
    }}>
      {/* ── Header ───────────────────────────────────────────── */}
      <Header radio={telemetry.radio} status={status} />

      {/* ── Main area ─────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        flex: 1,
        gap: 4,
        padding: 4,
        overflow: 'hidden',
        minHeight: 0,
      }}>

        {/* LEFT COLUMN — Breathing | Motion | Terrain */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          width: '27%',
          gap: 4,
          minHeight: 0,
          overflow: 'hidden',
        }}>
          {/* Breathing — tallest (~45%) */}
          <div style={{ flex: '0 0 43%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <BreathingPanel csi={telemetry.csi} />
          </div>
          {/* Motion (~35%) */}
          <div style={{ flex: '0 0 35%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <MotionPanel motion={telemetry.motion} />
          </div>
          {/* Terrain (~22%) */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <TerrainPanel />
          </div>
        </div>

        {/* CENTER COLUMN — Dead Reckoning + Bottom Bar */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          gap: 0,
          minHeight: 0,
          overflow: 'hidden',
        }}>
          <DeadReckoningPanel
            gps={telemetry.gps}
            imu={telemetry.imu}
            odometry={telemetry.odometry}
          />
          <BottomBar odometry={telemetry.odometry} />
        </div>

        {/* RIGHT COLUMN — Battery | Hardware | Comms */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          width: '22%',
          gap: 4,
          minHeight: 0,
          overflow: 'hidden',
        }}>
          {/* Battery */}
          <BatteryPanel battery={telemetry.battery} />
          {/* Hardware — expands to fill */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <HardwarePanel hardware={telemetry.hardware} />
          </div>
          {/* Comms */}
          <CommsPanel radio={telemetry.radio} />
        </div>
      </div>
    </div>
  )
}
