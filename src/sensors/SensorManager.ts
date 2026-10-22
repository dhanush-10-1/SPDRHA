import {
  Accelerometer,
  Gyroscope,
} from 'expo-sensors';

import * as Location from 'expo-location';

import {
  GPSReading,
  SensorReading,
} from './types';
import {
  canSynchronizeSources,
  isWithinSyncTolerance,
  nativeSensorTimestampToMs,
  ResolvedSensorTimestamp,
  resolveSensorTimestamp,
  SensorTimestampSource,
} from './timestamps';

type ReadingCallback =
  (reading: SensorReading) => void;

const MAX_BUFFER_SIZE = 40;
const MAX_PENDING_OBSERVATIONS = 8;
/*
 * Training recordings have a median interval of 33 ms and reject gaps over
 * 100 ms. Pairing within 50 ms allows normal callback jitter without pairing
 * observations across a training-invalid gap.
 */
export const SENSOR_SYNC_TOLERANCE_MS = 50;

type SensorVector = {
  x: number;
  y: number;
  z: number;
};

type TimedObservation = {
  timestampMs: number;
  epochTimestampMs: number;
  source: SensorTimestampSource;
  value: SensorVector;
};

type SensorMeasurement = SensorVector & {
  timestamp?: number;
};

class SensorManagerClass {
  private pendingAccelerometer: TimedObservation[] = [];
  private pendingGyroscope: TimedObservation[] = [];
  private lastAccelerometerTimestamp: number | null = null;
  private lastGyroscopeTimestamp: number | null = null;
  private lastAccelerometerSource: SensorTimestampSource | null = null;
  private lastGyroscopeSource: SensorTimestampSource | null = null;
  private clockReferences: Partial<
    Record<
      SensorTimestampSource,
      { monotonicMs: number; epochMs: number }
    >
  > = {};
  private lastEmittedTimestamp: number | null = null;

  private lastGps:
    GPSReading | null = null;

  private buffer: SensorReading[] = [];

  private callbacks =
    new Set<ReadingCallback>();

  private accelSubscription:
    { remove: () => void } | null = null;

  private gyroSubscription:
    { remove: () => void } | null = null;

  private gpsSubscription:
    Location.LocationSubscription | null =
      null;

  private started = false;

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    const [
      accelerometerAvailable,
      gyroscopeAvailable,
    ] = await Promise.all([
      Accelerometer.isAvailableAsync(),
      Gyroscope.isAvailableAsync(),
    ]);

    if (
      !accelerometerAvailable ||
      !gyroscopeAvailable
    ) {
      throw new Error(
        'Sensor hardware is unavailable on this device.',
      );
    }

    await this.startSubscriptions();

