/**
 * K9Mesh Master Interface Control Document (ICD) Type Definitions
 * Source: docs/ICD.md (Version 1.0.0)
 */

export interface ICDRadioTelemetry {
  linkQuality: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | string | null;
  rssi: number | null;
  latency: number | null;
  signalPercent: number | null;
  channel: number | null;
  dropped: number | null;
}

export interface ICDHardwareTelemetry {
  stm32: 'OK' | 'FAULT' | 'OFFLINE' | string | null;
  esp32: 'OK' | 'FAULT' | 'OFFLINE' | string | null;
  mqtt: 'OK' | 'FAULT' | 'OFFLINE' | string | null;
  wifi: 'OK' | 'FAULT' | 'OFFLINE' | string | null;
  coreTemp: number | null;
}

export interface ICDBatteryTelemetry {
  percent: number | null;
  voltage: number | null;
  estTime: string | null;
  discharge: 'NORMAL' | 'HIGH' | 'CRITICAL' | string | null;
}

export interface ICDCsiTelemetry {
  arrayOnline: boolean | null;
  calibrated: boolean | null;
  breathingDetected: boolean | null;
  breathingRate: number | null;
  confidence: string | null;
  state: 'STABLE' | 'MOTION' | 'IDLE' | string | null;
}

export interface ICDMotionTelemetry {
  level: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  lastEventSeconds: number | null;
  variance: number | null;
  threshold: number | null;
}

export interface ICDGpsTelemetry {
  latitude: number | null;
  longitude: number | null;
}

export interface ICDImuTelemetry {
  heading: number | null;
  pitch: number | null;
  roll: number | null;
}

export interface ICDMotorsTelemetry {
  FL: number | null;
  FR: number | null;
  RL: number | null;
  RR: number | null;
}

export interface ICDOdometryTelemetry {
  speed: number | null;
  distance: number | null;
  motors: ICDMotorsTelemetry;
}

export interface ICDMlTelemetry {
  ready: boolean | null;
  enabled: boolean | null;
  score: number | null;
  motion: boolean | null;
  classification: { t: number; x: number; y: number }[] | null;
}

export interface ICDRoverTelemetryData {
  radio: ICDRadioTelemetry;
  hardware: ICDHardwareTelemetry;
  battery: ICDBatteryTelemetry;
  csi: ICDCsiTelemetry;
  motion: ICDMotionTelemetry;
  gps: ICDGpsTelemetry;
  imu: ICDImuTelemetry;
  odometry: ICDOdometryTelemetry;
  ml: ICDMlTelemetry;
}

export interface ICDTelemetryMessage {
  protocol_version: string;
  msg_type: 'TELEMETRY';
  timestamp_epoch_ms: number;
  node_id: string;
  data: ICDRoverTelemetryData;
}

export interface ScenarioDefinition {
  scenarioName: string;
  description: string;
  telemetry: ICDTelemetryMessage | ICDRoverTelemetryData;
}
