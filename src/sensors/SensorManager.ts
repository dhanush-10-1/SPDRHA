import { Accelerometer, Gyroscope } from 'expo-sensors';
import * as Location from 'expo-location';
import { GPSReading, SensorReading } from './types';

type ReadingCallback = (reading: SensorReading) => void;

const MAX_BUFFER_SIZE = 50;

class SensorManagerClass {
  private accelerometer = { x: 0, y: 0, z: 0 };
  private gyroscope = { x: 0, y: 0, z: 0 };
  private lastGps: GPSReading | null = null;
  private buffer: SensorReading[] = [];
  private callbacks = new Set<ReadingCallback>();
  private accelSubscription: { remove: () => void } | null = null;
  private gyroSubscription: { remove: () => void } | null = null;
  private gpsSubscription: Location.LocationSubscription | null = null;
  private started = false;

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    const sensorStatus = await Promise.all([
      Accelerometer.isAvailableAsync(),
      Gyroscope.isAvailableAsync(),
    ]);
    const [locationPermission, servicesEnabled] = await Promise.all([
      Location.requestForegroundPermissionsAsync(),
      Location.hasServicesEnabledAsync(),
    ]);

    const sensorsGranted = sensorStatus.every(Boolean);
    const locationGranted = locationPermission.granted && servicesEnabled;

    if (!sensorsGranted || !locationGranted) {
      this.started = false;
      throw new Error('Location permission is required for road anomaly detection. Please enable it in Settings.');
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
    this.started = false;
  }

  getBuffer(): SensorReading[] {
    return [...this.buffer];
  }

  getLastGPS(): GPSReading | null {
    return this.lastGps;
  }

  onReading(callback: ReadingCallback): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  private async startSubscriptions() {
    Accelerometer.setUpdateInterval(20);
    Gyroscope.setUpdateInterval(20);

    this.accelSubscription = Accelerometer.addListener((reading) => {
      this.accelerometer = { x: reading.x ?? 0, y: reading.y ?? 0, z: reading.z ?? 0 };
      this.emitReading();
    });

    this.gyroSubscription = Gyroscope.addListener((reading) => {
      this.gyroscope = { x: reading.x ?? 0, y: reading.y ?? 0, z: reading.z ?? 0 };
      this.emitReading();
    });

    this.gpsSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 0,
      },
      (location) => {
        const speed = typeof location.coords.speed === 'number' && Number.isFinite(location.coords.speed) ? location.coords.speed : 0;
        this.lastGps = {
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          speedKmh: speed * 3.6,
          accuracyM: location.coords.accuracy ?? 0,
          timestamp: location.timestamp,
        };
        this.emitReading();
      },
    );
  }

  private emitReading() {
    const reading: SensorReading = {
      timestamp: Date.now(),
      acc: { ...this.accelerometer },
      gyro: { ...this.gyroscope },
      gps: this.lastGps ? { ...this.lastGps } : null,
    };

    this.buffer.push(reading);
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER_SIZE);
    }

    for (const callback of this.callbacks) {
      callback(reading);
    }
  }
}

export const sensorManager = new SensorManagerClass();
