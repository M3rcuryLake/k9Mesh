import type { RgbPixel, Telemetry, TelemetryHistory } from '@/types/telemetry';

// ── Constants ──────────────────────────────────────────────
const SPECTRUM_BINS = 12;
const HISTORY_LEN = 180; // ~36s at 200ms
const SPECTROGRAM_COLS = 150;
const GPS_ORIGIN = { latitude: 12.9716, longitude: 77.5946 };

function prefillHistory(): TelemetryHistory {
  const motion: TelemetryHistory['motion'] = [];
  const breathing: TelemetryHistory['breathing'] = [];
  const ai: TelemetryHistory['ai'] = [];
  for (let i = 0; i < HISTORY_LEN; i++) {
    const t = Date.now() - (HISTORY_LEN - i) * 200;
    motion.push({ t, value: null, variance: 0, threshold: 5.22 });
    breathing.push({ t, value: null, rate_bpm: 0 });
    ai.push({ t, value: null, detection: null });
  }
  return { motion, breathing, ai, spectrogram: [] };
}

// Meters per degree approx (Bangalore latitude)
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LNG = 111320 * Math.cos((GPS_ORIGIN.latitude * Math.PI) / 180);

// ── Internal state ──────────────────────────────────────────
let seq = 10000;
const startTime = Date.now();

// Rover path simulation
let poseX = 0;
let poseY = 0;
let theta = 0;
let speed = 0;
let turnRate = 0;

// Detection phases
let phaseTimer = 0;
type Phase = 'idle' | 'moving' | 'detected' | 'breathing';
let phase: Phase = 'idle';

// Signal quality
let rssi = -52;
let dropped = 0;

// Temperature drift
let temp = 38.5;

// Breathing
let breathBpm = 18;
let breathSnr = 8;

// ML
let mlScore = 30;
let mlDetection: string | null = null;
let mlDetectionTimer = 0;

// ── Helpers ─────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function noise(amp: number): number {
  return (Math.random() - 0.5) * 2 * amp;
}

// ── Phase machine ───────────────────────────────────────────
function advancePhase(): void {
  phaseTimer--;
  if (phaseTimer > 0) return;

  const r = Math.random();
  if (phase === 'idle') {
    phase = r < 0.6 ? 'idle' : 'moving';
    phaseTimer = 40 + Math.floor(Math.random() * 60);
  } else if (phase === 'moving') {
    phase = r < 0.3 ? 'detected' : r < 0.6 ? 'breathing' : 'idle';
    phaseTimer = 60 + Math.floor(Math.random() * 80);
  } else if (phase === 'detected') {
    phase = r < 0.4 ? 'breathing' : 'idle';
    phaseTimer = 50 + Math.floor(Math.random() * 60);
  } else {
    phase = r < 0.3 ? 'breathing' : 'idle';
    phaseTimer = 50 + Math.floor(Math.random() * 70);
  }
}

// ── Spectrogram row generator ───────────────────────────────
function genSpectrumRow(): RgbPixel[] {
  const row: RgbPixel[] = [];
  const hasEvent = phase === 'detected' || phase === 'breathing';
  const eventBand = 4 + Math.floor(Math.random() * 4);
  const eventWidth = phase === 'breathing' ? 1 : 3;

  for (let i = 0; i < SPECTRUM_BINS; i++) {
    let v = Math.random() * 0.12;
    // ambient noise floor variation
    v += Math.sin(i * 0.3 + phaseTimer * 0.1) * 0.04;

    if (hasEvent && Math.abs(i - eventBand) < eventWidth) {
      const dist = Math.abs(i - eventBand);
      const intensity = (1 - dist / eventWidth) * (0.6 + Math.random() * 0.4);
      v += intensity;
    }

    // occasional random bright pixel
    if (Math.random() < 0.01) v += 0.3;

    const intensity = clamp(v, 0, 1);
    row.push([
      Math.round(intensity * 255),
      Math.round(intensity * 220),
      Math.round(intensity * 180),
    ]);
  }
  return row;
}

