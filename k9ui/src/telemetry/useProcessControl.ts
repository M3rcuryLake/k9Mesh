import { useCallback, useEffect, useRef, useState } from 'react';

export type ProcessStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

export interface StartParams {
  interface: string;
  calibrationSeconds?: number;
  skipCalibration: boolean;
}

const BRIDGE_URL =
  (import.meta.env.VITE_BRIDGE_URL as string | undefined) ?? '';

async function fetchJSON(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  return res.json();
}

function bridgeBase(): string {
  if (BRIDGE_URL) return BRIDGE_URL.replace(/\/$/, '');
  return '';
}

export function useProcessControl() {
  const [status, setStatus] = useState<ProcessStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pid, setPid] = useState<number | null>(null);
  const mountedRef = useRef(true);

  const base = bridgeBase();

  const checkStatus = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const data = await fetchJSON(`${base}/api/status`);
      if (!mountedRef.current) return;
      if (data.running) {
        if (data.firstPacket) {
          setStatus('running');
        } else {
          setStatus('starting');
        }
        setPid(data.pid ?? null);
      } else if (data.error && status !== 'starting' && status !== 'stopping') {
        setStatus('error');
        setErrorMsg(data.error);
      } else if (status !== 'starting' && status !== 'stopping') {
        setStatus('idle');
        setPid(null);
      }
    } catch {
      // Bridge not reachable — leave current status
    }
  }, [base, status]);

  useEffect(() => {
    mountedRef.current = true;
    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [checkStatus]);

  const start = useCallback(
    async (params: StartParams) => {
      setStatus('starting');
      setErrorMsg(null);
      try {
        const data = await fetchJSON(`${base}/api/start`, {
          method: 'POST',
          body: JSON.stringify(params),
        });
        if (data.error) {
          setStatus('error');
          setErrorMsg(data.error);
          return false;
        }
        setPid(data.pid ?? null);
        return true;
      } catch (err) {
        setStatus('error');
        setErrorMsg(
          'Cannot reach bridge server. Is it running? (npm run bridge)'
        );
        return false;
      }
    },
    [base]
  );

  const stop = useCallback(async () => {
    setStatus('stopping');
    setErrorMsg(null);
    try {
      await fetchJSON(`${base}/api/stop`, { method: 'POST' });
      setStatus('idle');
      setPid(null);
      return true;
    } catch {
      setStatus('error');
      setErrorMsg('Cannot reach bridge server. Is it running? (npm run bridge)');
      return false;
    }
  }, [base]);

  return { status, errorMsg, pid, start, stop };
}
