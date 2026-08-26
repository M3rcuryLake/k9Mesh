import { useState, useEffect } from 'react';
import type { RoverTelemetry } from '../types/telemetry';

export type MissionState =
  | 'INITIALIZING'
  | 'WAITING_FOR_ROVER'
  | 'CONNECTED'
  | 'TELEMETRY_ACTIVE'
  | 'DIAGNOSTICS'
  | 'CALIBRATING'
  | 'READY'
  | 'NOT_READY'
  | 'LINK_LOST'
  | 'RECONNECTING';

export function useMissionState(
  status: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING' | 'ERROR',
  telemetry: RoverTelemetry
): MissionState {
  const [missionState, setMissionState] = useState<MissionState>('INITIALIZING');
  const [hasEverConnected, setHasEverConnected] = useState(false);

  useEffect(() => {
    if (status === 'CONNECTED') {
      setHasEverConnected(true);
    }
  }, [status]);

  useEffect(() => {
    // Determine state purely based on available evidence, avoiding fabricating PASS.
    if (status === 'CONNECTING' || status === 'ERROR') {
      setMissionState(hasEverConnected ? 'RECONNECTING' : 'WAITING_FOR_ROVER');
      return;
    }

    if (status === 'DISCONNECTED') {
      setMissionState(hasEverConnected ? 'LINK_LOST' : 'WAITING_FOR_ROVER');
      return;
    }

    if (status === 'CONNECTED') {
      // If telemetry has no valid node_id or timestamp, we are just connected.
      if (telemetry.timestamp === 0) {
        setMissionState('CONNECTED');
        return;
      }

      // Check for calibration
      if (telemetry.csi.calibrated === true) {
        // If we had explicit full hardware checks, we would evaluate them here
        // For now, if calibrated, we are 'READY' (or 'NOT_READY' if not all pass)
        // Given backend lacks full hardware signals, we won't fake MISSION READY easily.
        // Actually, user says: "If mandatory health data is not yet available: MISSION READY must remain false."
        // We do not have STM32 health, IMU health, etc. So we remain at CALIBRATED or TELEMETRY_ACTIVE.
        // The prompt says: "If the current telemetry contract does not expose diagnostic/calibration completion: remain in an honest state such as TELEMETRY ACTIVE".
        setMissionState('TELEMETRY_ACTIVE');
        return;
      }

      setMissionState('TELEMETRY_ACTIVE');
    }
  }, [status, telemetry, hasEverConnected]);

  return missionState;
}
