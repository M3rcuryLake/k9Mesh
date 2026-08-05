import './index.css'
import SystemVitals from './components/SystemVitals'
import CSISurvivorDetection from './components/CSISurvivorDetection'
import MotionDetector from './components/MotionDetector'
import GpsNav from './components/GpsNav'
import HeadingIMU from './components/HeadingIMU'
import Odometry from './components/Odometry'

const INITIAL_TELEMETRY = {
  radio: {
    linkQuality: null,
    rssi: null,
    latency: null,
    signalPercent: null,
  },
  hardware: {
    stm32: null,
    esp32: null,
    mqtt: null,
    wifi: null,
    coreTemp: null,
  },
  battery: {
    percent: null,
    voltage: null,
    estTime: null,
    discharge: null,
  },
  csi: {
    breathingDetected: null,
    breathingRate: null,
    confidence: null,
    state: null,
    arrayOnline: null,
    calibrated: null,
  },
  motion: {
    level: null,
    lastEventSeconds: null,
  },
  gps: {
    latitude: null,
    longitude: null,
  },
  imu: {
    heading: null,
    pitch: null,
    roll: null,
  },
  odometry: {
    speed: null,
    distance: null,
    motors: {
      FL: null,
      FR: null,
      RL: null,
      RR: null,
    },
  },
}

export default function App() {
  const telemetry = INITIAL_TELEMETRY

  return (
    <div style={{
      backgroundColor: '#000000',
      color: '#00ff66',
      fontFamily: "'Courier New', Courier, monospace",
      fontSize: '11px',
      minHeight: '100vh',
      padding: '10px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    }}>

      <div style={{ textAlign: 'center', fontSize: '22px', fontWeight: 'bold', letterSpacing: '8px', padding: '8px 0 6px 0' }}>
        K9MESH
      </div>

      <SystemVitals
        radio={telemetry.radio}
        hardware={telemetry.hardware}
        battery={telemetry.battery}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px' }}>
        <CSISurvivorDetection csi={telemetry.csi} />
        <MotionDetector motion={telemetry.motion} />
        <GpsNav gps={telemetry.gps} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <HeadingIMU imu={telemetry.imu} />
        <Odometry odometry={telemetry.odometry} />
      </div>

    </div>
  )
}
