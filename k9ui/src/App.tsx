import { TelemetryProvider, useTelemetry } from '@/telemetry/TelemetryProvider';
import { Spectrogram } from '@/components/Spectrogram';
import { RoverMap } from '@/components/RoverMap';
import { MotionGraph, BreathingGraph, AiGraph } from '@/components/LiveGraph';
import { TelemetryPanel } from '@/components/TelemetryPanel';
import { Activity, Radio, Cpu, Wifi, WifiOff } from 'lucide-react';
import { SignalListener } from '@/components/SignalListener';

function ConnectionBadge() {
  const { connectionStatus } = useTelemetry();

  if (connectionStatus === 'live') {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-500/5 px-2.5 py-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400 shadow-glow" />
        <span className="font-mono text-[10px] font-medium tracking-wider text-cyan-300">
          LIVE
        </span>
      </div>
    );
  }

  if (connectionStatus === 'offline') {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-red-400/30 bg-red-500/10 px-2.5 py-1">
        <WifiOff className="h-3 w-3 text-red-400" />
        <span className="font-mono text-[10px] font-medium tracking-wider text-red-300">
          OFFLINE
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-slate-600/30 bg-slate-700/20 px-2.5 py-1">
      <Wifi className="h-3 w-3 text-slate-400" />
      <span className="font-mono text-[10px] font-medium tracking-wider text-slate-400">
        CONNECTING
      </span>
    </div>
  );
}

function HeaderBar() {
  const { telemetry } = useTelemetry();
  const mvsState = telemetry?.mvs.state ?? 'idle';

  const stateColor =
    mvsState === 'confirmed'
      ? '#22d3ee'
      : mvsState === 'detecting'
        ? '#fbbf24'
        : mvsState === 'motion'
          ? '#fbbf24'
          : '#64748b';

  return (
    <header className="flex items-center justify-between border-b border-ink-500/30 bg-ink-900/80 px-6 py-3 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="relative">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-600/10 ring-1 ring-cyan-400/30">
            <Radio className="h-4 w-4 text-cyan-300" />
          </div>
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-cyan-400 shadow-glow" />
        </div>
        <div>
          <h1 className="text-sm font-semibold tracking-wide text-slate-100">
            K9Mesh
          </h1>
          <p className="font-mono text-[9px] text-slate-500">
            WiFi-CSI Search &amp; Rescue
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <ConnectionBadge />
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: stateColor, boxShadow: `0 0 6px ${stateColor}` }}
          />
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
            MVS: {mvsState}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Activity className="h-3 w-3 text-cyan-400" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
            Breath: {telemetry?.breath?.rate_bpm != null ? telemetry.breath.rate_bpm.toFixed(1) : '—'} BPM
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Cpu
            className={`h-3 w-3 ${telemetry?.ml.enabled ? 'text-violet-400' : 'text-slate-600'}`}
          />
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
            ML: {telemetry?.ml.enabled ? 'ON' : 'OFF'}
          </span>
        </div>
      </div>
    </header>
  );
}

function Dashboard() {
  const { connectionStatus } = useTelemetry();
  const isOffline = connectionStatus === 'offline';

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink-900">
      <HeaderBar />
      <div className="flex min-h-0 flex-1 gap-4 p-4">
        {/* Main center column — spectrogram row + map stacked (2/3 width) */}
        <div className="flex min-w-0 flex-[2] flex-col gap-3 min-h-0">
          {/* Top row — spectrogram (left half) + start listening (right half) */}
          <div className="flex min-h-[200px] flex-1 gap-3">
            <div className="min-w-0 flex-1">
              <Spectrogram />
            </div>
            <div className="min-w-0 flex-1">
              <SignalListener />
            </div>
          </div>
          {/* Map — bottom 2/3, always visible */}
          <div className="flex-[3] min-h-[200px]">
            <RoverMap />
          </div>
        </div>

        {/* Right sidebar — graphs + telemetry (1/3 width) */}
        <div
          className={`flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-1 transition-[filter,opacity] duration-500 ${
            isOffline ? 'pointer-events-none opacity-60 saturate-50' : ''
          }`}
        >
          <MotionGraph />
          <BreathingGraph />
          <AiGraph />
          <TelemetryPanel />
        </div>
      </div>

      {/* Offline desaturation overlay for the main column */}
      {isOffline && (
        <div className="pointer-events-none absolute inset-0 z-[600] bg-ink-900/20" />
      )}
    </div>
  );
}

function App() {
  return (
    <TelemetryProvider>
      <Dashboard />
    </TelemetryProvider>
  );
}

export default App;
