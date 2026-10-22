import {
  canSynchronizeSources,
  isWithinSyncTolerance,
  nativeSensorTimestampToMs,
  resolveSensorTimestamp,
} from './timestamps';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export function runTimestampTests(): void {
  assert(
    nativeSensorTimestampToMs(12.345) === 12345,
    'Native sensor seconds must be converted to milliseconds.',
  );

  assert(
    isWithinSyncTolerance(1_000, 1_035, 50),
    'A 35 ms sensor difference must be accepted.',
  );
  assert(
    !isWithinSyncTolerance(1_000, 1_060, 50),
    'A 60 ms sensor difference must be rejected.',
  );

  const native = resolveSensorTimestamp(
    12.345,
    null,
    12_000,
    1_700_000_000_000,
  );
  assert(
    native?.monotonicMs === 12_345 &&
      native.epochMs === 1_700_000_000_345 &&
      native.source === 'native',
    'Native timestamps must retain monotonic and epoch representations.',
  );

  const fallback = resolveSensorTimestamp(
    undefined,
    5_500,
    5_000,
    1_700_000_000_000,
  );
  assert(
    fallback?.monotonicMs === 5_500 &&
      fallback.epochMs === 1_700_000_000_500 &&
      fallback.source === 'fallback',
    'Fallback timestamps must use the supplied monotonic clock.',
  );
  assert(
    resolveSensorTimestamp(
      undefined,
      null,
      5_000,
      1_700_000_000_000,
    ) === null,
    'Missing native and fallback timestamps must be discarded.',
  );
  assert(
    !canSynchronizeSources('native', 'fallback'),
    'Native and fallback clock domains must not be mixed.',
  );

  assert(
    native?.epochMs === 1_700_000_000_345,
    'Persisted event timestamps must remain epoch milliseconds.',
  );
}
