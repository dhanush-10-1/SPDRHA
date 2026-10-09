import { SensorReading } from '../sensors/types';

export const WINDOW_SIZE = 50;
export const FEATURE_COUNT = 6;

export type IMUFeatureVector = [
  number,
  number,
  number,
  number,
  number,
  number,
];

export type IMUWindow = IMUFeatureVector[];

export type PredictionClass =
  | 'NORMAL'
  | 'POTHOLE'
  | 'SPEED_BREAKER';

export type Prediction = {
  type: PredictionClass;
  confidence: number;
};

export function readingToFeatures(
  reading: SensorReading,
): IMUFeatureVector {
  return [
    reading.acc.x,
    reading.acc.y,
    reading.acc.z,
    reading.gyro.x,
    reading.gyro.y,
    reading.gyro.z,
  ];
}