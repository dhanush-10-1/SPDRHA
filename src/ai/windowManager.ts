import { SensorReading } from '../sensors/types';
import {
  IMUWindow,
  WINDOW_SIZE,
  readingToFeatures,
} from './types';

export const WINDOW_STRIDE = 10;
export const MAX_INTER_SAMPLE_GAP_MS = 100;

function hasFiniteSensorValues(reading: SensorReading): boolean {
  return [
    reading.acc.x,
    reading.acc.y,
    reading.acc.z,
    reading.gyro.x,
    reading.gyro.y,
    reading.gyro.z,
  ].every(Number.isFinite);
}

export class WindowManager {
  private readings: SensorReading[] = [];

  addReading(reading: SensorReading): IMUWindow | null {
    if (
      !Number.isFinite(reading.sensorTimestampMs) ||
      !hasFiniteSensorValues(reading)
    ) {
      this.readings = [];
      return null;
    }

    const previous = this.readings[this.readings.length - 1];

    if (
      (previous !== undefined &&
        (reading.sensorTimestampMs <= previous.sensorTimestampMs ||
          reading.sensorTimestampMs -
            previous.sensorTimestampMs >
            MAX_INTER_SAMPLE_GAP_MS))
    ) {
      if (
        previous !== undefined &&
        reading.sensorTimestampMs -
          previous.sensorTimestampMs >
          MAX_INTER_SAMPLE_GAP_MS
      ) {
        this.readings = [];
      }
      return null;
    }

    this.readings.push(reading);

    if (this.readings.length < WINDOW_SIZE) {
      return null;
    }

    const window = this.readings
      .slice(0, WINDOW_SIZE)
      .map(readingToFeatures);

    // Ten-sample stride gives 50% overlap: a new 20-sample window is
    // evaluated about every 333 ms at the training recording rate (~30 Hz).
    this.readings.splice(0, Math.min(WINDOW_STRIDE, this.readings.length));

    return window;
  }

  reset(): void {
    this.readings = [];
  }

  get size(): number {
    return this.readings.length;
  }
}