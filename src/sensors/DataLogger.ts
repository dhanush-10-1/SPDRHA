import * as FileSystem from 'expo-file-system/legacy';
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
  private rowCount = 0;
  private pendingRows: string[] = [];
  private logging = false;
  private writeQueue: Promise<void> = Promise.resolve();

  startLogging(): void {
    if (this.logging) {
      throw new Error('Already recording. Stop the current session first.');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `reading_${timestamp}.csv`;
    const dir = FileSystem.documentDirectory;
    if (!dir) {
      throw new Error('Document directory is unavailable.');
    }

    const fileUri = `${dir}${fileName}`;
    this.currentFileUri = fileUri;
    this.rowCount = 0;
    this.pendingRows = [];
    this.logging = true;

    this.writeQueue = this.writeQueue
      .then(async () => {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
        await FileSystem.writeAsStringAsync(fileUri, HEADER, { encoding: FileSystem.EncodingType.UTF8 });
      })
      .catch((error) => {
        this.logging = false;
        this.currentFileUri = null;
        this.pendingRows = [];
        throw error;
      });
  }

  appendRow(reading: SensorReading, label: string): void {
    if (!this.logging || !this.currentFileUri) {
      return;
    }

    this.rowCount += 1;
    this.pendingRows.push(formatRow(reading, label));
    if (this.pendingRows.length >= FLUSH_SIZE) {
      void this.flush();
    }
  }

  async stopLogging(): Promise<string> {
    const fileUri = this.currentFileUri;
    if (!fileUri) {
      return '';
    }

    this.logging = false;
    await this.flush();
    this.currentFileUri = null;
    this.pendingRows = [];
    return fileUri;
  }

  isLogging(): boolean {
    return this.logging;
  }

  getRowCount(): number {
    return this.rowCount;
  }

  private async flush(): Promise<void> {
    if (!this.currentFileUri || this.pendingRows.length === 0) {
      return;
    }

    const fileUri = this.currentFileUri;
    const rows = this.pendingRows.slice();
    this.pendingRows = [];

    await this.enqueueWrite(async () => {
      if (!fileUri) {
        throw new Error('No active recording file is available to flush.');
      }
      await FileSystem.writeAsStringAsync(fileUri, rows.join(''), { append: true, encoding: FileSystem.EncodingType.UTF8 });
    });
  }

  private enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const nextWrite = this.writeQueue.then(operation, operation);
    this.writeQueue = nextWrite.then(() => undefined, () => undefined);
    return nextWrite;
  }
}

export const DataLogger = new DataLoggerClass();
