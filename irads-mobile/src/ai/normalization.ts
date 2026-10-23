import { IMUWindow } from './types';

type NormalizationData = {
  features: string[];
  mean: number[];
  std: number[];
};

const NORMALIZATION =
  require('../../assets/models/normalization.json') as NormalizationData;

const EXPECTED_FEATURES = [
  'acc_x',
  'acc_y',
  'acc_z',
  'gyro_x',
  'gyro_y',
  'gyro_z',
  'acc_mag',
  'gyro_mag',
];

if (
  JSON.stringify(NORMALIZATION.features) !==
  JSON.stringify(EXPECTED_FEATURES)
) {
  throw new Error(
    'Normalization feature order does not match the model contract.',
  );
}

if (
  NORMALIZATION.mean.length !== EXPECTED_FEATURES.length ||
  NORMALIZATION.std.length !== EXPECTED_FEATURES.length ||
  NORMALIZATION.std.some(
    (value) => !Number.isFinite(value) || value <= 0,
  ) ||
  NORMALIZATION.mean.some(
    (value) => !Number.isFinite(value),
  )
) {
  throw new Error(
    'Normalization parameters do not match the model contract.',
  );
}

export function normalizeWindow(window: IMUWindow): IMUWindow {
  if (window.length !== 20) {
    throw new Error(
      `Invalid window size: expected 20, got ${window.length}`,
    );
  }

  return window.map((sample) =>
    sample.map(
      (value, featureIndex) =>
        (value - NORMALIZATION.mean[featureIndex]) /
        NORMALIZATION.std[featureIndex],
    ) as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ],
  );
}
