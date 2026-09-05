import { useTelemetry } from '@/telemetry/TelemetryProvider';
import type { TelemetryHistory } from '@/types/telemetry';

export type RollingField = keyof Pick<
  TelemetryHistory,
  'motion' | 'breathing' | 'ai'
>;

export interface RollingPoint {
  t: number;
  value: number | null;
}

/**
 * Returns a fixed-length rolling window of points from the telemetry
 * history. The window is always `windowSize` points long — pre-filled
 * with null values before any real data arrives so the chart renders
 * a continuous flat baseline instead of an empty/growing strip.
 */
export function useRollingWindow(
  field: RollingField,
  windowSize: number
): RollingPoint[] {
  const { history } = useTelemetry();
  const source = history[field];

  const points: RollingPoint[] = source.map((d) => ({
    t: d.t,
    value: d.value,
  }));

  if (points.length >= windowSize) {
    return points.slice(points.length - windowSize);
  }

  // Pad the front with null-valued points so the window is always full
  const padded: RollingPoint[] = [];
  const deficit = windowSize - points.length;
  const firstT = points.length > 0 ? points[0].t : Date.now();
  for (let i = deficit; i > 0; i--) {
    padded.push({ t: firstT - i * 200, value: null });
  }
  return padded.concat(points);
}
