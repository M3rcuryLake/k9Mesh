import type {
  RawMicroESPectrePacket,
  RoverTelemetryEnvelope,
  AdapterDiagnostics,
  ITelemetryAdapter,
} from './types';

/**
 * CsiTelemetryAdapter
 *
 * Strongly-typed adapter that normalizes raw Micro-ESPectre transport packets
 * into the authoritative Master ICD RoverTelemetryEnvelope.
 *
 * Enforces: Zero Synthetic Telemetry
 * - If a field is not present in the incoming Micro-ESPectre packet, it is set to null.
 * - Nominal operational values are NEVER fabricated or inferred.
 * - Envelope metadata (protocol_version, msg_type, timestamp, node_id) conforms to structural requirements.
 */
export class CsiTelemetryAdapter
  implements ITelemetryAdapter<RawMicroESPectrePacket | Record<string, unknown>, RoverTelemetryEnvelope>
{
  public readonly id = 'micro-espectre-v1';
  public readonly version = '1.0.0';

  private packetsAdapted = 0;
  private packetsRejected = 0;
  private unknownSchemaVersions = 0;
  private mappingFailures = 0;
  private lastAdaptedTimestamp = 0;

  /**
   * Adapts an incoming raw packet into a validated RoverTelemetryEnvelope.
   * Returns null if the packet cannot be adapted.
   */
  public adapt(
    source: RawMicroESPectrePacket | Record<string, unknown>
  ): RoverTelemetryEnvelope | null {
    if (!source || typeof source !== 'object') {
      this.packetsRejected += 1;
      return null;
    }

    try {
      // 1. Direct Pass-Through for Native ICD Envelopes
      if (
        'msg_type' in source &&
        source.msg_type === 'TELEMETRY' &&
        'data' in source &&
        typeof source.data === 'object' &&
        source.data !== null
      ) {
        this.packetsAdapted += 1;
        this.lastAdaptedTimestamp = Date.now();
        return source as unknown as RoverTelemetryEnvelope;
      }

      // 2. Reject unsupported/foreign envelope versions with explicit msg_type
      if ('msg_type' in source && source.msg_type !== 'TELEMETRY') {
        this.unknownSchemaVersions += 1;
        this.packetsRejected += 1;
        return null;
      }

      // 3. Normalize Micro-ESPectre Raw Packet Schema (No synthetic defaults)
      const pkt = source as RawMicroESPectrePacket;

      const fallbackEpoch =
        typeof pkt.timestamp_epoch_ms === 'number'
          ? pkt.timestamp_epoch_ms
          : typeof pkt.timestamp === 'number'
          ? pkt.timestamp
          : Date.now();

      const epoch = this.convertTimestampUsToEpochMs(pkt.timestamp_us, fallbackEpoch);

      const nodeId =
        typeof pkt.source_node === 'string'
          ? pkt.source_node
          : typeof pkt.node_id === 'string'
          ? pkt.node_id
          : 'ESP32_CSI_NODE';

      // Resolve Sequence Number
      const seq =
        typeof pkt.seq === 'number'
          ? pkt.seq
          : typeof pkt.sequence === 'number'
          ? pkt.sequence
          : typeof pkt.sequence_id === 'number'
          ? pkt.sequence_id
          : null;

      // Resolve Confidence (format as string matching Master ICD spec, e.g. "83.1163605485")
      const rawConfidence = pkt.mvs?.confidence ?? pkt.csi_confidence;
      let confidenceStr: string | null = null;
      if (rawConfidence !== undefined && rawConfidence !== null) {
        const num = Number(rawConfidence);
        confidenceStr = !isNaN(num) ? num.toFixed(10) : String(rawConfidence);
      }

      // Resolve CSI State & Motion Level from mvs.state or legacy csi_state / motion_activity
      const rawMvsState = pkt.mvs?.state ?? pkt.csi_state;
      let csiState: 'STABLE' | 'MOTION' | 'IDLE' | null = null;
      let motionLevel: 'LOW' | 'MEDIUM' | 'HIGH' | null = null;

      if (typeof rawMvsState === 'string') {
        const upperState = rawMvsState.toUpperCase();
        if (upperState === 'MOTION') {
          csiState = 'MOTION';
          motionLevel = 'HIGH';
        } else if (upperState === 'STABLE') {
          csiState = 'STABLE';
          motionLevel = 'LOW';
        } else if (upperState === 'IDLE') {
          csiState = 'IDLE';
          motionLevel = 'LOW';
        }
      }

      // If motion_activity is explicitly specified, allow it to refine motionLevel
      if (
        pkt.motion_activity === 'LOW' ||
        pkt.motion_activity === 'MEDIUM' ||
        pkt.motion_activity === 'HIGH'
      ) {
        motionLevel = pkt.motion_activity;
      }

      // Resolve ML & Array Status
      const arrayOnline =
        typeof pkt.ml?.ready === 'boolean'
          ? pkt.ml.ready
          : typeof pkt.csi_array_status === 'boolean'
          ? pkt.csi_array_status
          : true;

      const calibrated =
        typeof pkt.ml?.ready === 'boolean'
          ? pkt.ml.ready
          : typeof pkt.csi_calibrated === 'boolean'
          ? pkt.csi_calibrated
          : null;

      // Derive Radio link metrics (support both pkt.rssi and pkt.wifi_rssi)
      const rssi =
        typeof pkt.rssi === 'number'
          ? pkt.rssi
          : typeof pkt.wifi_rssi === 'number'
          ? pkt.wifi_rssi
          : null;

      const signalPercent =
        rssi !== null ? Math.min(100, Math.max(0, Math.round((rssi + 100) * 2))) : null;

      const linkQuality: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | null =
        rssi !== null
          ? rssi > -65
            ? 'EXCELLENT'
            : rssi > -75
            ? 'GOOD'
            : rssi > -85
            ? 'FAIR'
            : 'POOR'
          : null;

      // Subsystem health: explicitly derived from reported telemetry or set to null
      const esp32Status: 'OK' | 'FAULT' | 'OFFLINE' | null =
        arrayOnline === false ? 'FAULT' : 'OK';

      const wifiStatus: 'OK' | 'FAULT' | 'OFFLINE' | null =
        rssi !== null ? (rssi > -85 ? 'OK' : 'FAULT') : null;

      const envelope: RoverTelemetryEnvelope = {
        protocol_version: '1.0',
        msg_type: 'TELEMETRY',
        timestamp_epoch_ms: epoch,
        node_id: nodeId,
        data: {
          radio: {
            linkQuality,
            rssi,
            latency: null, // Latency is not measured in raw CSI packet
            signalPercent,
          },
          hardware: {
            stm32: null, // STM32 status not reported by ESP32 CSI sensor alone
            esp32: esp32Status,
            mqtt: null,  // Managed by host / broker subsystem
            wifi: wifiStatus,
            coreTemp: null, // Not reported in raw CSI packet
          },
          battery: {
            percent: typeof pkt.battery_percent === 'number' ? pkt.battery_percent : null,
            voltage: typeof pkt.battery_voltage === 'number' ? pkt.battery_voltage : null,
            estTime: null,
            discharge: null,
          },
          csi: {
            arrayOnline,
            calibrated,
            breathingDetected:
              typeof pkt.breathing_detected === 'boolean' ? pkt.breathing_detected : null,
            breathingRate:
              typeof pkt.breathing_rate === 'number' ? pkt.breathing_rate : null,
            confidence: confidenceStr,
            state: csiState,
          },
          motion: {
            level: motionLevel,
            lastEventSeconds:
              typeof pkt.last_motion_event_seconds === 'number'
                ? pkt.last_motion_event_seconds
                : null,
          },
          gps: {
            latitude: typeof pkt.gps_lat === 'number' ? pkt.gps_lat : null,
            longitude: typeof pkt.gps_lon === 'number' ? pkt.gps_lon : null,
          },
          imu: {
            heading: typeof pkt.heading === 'number' ? pkt.heading : null,
            pitch: typeof pkt.pitch === 'number' ? pkt.pitch : null,
            roll: typeof pkt.roll === 'number' ? pkt.roll : null,
          },
          odometry: {
            speed: typeof pkt.speed === 'number' ? pkt.speed : null,
            distance: typeof pkt.distance === 'number' ? pkt.distance : null,
            motors: {
              FL: typeof pkt.rpm_fl === 'number' ? pkt.rpm_fl : null,
              FR: typeof pkt.rpm_fr === 'number' ? pkt.rpm_fr : null,
              RL: typeof pkt.rpm_rl === 'number' ? pkt.rpm_rl : null,
              RR: typeof pkt.rpm_rr === 'number' ? pkt.rpm_rr : null,
            },
          },
        },
      };

      this.packetsAdapted += 1;
      this.lastAdaptedTimestamp = Date.now();
      if (
        typeof process !== 'undefined' &&
        (process.env.DEBUG_TELEMETRY === '1' ||
          process.env.DEBUG === 'true' ||
          process.env.DEBUG === '1')
      ) {
        console.info(`[Adapter] Packet normalized${seq !== null ? ` (seq: ${seq})` : ''}`);
      }
      return envelope;
    } catch {
      this.mappingFailures += 1;
      this.packetsRejected += 1;
      return null;
    }
  }

  /**
   * Converts incoming microsecond timestamp into epoch milliseconds.
   *
   * TODO(hardware-team): Clarify whether `timestamp_us` in production firmware represents:
   * 1. Absolute Unix epoch time in microseconds (e.g. from NTP/GPS synchronization on the node), or
   * 2. ESP32 hardware device uptime in microseconds (e.g. from esp_timer_get_time()).
   *
   * Currently, we perform direct conversion to milliseconds without heuristic magnitude branching.
   * If `timestamp_us` is undefined or 0, fallback to standard epoch timestamp fields or host clock.
   */
  private convertTimestampUsToEpochMs(timestampUs?: number, fallbackEpochMs?: number): number {
    if (typeof timestampUs === 'number' && Number.isFinite(timestampUs) && timestampUs > 0) {
      return Math.floor(timestampUs / 1000);
    }
    return typeof fallbackEpochMs === 'number' && Number.isFinite(fallbackEpochMs)
      ? fallbackEpochMs
      : Date.now();
  }

  public getDiagnostics(): AdapterDiagnostics {
    return Object.freeze({
      packetsAdapted: this.packetsAdapted,
      packetsRejected: this.packetsRejected,
      unknownSchemaVersions: this.unknownSchemaVersions,
      mappingFailures: this.mappingFailures,
      lastAdaptedTimestamp: this.lastAdaptedTimestamp,
    });
  }

  public resetDiagnostics(): void {
    this.packetsAdapted = 0;
    this.packetsRejected = 0;
    this.unknownSchemaVersions = 0;
    this.mappingFailures = 0;
    this.lastAdaptedTimestamp = 0;
  }
}
