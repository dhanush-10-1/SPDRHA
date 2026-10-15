import { Accelerometer, Gyroscope } from "expo-sensors";

export const MINIMUM_SPEED_KMH = 5;
export const SENSOR_WINDOW_SIZE = 50;
export const MAX_GPS_ACCURACY_METERS = 20;

export type SensorSample = {
  timestamp: number;
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
};

export type SpeedGateResult = {
  allowed: boolean;
  reason: string;
  speedKmh: number | null;
};

/**
 * Evaluates whether the vehicle's speed permits classification.
 *
 * GPS speed is supplied in metres per second.
 * Missing or invalid speed is rejected.
 */
export function checkSpeedGate(
  speedMetersPerSecond: number | null | undefined,
): SpeedGateResult {
  if (
    speedMetersPerSecond == null ||
    !Number.isFinite(speedMetersPerSecond) ||
    speedMetersPerSecond < 0
  ) {
    return {
      allowed: false,
      reason: "GPS speed unavailable or invalid",
      speedKmh: null,
    };
  }

  const speedKmh = speedMetersPerSecond * 3.6;

  if (speedKmh < MINIMUM_SPEED_KMH) {
    return {
      allowed: false,
      reason: `Vehicle speed ${speedKmh.toFixed(1)} km/h is below 5 km/h`,
      speedKmh,
    };
  }

  return {
    allowed: true,
    reason: `Speed gate passed at ${speedKmh.toFixed(1)} km/h`,
    speedKmh,
  };
}

/**
 * Starts native accelerometer and gyroscope collection.
 *
 * Each callback produces an accelerometer sample paired with
 * the most recently received gyroscope reading.
 *
 * This is a prototype collector; timestamps are not synchronized.
 */
export function startRoadSensorCollection(
  onSample: (sample: SensorSample) => void,
): () => void {
  Accelerometer.setUpdateInterval(20);
  Gyroscope.setUpdateInterval(20);

  let latestRotation = { x: 0, y: 0, z: 0 };

  const gyroscopeSubscription = Gyroscope.addListener((data) => {
    latestRotation = data;
  });

  const accelerationSubscription = Accelerometer.addListener((data) => {
    onSample({
      timestamp: Date.now(),
      ax: data.x,
      ay: data.y,
      az: data.z,
      gx: latestRotation.x,
      gy: latestRotation.y,
      gz: latestRotation.z,
    });
  });

  return () => {
    accelerationSubscription.remove();
    gyroscopeSubscription.remove();
  };
}