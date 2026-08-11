import * as FileSystem from 'expo-file-system/legacy';
import { sensorManager } from './SensorManager';
import { SensorReading } from './types';

const HEADER = 'timestamp,acc_x,acc_y,acc_z,gyro_x,gyro_y,gyro_z,gps_lat,gps_lng,gps_speed_kmh,gps_accuracy_m,label\n';
const FLUSH_SIZE = 50;

function escapeCsv(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatRow(reading: SensorReading, label: string) {
  const gps = reading.gps;
  return [
    reading.timestamp,
    reading.acc.x,
    reading.acc.y,
    reading.acc.z,
    reading.gyro.x,
    reading.gyro.y,
    reading.gyro.z,
    gps?.lat ?? '',
    gps?.lng ?? '',
    gps?.speedKmh ?? '',
    gps?.accuracyM ?? '',
    escapeCsv(label),
  ].join(',') + '\n';
}

class DataLoggerClass {
  private currentFileUri: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private activeLabel: string | null = null;
  private rowCount = 0;
  private pendingRows: string[] = [];
  private logging = false;

  startLogging(label: string, manager = sensorManager): void {
    if (this.logging) {
      throw new Error('Already recording. Stop the current session first.');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `reading_${label}_${timestamp}.csv`;
    const dir = FileSystem.documentDirectory;
    if (!dir) {
      throw new Error('Document directory is unavailable.');
    }

    void FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    this.currentFileUri = `${dir}${fileName}`;
    void FileSystem.writeAsStringAsync(this.currentFileUri, HEADER);
    this.activeLabel = label;
    this.rowCount = 0;
    this.pendingRows = [];
    this.logging = true;

    this.unsubscribe = manager.onReading((reading) => {
      if (!this.logging || !this.currentFileUri || !this.activeLabel) {
        return;
      }
      this.rowCount += 1;
      this.pendingRows.push(formatRow(reading, this.activeLabel));
      if (this.pendingRows.length >= FLUSH_SIZE) {
        void this.flush();
      }
    });
  }

  async stopLogging(): Promise<string> {
    if (!this.currentFileUri) {
      return '';
    }

    this.logging = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.flush();
    const fileUri = this.currentFileUri ?? '';
    this.currentFileUri = null;
    this.activeLabel = null;
    return fileUri;
  }

  isLogging(): boolean {
    return this.logging;
  }

  getRowCount(): number {
    return this.rowCount;
  }

  private async flush() {
    if (!this.currentFileUri || this.pendingRows.length === 0) {
      return;
    }

    const rows = this.pendingRows.join('');
    this.pendingRows = [];
    if (this.currentFileUri) {
      await FileSystem.writeAsStringAsync(this.currentFileUri, rows, { append: true });
    }
  }
}

export const DataLogger = new DataLoggerClass();
