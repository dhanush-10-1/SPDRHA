import { SensorReading } from '../sensors/types';
import {
  IMUWindow,
  WINDOW_SIZE,
  readingToFeatures,
} from './types';

const WINDOW_STRIDE = 25;

export class WindowManager {
  private readings: SensorReading[] = [];

  addReading(reading: SensorReading): IMUWindow | null {
    this.readings.push(reading);

    if (this.readings.length < WINDOW_SIZE) {
      return null;
    }

    const window = this.readings
      .slice(0, WINDOW_SIZE)
      .map(readingToFeatures);

    this.readings.splice(0, WINDOW_STRIDE);

    return window;
  }

  reset(): void {
    this.readings = [];
  }

  get size(): number {
    return this.readings.length;
  }
}