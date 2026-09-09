import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Telemetry, TelemetryHistory, ConnectionStatus } from '@/types/telemetry';
import { createHistoryTracker } from '@/telemetry/mockGenerator';

function createInitialHistory(): TelemetryHistory {
  return createHistoryTracker().history;
}

interface TelemetryContextValue {
  telemetry: Telemetry | null;
  history: TelemetryHistory;
  uptime: number;
  connectionStatus: ConnectionStatus;
}

const TelemetryContext = createContext<TelemetryContextValue | null>(null);

const WS_URL = 'ws://127.0.0.1:8080';
const RECONNECT_INTERVAL_MS = 2000;


export function TelemetryProvider({ children }: { children: ReactNode }) {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [history, setHistory] = useState<TelemetryHistory>(createInitialHistory);
  const [uptime, setUptime] = useState(0);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('awaiting');

  const trackerRef = useRef(createHistoryTracker());
  const startRef = useRef(Date.now());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasReceivedDataRef = useRef(false);
  const uptimeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Uptime counter — only advances while we have data
  useEffect(() => {
    uptimeTimerRef.current = setInterval(() => {
      if (hasReceivedDataRef.current) {
        setUptime(Math.floor((Date.now() - startRef.current) / 1000));
      }
    }, 1000);
    return () => {
      if (uptimeTimerRef.current) clearInterval(uptimeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    function connect() {
      if (disposed) return;

      let ws: WebSocket;
      try {
        ws = new WebSocket(WS_URL);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        if (hasReceivedDataRef.current) {
          // Had data before, now reconnected — will go LIVE on first message
          setConnectionStatus('offline');
        } else {
          setConnectionStatus('awaiting');
        }
      };

      ws.onmessage = (event: MessageEvent) => {
        if (disposed) return;
        let parsed: Telemetry;
        try {
          parsed = JSON.parse(event.data as string) as Telemetry;
        } catch {
          console.warn('Dropped malformed WebSocket frame');
          return;
        }

        if (!parsed || typeof parsed !== 'object') {
          console.warn('Dropped invalid telemetry frame');
          return;
        }

        if (!hasReceivedDataRef.current) {
          hasReceivedDataRef.current = true;
          startRef.current = Date.now();
        }

        const hist = trackerRef.current.update(parsed);
        setTelemetry(parsed);
        setHistory({
          motion: [...hist.motion],
          breathing: [...hist.breathing],
          ai: [...hist.ai],
          spectrogram: [...hist.spectrogram],
        });
        setConnectionStatus('live');
      };

      ws.onclose = () => {
        if (disposed) return;
        wsRef.current = null;
        if (hasReceivedDataRef.current) {
          setConnectionStatus('offline');
        } else {
          setConnectionStatus('awaiting');
        }
        scheduleReconnect();
      };

      ws.onerror = () => {
        // The close handler will fire after this and handle reconnection
      };
    }

    function scheduleReconnect() {
      if (disposed) return;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, RECONNECT_INTERVAL_MS);
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return (
    <TelemetryContext.Provider
      value={{ telemetry, history, uptime, connectionStatus }}
    >
      {children}
    </TelemetryContext.Provider>
  );
}

export function useTelemetry(): TelemetryContextValue {
  const ctx = useContext(TelemetryContext);
  if (!ctx) {
    throw new Error('useTelemetry must be used within TelemetryProvider');
  }
  return ctx;
}
