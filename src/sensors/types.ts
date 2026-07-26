export interface GPSReading {
  lat: number;
  lng: number;
  speedKmh: number;
  accuracyM: number;
  timestamp: number;
}

export interface SensorReading {
  timestamp: number;
  acc: { x: number; y: number; z: number };
  gyro: { x: number; y: number; z: number };
  gps: GPSReading | null;
}
