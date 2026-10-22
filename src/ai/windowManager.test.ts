import { SensorReading } from '../sensors/types';
import {
  MAX_INTER_SAMPLE_GAP_MS,
  WINDOW_STRIDE,
  WindowManager,
} from './windowManager';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function reading(timestamp: number): SensorReading {
  return {
    timestamp: 1_700_000_000_000 + timestamp,
    sensorTimestampMs: timestamp,
    acc: { x: 1, y: 2, z: 3 },
    gyro: { x: 4, y: 5, z: 6 },
    gps: null,
  };
}

export function runWindowManagerTests(): void {
  const manager = new WindowManager();

  for (let timestamp = 0; timestamp < 19; timestamp++) {
    assert(
      manager.addReading(reading(timestamp * 33)) === null,
      'A window must not be emitted before 20 valid samples.',
    );
  }

  const firstWindow = manager.addReading(reading(19 * 33));
  assert(firstWindow !== null, 'The first complete window was not emitted.');
  assert(firstWindow?.length === 20, 'Inference windows must contain 20 samples.');
  assert(
    manager.size === WINDOW_STRIDE,
    'A ten-sample stride must leave ten samples of overlap.',
  );

  for (let timestamp = 20; timestamp < 29; timestamp++) {
    manager.addReading(reading(timestamp * 33));
  }
  assert(
    manager.addReading(reading(29 * 33)) !== null,
    'The next overlapping window was not emitted.',
  );
  assert(WINDOW_STRIDE === 10, 'The inference stride changed unexpectedly.');

  manager.reset();
  manager.addReading(reading(0));
  assert(
    manager.addReading(reading(0)) === null && manager.size === 1,
    'Duplicate observations must be rejected.',
  );
  assert(
    manager.addReading(reading(-1)) === null && manager.size === 1,
    'Stale observations must be rejected.',
  );

  for (let timestamp = 1; timestamp < 5; timestamp++) {
    manager.addReading(reading(timestamp * 33));
  }
  assert(
    manager.addReading(reading(4 * 33 + MAX_INTER_SAMPLE_GAP_MS)) === null &&
      manager.size === 6,
    'A 100 ms gap must be accepted at the inclusive boundary.',
  );
  assert(
    manager.addReading(
      reading(4 * 33 + MAX_INTER_SAMPLE_GAP_MS + 101),
    ) === null && manager.size === 0,
    'An excessive timing gap must invalidate the partial window.',
  );
}
