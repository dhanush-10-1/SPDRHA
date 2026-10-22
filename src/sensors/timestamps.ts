export type SensorTimestampSource = 'native' | 'fallback';

export type ResolvedSensorTimestamp = {
  monotonicMs: number;
  epochMs: number;
  source: SensorTimestampSource;
};

/**
 * Expo sensor timestamps are documented as seconds on a monotonic sensor
 * clock. The rest of the mobile pipeline uses milliseconds internally.
 */
export function nativeSensorTimestampToMs(
  timestampSeconds: number | undefined,
): number | null {
  if (
    timestampSeconds === undefined ||
    !Number.isFinite(timestampSeconds) ||
    timestampSeconds < 0
  ) {
    return null;
  }

  const timestampMs = timestampSeconds * 1000;
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

export function monotonicToEpochMs(
  monotonicMs: number,
  monotonicReferenceMs: number,
  epochReferenceMs: number,
): number | null {
  const epochMs =
    epochReferenceMs + (monotonicMs - monotonicReferenceMs);

  return Number.isFinite(epochMs) ? epochMs : null;
}

export function isWithinSyncTolerance(
  firstMonotonicMs: number,
  secondMonotonicMs: number,
  toleranceMs: number,
): boolean {
  return (
    Number.isFinite(firstMonotonicMs) &&
    Number.isFinite(secondMonotonicMs) &&
    Math.abs(firstMonotonicMs - secondMonotonicMs) <= toleranceMs
  );
}

export function canSynchronizeSources(
  first: SensorTimestampSource,
  second: SensorTimestampSource,
): boolean {
  return first === second;
}

export function resolveSensorTimestamp(
  timestampSeconds: number | undefined,
  fallbackMonotonicMs: number | null,
  monotonicReferenceMs: number,
  epochReferenceMs: number,
): ResolvedSensorTimestamp | null {
  const nativeTimestampMs =
    nativeSensorTimestampToMs(timestampSeconds);
  const source: SensorTimestampSource =
    nativeTimestampMs === null ? 'fallback' : 'native';
  const monotonicMs = nativeTimestampMs ?? fallbackMonotonicMs;

  if (monotonicMs === null) {
    return null;
  }

  const epochMs = monotonicToEpochMs(
    monotonicMs,
    monotonicReferenceMs,
    epochReferenceMs,
  );

  if (epochMs === null) {
    return null;
  }

  return {
    monotonicMs,
    epochMs,
    source,
  };
}
