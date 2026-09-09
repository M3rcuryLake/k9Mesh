export type ConnectionStatus = 'awaiting' | 'live' | 'offline';

export type MvsState = string;

export interface MvsData {
  state: MvsState;
  variance: number;
  threshold: number;
  confidence: number;
}

export interface MlData {
  ready: boolean;
  score: number | null;
  detection: string | null;
  enabled: boolean;
}

export interface BreathData {
  rate_bpm: number;
  snr: number;
  confidence: number;
}

export interface PoseData {
  x: number;
  y: number;
  theta_deg: number;
}

export interface GpsOrigin {
  latitude: number;
  longitude: number;
}

export type RgbPixel = [number, number, number];

export interface Telemetry {
  seq: number;
  timestamp_us: number;
  channel: number;
  rssi: number;
  dropped: number;
  band: number[];
  temperature_c?: number;
  mvs: MvsData;
  ml: MlData;
  breath: BreathData;
  pose: PoseData;
  gps_origin?: GpsOrigin;
  csi_spectrogram_row: RgbPixel[];
  stale: boolean;
}

export interface TelemetryHistory {
  motion: { t: number; value: number | null; variance: number; threshold: number }[];
  breathing: { t: number; value: number | null; rate_bpm: number }[];
  ai: { t: number; value: number | null; detection: string | null }[];
  spectrogram: RgbPixel[][];
}
