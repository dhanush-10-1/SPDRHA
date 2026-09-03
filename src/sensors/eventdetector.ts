import { SensorReading } from './types';

export type CandidateEvent = {
  timestamp: number;
  peakZ: number;

  lat: number | null;
  lng: number | null;

  speedKmh: number | null;
};

const MIN_SPEED_KMH = 5;

/*
 * TEMPORARY threshold.
 *
 * This is NOT the final ML labeling threshold.
 * It is only used to identify potentially interesting
 * events that deserve later inspection.
 */
const CANDIDATE_Z_THRESHOLD = 2.0;

export function detectCandidate(
  reading: SensorReading,
): CandidateEvent | null {
  const speed =
    reading.gps?.speedKmh ?? 0;

  /*
   * Ignore stationary / very slow movement.
   */
  if (speed < MIN_SPEED_KMH) {
    return null;
  }

  const verticalAcceleration =
    Math.abs(reading.acc.z);

  /*
   * Detect a potentially interesting vertical
   * acceleration event.
   */
  if (
    verticalAcceleration <
    CANDIDATE_Z_THRESHOLD
  ) {
    return null;
  }

  return {
    timestamp: reading.timestamp,

    peakZ: reading.acc.z,

    lat: reading.gps?.lat ?? null,

    lng: reading.gps?.lng ?? null,

    speedKmh:
      reading.gps?.speedKmh ?? null,
  };
}