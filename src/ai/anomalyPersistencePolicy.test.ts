import { AnomalyPersistencePolicy } from './anomalyPersistencePolicy';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export function runAnomalyPersistencePolicyTests(): void {
  const policy = new AnomalyPersistencePolicy(2000);
  const anomaly = {
    type: 'POTHOLE' as const,
    confidence: 0.9,
  };

  assert(
    !policy.shouldPersist(
      { type: 'NORMAL', confidence: 0.9 },
      true,
      3_000,
    ),
    'NORMAL predictions must be suppressed.',
  );
  assert(
    !policy.shouldPersist(anomaly, false, 3_000),
    'Missing GPS must suppress persistence.',
  );
  assert(
    policy.shouldPersist(anomaly, true, 3_000),
    'A valid anomaly should be eligible initially.',
  );

  policy.markPersisted(3_000);
  assert(
    !policy.shouldPersist(anomaly, true, 4_000),
    'The cooldown must protect against duplicate submissions.',
  );
  assert(
    policy.shouldPersist(anomaly, true, 5_000),
    'Anomaly persistence should resume after cooldown.',
  );

  const failedSavePolicy = new AnomalyPersistencePolicy(2_000);
  assert(
    failedSavePolicy.shouldPersist(anomaly, true, 3_000),
    'A failed save remains eligible because cooldown starts only after success.',
  );
  assert(
    failedSavePolicy.shouldPersist(anomaly, true, 4_000),
    'A failed save must not suppress the next valid detection.',
  );
}
