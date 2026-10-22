import { Prediction } from './types';

export class AnomalyPersistencePolicy {
  private lastPersistedAt = 0;

  constructor(
    private readonly cooldownMs = 2000,
  ) {}

  shouldPersist(
    prediction: Prediction | null,
    gpsAvailable: boolean,
    now: number,
  ): boolean {
    if (
      prediction === null ||
      (prediction.type !== 'POTHOLE' &&
        prediction.type !== 'SPEED_BREAKER') ||
      !gpsAvailable
    ) {
      return false;
    }

    return now - this.lastPersistedAt >= this.cooldownMs;
  }

  markPersisted(now: number): void {
    this.lastPersistedAt = now;
  }

  reset(): void {
    this.lastPersistedAt = 0;
  }
}
