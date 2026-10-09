import { IMUWindow } from './types';

const MEAN = [
  -0.019452420994639397,
  0.2897146940231323,
  0.8551404476165771,
  0.000534393941052258,
  0.003778090002015233,
  0.003882150398567319,
];

const STD = [
  0.1723574995994568,
  0.4057551622390747,
  0.41313475370407104,
  2.6464433670043945,
  1.117576241493225,
  1.0240119695663452,
];

export function normalizeWindow(window: IMUWindow): IMUWindow {
  return window.map((sample) =>
    sample.map((value, featureIndex) =>
      (value - MEAN[featureIndex]) / STD[featureIndex],
    ) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ],
  );
}