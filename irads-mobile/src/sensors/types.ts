export interface GPSReading {
  lat: number;
  lng: number;
  speedKmh: number;
  accuracyM: number;
  timestamp: number;
}

export interface SensorReading {
  /** Unix epoch milliseconds for persistence and backend events. */
  timestamp: number;
  /** Monotonic milliseconds for synchronization and window timing. */
  sensorTimestampMs: number;
  acc: { x: number; y: number; z: number };
  gyro: { x: number; y: number; z: number };
  gps: GPSReading | null;
}