// ── Main tick ───────────────────────────────────────────────
export function generateTelemetry(): Telemetry {
  advancePhase();

  // Rover movement
  if (phase === 'moving' || phase === 'detected') {
    speed = lerp(speed, 0.3 + Math.random() * 0.2, 0.1);
    turnRate = lerp(turnRate, noise(2), 0.05);
  } else {
    speed = lerp(speed, 0.02, 0.1);
    turnRate = lerp(turnRate, noise(0.5), 0.05);
  }

  theta += turnRate;
  if (theta > 360) theta -= 360;
  if (theta < 0) theta += 360;

  const rad = (theta * Math.PI) / 180;
  poseX += Math.cos(rad) * speed;
  poseY += Math.sin(rad) * speed;

  // Keep rover in ~20m radius
  const distFromOrigin = Math.sqrt(poseX * poseX + poseY * poseY);
  if (distFromOrigin > 18) {
    turnRate += 5;
  }

  // RSSI drift
  rssi = clamp(rssi + noise(1.5), -75, -35);

  // Dropped packets (occasional)
  if (Math.random() < 0.02) dropped++;
  // Simulate occasional dropout
  const isStale = Math.random() < 0.008;

  // Temperature
  temp = clamp(temp + noise(0.3), 35, 55);

  // MVS
  let mvsVariance = noise(0.5) + 0.5;
  let mvsConfidence = clamp(Math.random() * 15, 0, 100);
  let mvsState: 'idle' | 'detecting' | 'confirmed' = 'idle';

  if (phase === 'detected') {
    mvsVariance = 5 + Math.random() * 4;
    mvsConfidence = clamp(60 + Math.random() * 35, 0, 100);
    mvsState = 'confirmed';
  } else if (phase === 'moving') {
    mvsVariance = 2 + Math.random() * 2;
    mvsConfidence = clamp(30 + Math.random() * 30, 0, 100);
    mvsState = 'detecting';
  }

  // Breathing
  let breathConfidence = clamp(Math.random() * 20, 0, 100);
  if (phase === 'breathing') {
    breathBpm = lerp(breathBpm, 14 + Math.random() * 8, 0.05);
    breathSnr = lerp(breathSnr, 8 + Math.random() * 6, 0.05);
    breathConfidence = clamp(55 + Math.random() * 40, 0, 100);
  } else {
    breathBpm = lerp(breathBpm, 16 + Math.random() * 4, 0.02);
    breathSnr = lerp(breathSnr, 3 + Math.random() * 3, 0.02);
  }

  // ML
  mlScore = clamp(lerp(mlScore, 20 + Math.random() * 30, 0.1), 0, 100);
  if (phase === 'detected' || phase === 'breathing') {
    mlScore = clamp(mlScore + 20 + Math.random() * 20, 0, 100);
  }

  mlDetectionTimer--;
  if (mlDetectionTimer <= 0) {
    mlDetection = null;
  }
  if ((phase === 'detected' || phase === 'breathing') && Math.random() < 0.05) {
    mlDetection = phase === 'breathing' ? 'VITAL_SIGNS' : 'MOTION_ENTITY';
    mlDetectionTimer = 15;
  }

  seq++;
  const elapsed = Date.now() - startTime;

  return {
    seq,
    timestamp_us: elapsed * 1000,
    channel: 3,
    rssi: Math.round(rssi),
    dropped,
    band: [11, 12, 13, 14, 15, 16, 17, 43, 48, 50, 51, 52],
    temperature_c: parseFloat(temp.toFixed(1)),
    mvs: {
      state: mvsState,
      variance: parseFloat(mvsVariance.toFixed(2)),
      threshold: 5.22,
      confidence: parseFloat(mvsConfidence.toFixed(1)),
    },
    ml: {
      ready: true,
      score: parseFloat(mlScore.toFixed(1)),
      detection: mlDetection,
      enabled: true,
    },
    breath: {
      rate_bpm: parseFloat(breathBpm.toFixed(1)),
      snr: parseFloat(breathSnr.toFixed(1)),
      confidence: parseFloat(breathConfidence.toFixed(1)),
    },
    pose: {
      x: parseFloat(poseX.toFixed(2)),
      y: parseFloat(poseY.toFixed(2)),
      theta_deg: parseFloat(theta.toFixed(1)),
    },
    gps_origin: GPS_ORIGIN,
    csi_spectrogram_row: genSpectrumRow(),
    stale: isStale,
  };
}

// ── History tracking ────────────────────────────────────────
export function createHistoryTracker() {
  const history: TelemetryHistory = prefillHistory();

  function update(t: Telemetry): TelemetryHistory {
    const mvs = t.mvs ?? { state: 'idle' as const, variance: 0, threshold: 5.22, confidence: 0 };
    const breath = t.breath ?? { rate_bpm: 0, snr: 0, confidence: 0 };
    const ml = t.ml ?? { ready: true, score: null, detection: null, enabled: true };
    const now = Date.now();

    history.motion.push({
      t: now,
      value: mvs.confidence,
      variance: mvs.variance,
      threshold: mvs.threshold,
    });
    history.breathing.push({
      t: now,
      value: breath.confidence,
      rate_bpm: breath.rate_bpm,
    });
    history.ai.push({
      t: now,
      value: ml.score ?? null,
      detection: ml.detection,
    });

    history.spectrogram.push(t.csi_spectrogram_row);

    // Trim — always maintain exactly HISTORY_LEN points for charts
    if (history.motion.length > HISTORY_LEN) history.motion.shift();
    if (history.breathing.length > HISTORY_LEN) history.breathing.shift();
    if (history.ai.length > HISTORY_LEN) history.ai.shift();
    if (history.spectrogram.length > SPECTROGRAM_COLS)
      history.spectrogram.shift();

    return history;
  }

  return { update, history };
}

// ── Coordinate conversion ───────────────────────────────────
export function poseToLatLng(
  pose: { x: number; y: number },
  origin: { latitude: number; longitude: number }
): { lat: number; lng: number } {
  return {
    lat: origin.latitude + pose.y / M_PER_DEG_LAT,
    lng: origin.longitude + pose.x / M_PER_DEG_LNG,
  };
}

export { GPS_ORIGIN, SPECTRUM_BINS, SPECTROGRAM_COLS, HISTORY_LEN };
