import {
  Accelerometer,
  Gyroscope,
} from 'expo-sensors';

import * as Location from 'expo-location';

import {
  GPSReading,
  SensorReading,
} from './types';

type ReadingCallback =
  (reading: SensorReading) => void;

const MAX_BUFFER_SIZE = 50;

/*
 * 20 ms = approximately 50 samples/second.
 */
const SAMPLE_INTERVAL_MS = 20;

class SensorManagerClass {
  private accelerometer = {
    x: 0,
    y: 0,
    z: 0,
  };

  private gyroscope = {
    x: 0,
    y: 0,
    z: 0,
  };

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

  private sampleTimer:
    ReturnType<typeof setInterval> | null =
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

    /*
     * IMPORTANT:
     *
     * Accelerometer and gyroscope callbacks
     * ONLY update their latest values.
     *
     * We create one synchronized reading
     * every 20 ms here.
     */
    this.sampleTimer =
      setInterval(() => {
        this.emitReading();
      }, SAMPLE_INTERVAL_MS);

    this.started = true;
  }

  stop(): void {
    this.accelSubscription?.remove();
    this.gyroSubscription?.remove();
    this.gpsSubscription?.remove();

    this.accelSubscription = null;
    this.gyroSubscription = null;
    this.gpsSubscription = null;

    if (this.sampleTimer !== null) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }

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
     * Request approximately 50 Hz from
     * the phone sensors.
     */
    Accelerometer.setUpdateInterval(
      SAMPLE_INTERVAL_MS,
    );

    Gyroscope.setUpdateInterval(
      SAMPLE_INTERVAL_MS,
    );

    /*
     * Accelerometer callback:
     * only update latest value.
     */
    this.accelSubscription =
      Accelerometer.addListener(
        (reading) => {
          this.accelerometer = {
            x: reading.x ?? 0,
            y: reading.y ?? 0,
            z: reading.z ?? 0,
          };
        },
      );

    /*
     * Gyroscope callback:
     * only update latest value.
     */
    this.gyroSubscription =
      Gyroscope.addListener(
        (reading) => {
          this.gyroscope = {
            x: reading.x ?? 0,
            y: reading.y ?? 0,
            z: reading.z ?? 0,
          };
        },
      );

    /*
     * GPS is intentionally much slower.
     * We only update the latest GPS value.
     */
    try {
      const foregroundPermission =
        await Location.getForegroundPermissionsAsync();

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

  private emitReading(): void {
    const reading: SensorReading = {
      /*
       * Timestamp belongs to the sampling loop,
       * not an individual sensor callback.
       */
      timestamp: Date.now(),

      acc: {
        ...this.accelerometer,
      },

      gyro: {
        ...this.gyroscope,
      },

      gps: this.lastGps
        ? {
            ...this.lastGps,
          }
        : null,
    };

    this.buffer.push(reading);

    if (
      this.buffer.length >
      MAX_BUFFER_SIZE
    ) {
      this.buffer.splice(
        0,
        this.buffer.length -
          MAX_BUFFER_SIZE,
      );
    }

    for (const callback of this.callbacks) {
      callback(reading);
    }
  }
}

export const sensorManager =
  new SensorManagerClass();