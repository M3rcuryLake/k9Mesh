import { useEffect, useState } from 'react';
import { AudioLines, Loader2, Square, AlertTriangle, Wifi } from 'lucide-react';
import { useProcessControl } from '@/telemetry/useProcessControl';

const CALIBRATION_OPTIONS = [
  { label: '5s', value: 5 },
  { label: '10s', value: 10 },
  { label: '13s', value: 13 },
];

const DEFAULT_INTERFACE = 'wlp2s0';

export function SignalListener() {
  const { status, errorMsg, start, stop } = useProcessControl();
  const [iface, setIface] = useState(DEFAULT_INTERFACE);
  const [calibrationSeconds, setCalibrationSeconds] = useState(13);
  const [skipCalibration, setSkipCalibration] = useState(false);

  const isRunning = status === 'running';
  const isStarting = status === 'starting';
  const isStopping = status === 'stopping';
  const isError = status === 'error';
  const isBusy = isStarting || isStopping;

  const calibrationDuration = skipCalibration ? 0 : calibrationSeconds;
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (!isStarting) {
      setCountdown(null);
      return;
    }
    if (calibrationDuration <= 0) {
      setCountdown(null);
      return;
    }
    setCountdown(calibrationDuration);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isStarting, calibrationDuration]);

  const serverStateText = isRunning
    ? 'running'
    : isStarting
      ? 'starting…'
      : isStopping
        ? 'stopping…'
        : isError
          ? 'error'
          : 'stopped';

  const serverStateColor = isRunning
    ? 'text-cyan-300'
    : isError
      ? 'text-red-300'
      : 'text-slate-500';

  const handleToggle = () => {
    if (isRunning) {
      stop();
    } else if (!isBusy) {
      start({
        interface: iface,
        calibrationSeconds: skipCalibration ? undefined : calibrationSeconds,
        skipCalibration,
      });
    }
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-ink-500/40 bg-ink-800">
      {/* Header — compact */}
      <div className="flex shrink-0 items-center justify-between px-4 py-2.5">
        <div>
          <h2 className="text-xs font-medium tracking-wide text-slate-200">
            Signal Listener
          </h2>
          <p className="mt-0.5 font-mono text-[9px] text-slate-500">
            WebSocket server ·{' '}
            <span className={serverStateColor}>{serverStateText}</span>
          </p>
        </div>
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            isRunning
              ? 'animate-pulse bg-cyan-400 shadow-glow'
              : isError
                ? 'bg-red-400'
                : 'bg-slate-600'
          }`}
        />
      </div>

      {/* Button area — flex-1 but min-h-0 so it shrinks */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-4">
        <button
          type="button"
          onClick={handleToggle}
          disabled={isBusy}
          className={`group relative flex flex-col items-center gap-1.5 transition-opacity ${
            isBusy ? 'cursor-wait opacity-70' : 'cursor-pointer'
          }`}
        >
          <span
            className={`flex h-12 w-12 items-center justify-center rounded-full border transition-all duration-300 ${
              isRunning
                ? 'border-red-400/40 bg-red-500/10 group-hover:border-red-400/70 group-hover:bg-red-500/20'
                : isError
                  ? 'border-amber-400/40 bg-amber-500/10 group-hover:border-amber-400/70 group-hover:bg-amber-500/20'
                  : 'border-cyan-400/30 bg-cyan-500/10 group-hover:border-cyan-400/60 group-hover:bg-cyan-500/20 group-hover:shadow-glow'
            } ${isStarting ? 'animate-pulse' : ''}`}
          >
            {isStarting || isStopping ? (
              <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />
            ) : isRunning ? (
              <Square className="h-4 w-4 text-red-300 fill-red-400/30" />
            ) : isError ? (
              <AlertTriangle className="h-5 w-5 text-amber-300" />
            ) : (
              <AudioLines className="h-5 w-5 text-cyan-300 transition-transform duration-300 group-hover:scale-110" />
            )}
          </span>
          <span
            className={`font-mono text-[10px] font-medium uppercase tracking-widest ${
              isRunning
                ? 'text-red-300'
                : isError
                  ? 'text-amber-300'
                  : 'text-cyan-300'
            }`}
          >
            {isRunning
              ? 'Stop Listening'
              : isStarting
                ? 'Starting…'
                : isStopping
                  ? 'Stopping…'
                  : isError
                    ? 'Retry'
                    : 'Start Listening'}
          </span>
        </button>

        {errorMsg && (
          <p className="max-w-full text-center font-mono text-[9px] leading-tight text-red-400">
            {errorMsg}
          </p>
        )}

        {countdown !== null && countdown > 0 && (
          <div className="flex flex-col items-center gap-0.5">
            <span className="font-mono text-[9px] uppercase tracking-widest text-slate-500">
              Calibrating
            </span>
            <span className="font-mono text-2xl font-bold tabular-nums text-cyan-300">
              {countdown}
            </span>
          </div>
        )}
      </div>

      {/* Configuration controls — compact, shrink-0 */}
      <div
        className={`flex shrink-0 flex-col gap-2 border-t border-ink-500/30 px-4 py-2.5 transition-opacity duration-300 ${
          isRunning || isBusy ? 'pointer-events-none opacity-40' : ''
        }`}
      >
        {/* Interface name */}
        <div className="flex items-center gap-2">
          <Wifi className="h-3 w-3 shrink-0 text-slate-500" />
          <label className="font-mono text-[9px] uppercase tracking-wider text-slate-500">
            Interface
          </label>
          <input
            type="text"
            value={iface}
            onChange={(e) => setIface(e.target.value)}
            spellCheck={false}
            className="ml-auto w-20 rounded border border-ink-500/40 bg-ink-900/60 px-1.5 py-0.5 font-mono text-[10px] text-slate-200 outline-none transition-colors focus:border-cyan-400/50"
          />
        </div>

        {/* Calibration seconds */}
        <div
          className={`flex items-center gap-2 transition-opacity duration-200 ${
            skipCalibration ? 'opacity-40' : ''
          }`}
        >
          <label className="font-mono text-[9px] uppercase tracking-wider text-slate-500">
            Calibration
          </label>
          <div className="ml-auto flex gap-1">
            {CALIBRATION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={skipCalibration}
                onClick={() => setCalibrationSeconds(opt.value)}
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-all duration-200 ${
                  calibrationSeconds === opt.value && !skipCalibration
                    ? 'border border-cyan-400/40 bg-cyan-500/15 text-cyan-300'
                    : 'border border-ink-500/30 bg-ink-900/40 text-slate-500 hover:border-ink-400/40 hover:text-slate-400'
                } ${skipCalibration ? 'cursor-not-allowed' : ''}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Skip calibration toggle */}
        <div className="flex items-center gap-2">
          <label className="font-mono text-[9px] uppercase tracking-wider text-slate-500">
            Skip Calibration
          </label>
          <button
            type="button"
            onClick={() => setSkipCalibration((v) => !v)}
            className={`ml-auto flex h-3.5 w-7 items-center rounded-full transition-colors duration-200 ${
              skipCalibration ? 'bg-cyan-500/30' : 'bg-ink-600'
            }`}
          >
            <span
              className={`h-2.5 w-2.5 rounded-full bg-slate-300 transition-transform duration-200 ${
                skipCalibration ? 'translate-x-3.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Vignette */}
      <div className="pointer-events-none absolute inset-0 z-[450] rounded-xl shadow-inner-glow" />
    </div>
  );
}
