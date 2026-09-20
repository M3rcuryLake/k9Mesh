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
  // Legacy fields (backward compatible)
  rate_bpm: number | null;
  snr: number | null;
  confidence: number;  // 0-100

  // Additive diagnostic fields (all nullable for back-compat)
  status?: string;                     // "breathing_detected" | "no_breathing_detected" | "insufficient_signal" | "insufficient_data" | "motion_rejected" | "dropout_rejected"
  rejection_reason?: string | null;
  usable_window_s?: number | null;
  observed_cycles?: number | null;
  fft_estimate_brpm?: number | null;
  bssf_estimate_brpm?: number | null;
  estimator_agreement?: number | null;
  n_candidates?: number | null;
  n_passing?: number | null;
  pass_fraction?: number | null;
  estimate_spread_brpm?: number | null;
  fusion_method?: string | null;
  regime_flag?: string | null;
  temporal?: {
    state: string;
    variance: number;
    n_accepted: number;
  } | null;
  quality?: {
    n_passing: number;
    n_total: number;
    pass_fraction: number;
  } | null;
  confidence_components?: {
    pass_fraction: number;
    spread: number;
    cycles: number;
    regime: number;
  } | null;
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
