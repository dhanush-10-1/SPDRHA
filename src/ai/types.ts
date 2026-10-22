import { SensorReading } from '../sensors/types';

export const WINDOW_SIZE = 20;
export const FEATURE_COUNT = 8;

export type IMUFeatureVector = [
  number,
  number,
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
  const values = [
    reading.acc.x,
    reading.acc.y,
    reading.acc.z,
    reading.gyro.x,
    reading.gyro.y,
    reading.gyro.z,
    Math.sqrt(
      reading.acc.x ** 2 +
        reading.acc.y ** 2 +
        reading.acc.z ** 2,
    ),
    Math.sqrt(
      reading.gyro.x ** 2 +
        reading.gyro.y ** 2 +
        reading.gyro.z ** 2,
    ),
  ];

  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('Sensor reading contains non-finite values.');
  }

  return values as IMUFeatureVector;
}