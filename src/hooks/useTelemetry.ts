import { useState, useEffect } from 'react';
import type { TelemetryProvider, ConnectionStatus } from '../types/provider';
import type { RoverTelemetry } from '../types/telemetry';
import { NULL_TELEMETRY } from '../mappers/TelemetryMapper';

export interface UseTelemetryResult {
  telemetry: RoverTelemetry;
  status: ConnectionStatus;
  error: Error | null;
}

/**
 * Custom React hook for subscribing to a TelemetryProvider.
 *
 * Manages provider connection lifecycle, real-time subscription registration,
 * status change tracking, and automatic cleanup on unmount.
 *
 * @param provider An instance of TelemetryProvider
 * @returns { telemetry, status, error }
 */
export function useTelemetry(provider: TelemetryProvider): UseTelemetryResult {
  const [telemetry, setTelemetry] = useState<RoverTelemetry>(() => {
    // If provider already has current snapshot, use it immediately
    if ('getCurrentTelemetry' in provider && typeof (provider as unknown as { getCurrentTelemetry: () => RoverTelemetry }).getCurrentTelemetry === 'function') {
      return (provider as unknown as { getCurrentTelemetry: () => RoverTelemetry }).getCurrentTelemetry();
    }
    return { ...NULL_TELEMETRY, timestamp: Date.now() };
  });

  const [status, setStatus] = useState<ConnectionStatus>(() => provider.getStatus());
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;

    // Register status change listener
    const unsubscribeStatus = provider.onStatusChange((newStatus) => {
      if (isMounted) {
        setStatus(newStatus);
      }
    });

    // Register telemetry stream listener
    const unsubscribeTelemetry = provider.subscribe((newTelemetry) => {
      if (isMounted) {
        setTelemetry(newTelemetry);
      }
    });

    // Initiate provider connection
    provider.connect().catch((err: unknown) => {
      if (isMounted) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    });

    // Cleanup on unmount or provider instance swap
    return () => {
      isMounted = false;
      unsubscribeTelemetry();
      unsubscribeStatus();
      provider.disconnect().catch((err) => {
        console.error('[useTelemetry] Error during provider disconnection:', err);
      });
    };
  }, [provider]);

  return { telemetry, status, error };
}
