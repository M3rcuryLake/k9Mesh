export interface MicroESPectreMvsPayload {
  readonly state?: 'motion' | 'stable' | 'idle' | 'MOTION' | 'STABLE' | 'IDLE' | string;
  readonly variance?: number;
  readonly threshold?: number;
  readonly confidence?: number;
}

export interface MicroESPectreMlPayload {
  readonly ready?: boolean;
  readonly score?: number | null;
  readonly motion?: boolean | null;
  readonly enabled?: boolean;
  readonly classification?: { t: number; x: number; y: number }[] | null;
}

export interface MicroESPectrePosePayload {
  readonly x?: number;
  readonly y?: number;
  readonly theta_deg?: number;
}

export interface MicroESPectreBreathPayload {
  readonly rate_bpm?: number | null;
  readonly snr?: number;
  readonly confidence?: number;
  readonly peak_freq_hz?: number;
  readonly spectral_purity?: number;
  readonly band_power_frac?: number;
  readonly harmonic_ratio?: number;
  readonly n_samples?: number;
}

/**
 * Raw Micro-ESPectre Ingest Packet Schema
 * Represents the transport payload emitted by the Micro-ESPectre CSI sensing node.
 * Supports both Phase 10 live hardware schemas and legacy fields.
 */
export interface RawMicroESPectrePacket {
  // Phase 10 Authoritative Backend Schema fields
  readonly seq?: number;
  readonly timestamp_us?: number;
  readonly channel?: number;
  readonly rssi?: number;
  readonly dropped?: number;
  readonly band?: number[];
  readonly mvs?: MicroESPectreMvsPayload;
  readonly ml?: MicroESPectreMlPayload;
  readonly pose?: MicroESPectrePosePayload;
  readonly breath?: MicroESPectreBreathPayload;

  // Legacy / Extended Fields
  readonly timestamp?: number;
  readonly timestamp_epoch_ms?: number;
  readonly sequence?: number;
  readonly sequence_id?: number;
  readonly node_id?: string;
  readonly source_node?: string;
  readonly csi_state?: 'STABLE' | 'MOTION' | 'IDLE' | string;
  readonly csi_movement?: number;
  readonly csi_threshold?: number;
  readonly csi_confidence?: number | string;
  readonly csi_array_status?: boolean;
  readonly csi_calibrated?: boolean;
  readonly breathing_detected?: boolean;
  readonly breathing_rate?: number | null;
  readonly motion_activity?: 'LOW' | 'MEDIUM' | 'HIGH' | string;
  readonly last_motion_event_seconds?: number;
  readonly wifi_rssi?: number;
  readonly battery_voltage?: number;
  readonly battery_percent?: number;
  readonly heading?: number;
  readonly pitch?: number;
  readonly roll?: number;
  readonly speed?: number;
  readonly distance?: number;
  readonly rpm_fl?: number;
  readonly rpm_fr?: number;
  readonly rpm_rl?: number;
  readonly rpm_rr?: number;
  readonly gps_lat?: number;
  readonly gps_lon?: number;
}

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

export interface ICDPoseTelemetry {
  x: number | null;
  y: number | null;
  thetaDeg: number | null;
}

export interface ICDRespirationTelemetry {
  rateBpm: number | null;
  snr: number | null;
  confidence: number | null;
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
  pose: ICDPoseTelemetry;
  respiration: ICDRespirationTelemetry | null;
}

/**
 * Authoritative Master ICD Envelope (Destination Contract)
 */
export interface RoverTelemetryEnvelope {
  protocol_version: string;
  msg_type: 'TELEMETRY';
  timestamp_epoch_ms: number;
  host_receipt_time_ms: number;
  node_id: string;
  data: ICDRoverTelemetryData;
}

/**
 * Diagnostic metrics tracked by the adapter
 */
export interface AdapterDiagnostics {
  readonly packetsAdapted: number;
  readonly packetsRejected: number;
  readonly unknownSchemaVersions: number;
  readonly mappingFailures: number;
  readonly lastAdaptedTimestamp: number;
}

/**
 * Strongly-typed generic Telemetry Adapter contract
 */
export interface ITelemetryAdapter<TSource, TDest> {
  readonly id: string;
  readonly version: string;
  adapt(source: TSource): TDest | null;
  getDiagnostics(): AdapterDiagnostics;
  resetDiagnostics(): void;
}