    this.started = true;
  }

  stop(): void {
    this.accelSubscription?.remove();
    this.gyroSubscription?.remove();
    this.gpsSubscription?.remove();

    this.accelSubscription = null;
    this.gyroSubscription = null;
    this.gpsSubscription = null;
    this.pendingAccelerometer = [];
    this.pendingGyroscope = [];
    this.lastAccelerometerTimestamp = null;
    this.lastGyroscopeTimestamp = null;
    this.lastAccelerometerSource = null;
    this.lastGyroscopeSource = null;
    this.clockReferences = {};
    this.lastEmittedTimestamp = null;

    this.started = false;
  }

  getBuffer(): SensorReading[] {
    return [...this.buffer];
  }

  getLastGPS(): GPSReading | null {
    return this.lastGps;
  }

  onReading(
    callback: ReadingCallback,
  ): () => void {
    this.callbacks.add(callback);

    return () => {
      this.callbacks.delete(callback);
    };
  }

  private async startSubscriptions(): Promise<void> {
    /*
     * Request the cadence used by the training recordings. The callbacks,
     * rather than a timer, determine when a new observation exists.
     */
    Accelerometer.setUpdateInterval(33);
    Gyroscope.setUpdateInterval(33);

    this.accelSubscription =
      Accelerometer.addListener(
        (reading: SensorMeasurement) => {
          this.addObservation(
            'accelerometer',
            reading,
          );
        },
      );

    this.gyroSubscription =
      Gyroscope.addListener(
        (reading: SensorMeasurement) => {
          this.addObservation(
            'gyroscope',
            reading,
          );
        },
      );

    /*
     * GPS is intentionally much slower.
     * We only update the latest GPS value.
     */
    try {
      const foregroundPermission =
        await Location.requestForegroundPermissionsAsync();

      if (!foregroundPermission.granted) {
        console.warn(
          'Location permission not granted. Continuing without GPS.',
        );
        return;
      }

      const servicesEnabled =
        await Location.hasServicesEnabledAsync();

      if (!servicesEnabled) {
        console.warn(
          'Location services are disabled. Continuing without GPS.',
        );
        return;
      }

      this.gpsSubscription =
        await Location.watchPositionAsync(
          {
            accuracy:
              Location.Accuracy
                .BestForNavigation,

            timeInterval: 1000,

            distanceInterval: 0,
          },

          (location) => {
            const speed =
              typeof location.coords
                .speed === 'number' &&
              Number.isFinite(
                location.coords.speed,
              )
                ? location.coords.speed
                : 0;

            this.lastGps = {
              lat:
                location.coords.latitude,

              lng:
                location.coords.longitude,

              speedKmh:
                speed * 3.6,

              accuracyM:
                location.coords
                  .accuracy ?? 0,

              timestamp:
                location.timestamp,
            };
          },
        );
    } catch (error) {
      console.warn(
        'GPS unavailable or not granted; continuing with sensor-only capture.',
        error,
      );
    }
  }

  private addObservation(
    kind: 'accelerometer' | 'gyroscope',
    measurement: SensorMeasurement,
  ): void {
    if (
      !Number.isFinite(measurement.x) ||
      !Number.isFinite(measurement.y) ||
      !Number.isFinite(measurement.z)
    ) {
      return;
    }

    const resolvedTimestamp = this.resolveMeasurementTimestamp(
      measurement.timestamp,
    );
    if (resolvedTimestamp === null) {
      return;
    }

    const source =
      kind === 'accelerometer'
        ? this.lastAccelerometerSource
        : this.lastGyroscopeSource;
    const lastTimestamp =
      kind === 'accelerometer'
        ? this.lastAccelerometerTimestamp
        : this.lastGyroscopeTimestamp;

    if (source !== null && source !== resolvedTimestamp.source) {
      if (kind === 'accelerometer') {
        this.pendingAccelerometer = [];
        this.lastAccelerometerTimestamp = null;
      } else {
        this.pendingGyroscope = [];
        this.lastGyroscopeTimestamp = null;
      }
    }

    if (
      lastTimestamp !== null &&
      resolvedTimestamp.monotonicMs <= lastTimestamp
    ) {
      return;
    }

    const observation: TimedObservation = {
      timestampMs: resolvedTimestamp.monotonicMs,
      epochTimestampMs: resolvedTimestamp.epochMs,
      source: resolvedTimestamp.source,
      value: {
        x: measurement.x,
        y: measurement.y,
        z: measurement.z,
      },
    };

    if (kind === 'accelerometer') {
      this.lastAccelerometerTimestamp =
        resolvedTimestamp.monotonicMs;
      this.lastAccelerometerSource =
        resolvedTimestamp.source;
      this.pendingAccelerometer.push(observation);
    } else {
      this.lastGyroscopeTimestamp =
        resolvedTimestamp.monotonicMs;
      this.lastGyroscopeSource =
        resolvedTimestamp.source;
      this.pendingGyroscope.push(observation);
    }

    this.trimPendingObservations();
    this.emitSynchronizedReadings();
  }

  private resolveMeasurementTimestamp(
    timestampSeconds: number | undefined,
  ): ResolvedSensorTimestamp | null {
    const nativeTimestampMs =
      nativeSensorTimestampToMs(timestampSeconds);
    const source: SensorTimestampSource =
      nativeTimestampMs === null ? 'fallback' : 'native';

    if (nativeTimestampMs === null) {
      const performanceObject = globalThis.performance;
      if (
        performanceObject === undefined ||
        typeof performanceObject.now !== 'function'
      ) {
        return null;
      }
    }

    const monotonicMs =
      nativeTimestampMs ??
      globalThis.performance.now();
    const reference = this.clockReferences[source];

    if (reference === undefined) {
      const newReference = {
        monotonicMs,
        epochMs: Date.now(),
      };
      this.clockReferences[source] = newReference;
    }

    const calibratedReference = this.clockReferences[source];
    if (calibratedReference === undefined) {
      return null;
    }

    return resolveSensorTimestamp(
      timestampSeconds,
      source === 'fallback' ? monotonicMs : null,
      calibratedReference.monotonicMs,
      calibratedReference.epochMs,
    );
  }

  private trimPendingObservations(): void {
    if (
      this.pendingAccelerometer.length >
      MAX_PENDING_OBSERVATIONS
    ) {
      this.pendingAccelerometer.shift();
    }

    if (
      this.pendingGyroscope.length >
      MAX_PENDING_OBSERVATIONS
    ) {
      this.pendingGyroscope.shift();
    }
  }

  private emitSynchronizedReadings(): void {
    while (
      this.pendingAccelerometer.length > 0 &&
      this.pendingGyroscope.length > 0
    ) {
      const accelerometer = this.pendingAccelerometer[0];
      const gyroscopeSource =
        this.pendingGyroscope[0].source;

      if (
        !canSynchronizeSources(
          accelerometer.source,
          gyroscopeSource,
        )
      ) {
        this.pendingAccelerometer.shift();
        this.pendingGyroscope.shift();
        continue;
      }

      const gyroscopeIndex = this.pendingGyroscope.reduce(
        (closestIndex, observation, index, observations) =>
          Math.abs(
            observation.timestampMs -
              accelerometer.timestampMs,
          ) <
          Math.abs(
            observations[closestIndex].timestampMs -
              accelerometer.timestampMs,
          )
            ? index
            : closestIndex,
        0,
      );
      const gyroscope =
        this.pendingGyroscope[gyroscopeIndex];
      const difference =
        accelerometer.timestampMs - gyroscope.timestampMs;

      /*
       * Pair each accelerometer observation with the closest unused
       * gyroscope observation. If the oldest accelerometer is already
       * before the oldest gyroscope by more than the tolerance, no later
       * gyroscope can match it, so discard it (and vice versa).
       */
      if (
        !isWithinSyncTolerance(
          accelerometer.timestampMs,
          gyroscope.timestampMs,
          SENSOR_SYNC_TOLERANCE_MS,
        )
      ) {
        if (difference < 0) {
          this.pendingAccelerometer.shift();
        } else {
          this.pendingGyroscope.shift();
        }
        continue;
      }

      this.pendingAccelerometer.shift();
      this.pendingGyroscope.splice(gyroscopeIndex, 1);

      const reading: SensorReading = {
        timestamp: Math.max(
          accelerometer.epochTimestampMs,
          gyroscope.epochTimestampMs,
        ),
        sensorTimestampMs: Math.max(
          accelerometer.timestampMs,
          gyroscope.timestampMs,
        ),
        acc: accelerometer.value,
        gyro: gyroscope.value,
        gps: this.lastGps
          ? { ...this.lastGps }
          : null,
      };

      if (
        this.lastEmittedTimestamp !== null &&
        reading.timestamp <= this.lastEmittedTimestamp
      ) {
        continue;
      }

      this.lastEmittedTimestamp = reading.timestamp;

      this.buffer.push(reading);

      if (this.buffer.length > MAX_BUFFER_SIZE) {
        this.buffer.splice(
          0,
          this.buffer.length - MAX_BUFFER_SIZE,
        );
      }

      for (const callback of this.callbacks) {
        callback(reading);
      }
    }
  }
}

export const sensorManager =
  new SensorManagerClass();