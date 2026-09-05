import { useEffect, useRef } from 'react';
import { useTelemetry } from '@/telemetry/TelemetryProvider';
import { SPECTRUM_BINS } from '@/telemetry/mockGenerator';
import { AwaitingSignal } from '@/components/AwaitingSignal';

// Y-axis labels for 12 bins across 0–10 Hz
const FREQ_LABELS = [10, 8, 6, 4, 2, 0];

export function Spectrogram() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { telemetry, history, connectionStatus } = useTelemetry();
  const spectrogram = history.spectrogram;

  const isAwaiting = connectionStatus === 'awaiting' && !telemetry;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#04060a';
    ctx.fillRect(0, 0, rect.width, rect.height);

    const cols = spectrogram.length;
    if (cols === 0) return;

    // Stretch columns across the full width regardless of how many we have
    const colWidth = rect.width / cols;
    const rowHeight = rect.height / SPECTRUM_BINS;

    // Draw waterfall — newest on right, scrolling left
    for (let c = 0; c < cols; c++) {
      const row = spectrogram[c];
      const xPos = c * colWidth;
      for (let r = 0; r < SPECTRUM_BINS; r++) {
        const pixel = row[r];
        if (!pixel) continue;
        const [cr, cg, cb] = pixel;
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
        const yPos = rect.height - (r + 1) * rowHeight;
        ctx.fillRect(xPos, yPos, colWidth + 1, rowHeight + 1);
      }
    }

    // Horizontal grid lines — 5 evenly spaced across the chart
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const y = (rect.height / 5) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(rect.width, y);
      ctx.stroke();
    }
  }, [spectrogram]);

  const displayWindows = spectrogram.length;
  const bandFirst = telemetry?.band[0] ?? 11;
  const bandLast = telemetry ? telemetry.band[telemetry.band.length - 1] : 52;

  if (isAwaiting) {
    return (
      <div className="relative h-full w-full overflow-hidden rounded-xl border border-ink-500/40 bg-ink-900">
        <AwaitingSignal />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-ink-500/40 bg-ink-900">
      {/* Header */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-start justify-between px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-slate-200">
            Live CSI Spectrogram
          </h2>
          <p className="mt-1 font-mono text-[10px] text-slate-500">
            Subcarriers {bandFirst}–{bandLast} · CH {telemetry?.channel ?? 3} · 0–10 Hz
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-500/5 px-2.5 py-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
            <span className="font-mono text-[10px] text-cyan-300">
              {displayWindows} windows
            </span>
          </div>
        </div>
      </div>

      {/* Y-axis labels */}
      <div className="absolute left-1 top-11 z-10 flex h-[calc(100%-3.5rem)] flex-col justify-between py-1">
        {FREQ_LABELS.map((freq) => (
          <span key={freq} className="font-mono text-[9px] text-slate-600">
            {freq}Hz
          </span>
        ))}
      </div>

      {/* Canvas — fills the full panel below the header */}
      <canvas
        ref={canvasRef}
        className="absolute left-7 top-11 h-[calc(100%-3.5rem)] w-[calc(100%-2rem)]"
      />

      {/* Top fade */}
      <div className="pointer-events-none absolute left-7 right-2 top-0 h-11 bg-gradient-to-b from-ink-900 to-transparent" />
      {/* Bottom fade */}
      <div className="pointer-events-none absolute bottom-0 left-7 right-2 h-6 bg-gradient-to-t from-ink-900 to-transparent" />
    </div>
  );
}
