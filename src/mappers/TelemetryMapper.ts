import type { ICDTelemetryMessage, ICDRoverTelemetryData } from '../types/icd';
import type { RoverTelemetry } from '../types/telemetry';

/** Default disconnected / null telemetry baseline */
export const NULL_TELEMETRY: RoverTelemetry = {
  timestamp: 0,
  radio: {
    linkQuality: null,
    rssi: null,
    latency: null,
    signalPercent: null,
    channel: null,
    dropped: null,
  },
  hardware: {
    stm32: null,
    esp32: null,
    mqtt: null,
    wifi: null,
    coreTemp: null,
  },
  battery: {
    percent: null,
    voltage: null,
    estTime: null,
    discharge: null,
  },
  csi: {
    breathingDetected: null,
    breathingRate: null,
    confidence: null,
    state: null,
    arrayOnline: null,
    calibrated: null,
  },
  motion: {
    level: null,
    lastEventSeconds: null,
    variance: null,
    threshold: null,
  },
  gps: {
    latitude: null,
    longitude: null,
  },
  imu: {
    heading: null,
    pitch: null,
    roll: null,
  },
  odometry: {
    speed: null,
    distance: null,
    motors: {
      FL: null,
      FR: null,
      RL: null,
      RR: null,
    },
  },
};

/**
 * Adapter mapping ICD-formatted payloads into the React RoverTelemetry state.
 *
 * Ensures backward compatibility, handles missing/partial fields, and guarantees
 * strict type conformity with zero UI component alterations.
 */
export class TelemetryMapper {
  /**
   * Maps an ICD message envelope or raw data object into a RoverTelemetry model.
   */
  public static fromICD(
    raw: ICDTelemetryMessage | ICDRoverTelemetryData | Record<string, unknown>
  ): RoverTelemetry {
    if (!raw) {
      return { ...NULL_TELEMETRY, timestamp: Date.now() };
    }

    // Check if the payload is wrapped in the standard ICD envelope: { data: { ... }, timestamp_epoch_ms: ... }
    const isEnvelope = 'msg_type' in raw && 'data' in raw;
    const timestamp = isEnvelope
      ? Number((raw as ICDTelemetryMessage).timestamp_epoch_ms) || Date.now()
      : typeof (raw as Record<string, unknown>).timestamp === 'number'
      ? ((raw as Record<string, unknown>).timestamp as number)
      : Date.now();

    const data = (
      isEnvelope ? (raw as ICDTelemetryMessage).data : raw
    ) as ICDRoverTelemetryData;

    return {
      timestamp,
      radio: {
        linkQuality: data?.radio?.linkQuality ?? null,
        rssi: data?.radio?.rssi ?? null,
        latency: data?.radio?.latency ?? null,
        signalPercent: data?.radio?.signalPercent ?? null,
        channel: data?.radio?.channel ?? null,
        dropped: data?.radio?.dropped ?? null,
      },
      hardware: {
        stm32: data?.hardware?.stm32 ?? null,
        esp32: data?.hardware?.esp32 ?? null,
        mqtt: data?.hardware?.mqtt ?? null,
        wifi: data?.hardware?.wifi ?? null,
        coreTemp: data?.hardware?.coreTemp ?? null,
      },
      battery: {
        percent: data?.battery?.percent ?? null,
        voltage: data?.battery?.voltage ?? null,
        estTime: data?.battery?.estTime ?? null,
        discharge: data?.battery?.discharge ?? null,
      },
      csi: {
        breathingDetected: data?.csi?.breathingDetected ?? null,
        breathingRate: data?.csi?.breathingRate ?? null,
        confidence: data?.csi?.confidence ?? null,
        state: data?.csi?.state ?? null,
        arrayOnline: data?.csi?.arrayOnline ?? null,
        calibrated: data?.csi?.calibrated ?? null,
      },
      motion: {
        level: data?.motion?.level ?? null,
        lastEventSeconds: data?.motion?.lastEventSeconds ?? null,
        variance: data?.motion?.variance ?? null,
        threshold: data?.motion?.threshold ?? null,
      },
      gps: {
        latitude: data?.gps?.latitude ?? null,
        longitude: data?.gps?.longitude ?? null,
      },
      imu: {
        heading: data?.imu?.heading ?? null,
        pitch: data?.imu?.pitch ?? null,
        roll: data?.imu?.roll ?? null,
      },
      odometry: {
        speed: data?.odometry?.speed ?? null,
        distance: data?.odometry?.distance ?? null,
        motors: {
          FL: data?.odometry?.motors?.FL ?? null,
          FR: data?.odometry?.motors?.FR ?? null,
          RL: data?.odometry?.motors?.RL ?? null,
          RR: data?.odometry?.motors?.RR ?? null,
        },
      },
    };
  }
}
