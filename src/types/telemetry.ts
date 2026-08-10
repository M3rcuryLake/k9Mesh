/** e.g. "EXCELLENT" | "GOOD" | "FAIR" | "POOR" */
export interface RadioTelemetry {
  linkQuality: string | null;
  rssi: number | null;
  latency: number | null;
  signalPercent: number | null;
  channel: number | null;
  dropped: number | null;
}

/** e.g. status values: "OK" | "FAULT" | "OFFLINE" */
export interface HardwareTelemetry {
  stm32: string | null;
  esp32: string | null;
  mqtt: string | null;
  wifi: string | null;
  coreTemp: number | null;
}

export interface BatteryTelemetry {
  percent: number | null;
  voltage: number | null;
  /** Pre-formatted time string, e.g. "01:34:18" */
  estTime: string | null;
  /** e.g. "NORMAL" | "HIGH" | "CRITICAL" */
  discharge: string | null;
}

export interface CsiTelemetry {
  breathingDetected: boolean | null;
  breathingRate: number | null;
  /**
   * Pre-formatted string from telemetry source.
   * The UI renders this value exactly as received — never rounded or truncated.
   * Example: "91.0000000000"
   */
  confidence: string | null;
  state: string | null;
  arrayOnline: boolean | null;
  calibrated: boolean | null;
}

export type MotionLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface MotionTelemetry {
  level: MotionLevel | null;
  lastEventSeconds: number | null;
  variance: number | null;
  threshold: number | null;
}

export interface GpsTelemetry {
  latitude: number | null;
  longitude: number | null;
}

export interface ImuTelemetry {
  heading: number | null;
  pitch: number | null;
  roll: number | null;
}

export interface MotorsTelemetry {
  FL: number | null;
  FR: number | null;
  RL: number | null;
  RR: number | null;
}

export interface OdometryTelemetry {
  speed: number | null;
  distance: number | null;
  motors: MotorsTelemetry;
}

/**
 * Complete telemetry model for the K9Mesh rover.
 * Null on any field = sensor data not yet received.
 * Populated entirely by the TelemetryProvider abstraction.
 * No UI component may generate, randomise, or derive values from this interface.
 */
export interface RoverTelemetry {
  /** Epoch millisecond timestamp when telemetry was captured */
  timestamp: number;
  radio: RadioTelemetry;
  hardware: HardwareTelemetry;
  battery: BatteryTelemetry;
  csi: CsiTelemetry;
  motion: MotionTelemetry;
  gps: GpsTelemetry;
  imu: ImuTelemetry;
  odometry: OdometryTelemetry;
}
