import { useTelemetry } from '@/telemetry/TelemetryProvider';
import { AwaitingSignal } from '@/components/AwaitingSignal';

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function rssiQuality(rssi: number): { label: string; color: string; pct: number } {
  const pct = Math.max(0, Math.min(100, ((rssi + 90) / 60) * 100));
  if (rssi > -55) return { label: 'Excellent', color: '#22d3ee', pct };
  if (rssi > -65) return { label: 'Good', color: '#4ade80', pct };
  if (rssi > -75) return { label: 'Fair', color: '#fbbf24', pct };
  return { label: 'Poor', color: '#ef4444', pct };
}

function tempState(c: number): { color: string; warning: boolean } {
  if (c > 50) return { color: '#ef4444', warning: true };
  if (c > 45) return { color: '#fbbf24', warning: true };
  return { color: '#4ade80', warning: false };
}

export function TelemetryPanel() {
  const { telemetry, uptime, connectionStatus } = useTelemetry();

  const isAwaiting = connectionStatus === 'awaiting' && !telemetry;

  if (isAwaiting) {
    return (
      <div className="rounded-xl border border-ink-500/30 bg-ink-800/60 p-5">
        <AwaitingSignal />
      </div>
    );
  }

  if (!telemetry) return null;

  const rssiQ = rssiQuality(telemetry.rssi);
  const tempC = telemetry.temperature_c ?? 0;
  const tempS = tempState(tempC);
  const seqGap = telemetry.dropped > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Band / Channel + Signal */}
      <div className="rounded-xl border border-ink-500/30 bg-ink-800/60 p-5">
        {/* Band / Channel */}
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Band / Channel
          </span>
          <span className="font-mono text-xs font-semibold text-cyan-300">
            CH {telemetry.channel}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {telemetry.band.map((sub) => (
            <span
              key={sub}
              className="flex h-5 w-7 items-center justify-center rounded font-mono text-[9px] text-slate-400"
              style={{
                background: 'rgba(34, 211, 238, 0.06)',
                border: '1px solid rgba(34, 211, 238, 0.12)',
              }}
            >
              {sub}
            </span>
          ))}
        </div>

        {/* Divider */}
        <div className="my-4 h-px bg-ink-500/20" />

        {/* Signal */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Signal
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-semibold tabular-nums text-slate-200">
              {telemetry.rssi}
            </span>
            <span className="font-mono text-[10px] text-slate-500">dBm</span>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-600">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${rssiQ.pct}%`,
                background: rssiQ.color,
                boxShadow: `0 0 8px ${rssiQ.color}80`,
              }}
            />
          </div>
          <span
            className="font-mono text-[10px]"
            style={{ color: rssiQ.color }}
          >
            {rssiQ.label}
          </span>
        </div>
      </div>

      {/* Temperature + Uptime + Packet Health */}
      <div className="rounded-xl border border-ink-500/30 bg-ink-800/60 p-5">
        {/* Temperature */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Temperature
          </span>
          <div className="flex items-center gap-2">
            <span
              className={`font-mono text-lg font-semibold tabular-nums ${tempS.warning ? 'animate-pulse' : ''}`}
              style={{ color: tempS.color }}
            >
              {tempC.toFixed(1)}
            </span>
            <span className="font-mono text-[10px] text-slate-500">°C</span>
          </div>
        </div>
        {tempS.warning && (
          <p className="mt-2 font-mono text-[9px] text-red-400">
            {tempC > 50 ? 'CRITICAL THRESHOLD' : 'ELEVATED'}
          </p>
        )}

        {/* Divider */}
        <div className="my-4 h-px bg-ink-500/20" />

        {/* Uptime */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Uptime
          </span>
          <span className="font-mono text-lg font-semibold tabular-nums text-slate-200">
            {formatUptime(uptime)}
          </span>
        </div>

        {/* Divider */}
        <div className="my-4 h-px bg-ink-500/20" />

        {/* Packet Health */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Packet Health
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div>
            <span className="font-mono text-sm text-slate-300">SEQ</span>
            <span className="ml-1.5 font-mono text-lg font-semibold tabular-nums text-slate-200">
              {telemetry.seq.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${seqGap ? 'animate-pulse bg-amber-400' : 'bg-green-400'}`}
            />
            <span
              className={`font-mono text-sm tabular-nums ${seqGap ? 'text-amber-400' : 'text-slate-400'}`}
            >
              {telemetry.dropped} dropped
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
