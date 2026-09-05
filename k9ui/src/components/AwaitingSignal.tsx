import { Radio } from 'lucide-react';

interface AwaitingSignalProps {
  label?: string;
  className?: string;
}

export function AwaitingSignal({
  label = 'AWAITING SIGNAL',
  className = '',
}: AwaitingSignalProps) {
  return (
    <div
      className={`flex h-full w-full min-w-max flex-col items-center justify-center gap-4 whitespace-nowrap p-6 text-center ${className}`}
    >
      <div className="relative flex h-12 w-12 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400/20" />
        <span className="absolute inline-flex h-10 w-10 animate-pulse rounded-full bg-cyan-400/10" />
        <Radio className="relative h-5 w-5 text-cyan-400/70" />
      </div>
      <span className="font-mono text-[11px] font-medium uppercase tracking-widest text-slate-500">
        {label}
      </span>
    </div>
  );
}
