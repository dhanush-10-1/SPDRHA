import {
  getPendingAnomalyEvents,
  markAnomalyEventSynced,
} from './database';

const API_BASE_URL = 'http://10.216.109.50:8001';

export class SyncService {
  private syncing = false;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  async syncPendingEvents(): Promise<void> {
    if (this.syncing) {
      console.log('Sync already in progress.');
      return;
    }

    this.syncing = true;

    try {
      const events = await getPendingAnomalyEvents();

      console.log(
        `Found ${events.length} pending anomaly event(s).`,
      );

      if (events.length === 0) {
        return;
      }

      for (const event of events) {
        try {
          await this.syncEvent(event);
        } catch (error) {
          console.warn(
            `Failed to sync event ${event.id}:`,
            error,
          );

          /*
           * If the backend rate-limits us, stop processing
           * the remaining events immediately.
           *
           * They remain PENDING and will be retried later.
           */
          if (error instanceof RateLimitError) {
            console.warn(
              `Rate limited. Retry after ${error.retryAfterSeconds}s.`,
            );

            break;
          }

          /*
           * Other errors also leave the event PENDING,
           * but we continue to the next event.
           */
        }
      }
    } finally {
      this.syncing = false;
    }
  }

  private async syncEvent(event: {
    id: string;
    type: 'POTHOLE' | 'SPEED_BREAKER';
    confidence: number;
    latitude: number;
    longitude: number;
    gpsAccuracyM: number;
    speedKmh: number;
    rawZPeak: number;
    detectedAt: number;
    deviceIdHash: string;
  }): Promise<void> {
    console.log(
      `Attempting to sync event: ${event.id}`,
    );

    const token = await this.getToken();

    const response = await fetch(
      `${API_BASE_URL}/api/v1/anomalies`,
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },

        body: JSON.stringify({
          id: event.id,
          type: event.type,
          confidence: event.confidence,
          latitude: event.latitude,
          longitude: event.longitude,
          gps_accuracy_m: event.gpsAccuracyM,
          speed_kmh: event.speedKmh,
          raw_z_peak: event.rawZPeak,
          device_id_hash: event.deviceIdHash,
          detected_at_ms: event.detectedAt,
        }),
      },
    );

    const responseText = await response.text();

    console.log(
      'SYNC HTTP STATUS:',
      response.status,
    );

    console.log(
      'SYNC HTTP RESPONSE:',
      responseText,
    );

    /*
     * Handle rate limiting explicitly.
     */
    if (response.status === 429) {
      const retryAfterHeader =
        response.headers.get('Retry-After');

      const retryAfterSeconds =
        retryAfterHeader !== null
          ? Number.parseInt(retryAfterHeader, 10)
          : 60;

      throw new RateLimitError(
        Number.isFinite(retryAfterSeconds)
          ? retryAfterSeconds
          : 60,
      );
    }

    if (!response.ok) {
      throw new Error(
        `Backend rejected event: ${response.status} ${responseText}`,
      );
    }

    await markAnomalyEventSynced(event.id);

    console.log(
      `Synced anomaly event successfully: ${event.id}`,
    );
  }

  private async getToken(): Promise<string> {
    const now = Date.now();

    if (
      this.accessToken !== null &&
      now < this.tokenExpiresAt
    ) {
      console.log(
        'Reusing cached development JWT.',
      );

      return this.accessToken;
    }

    console.log(
      'Requesting development JWT...',
    );

    const response = await fetch(
      `${API_BASE_URL}/api/v1/dev/token`,
      {
        method: 'POST',
      },
    );

    const responseText = await response.text();

    console.log(
      'TOKEN HTTP STATUS:',
      response.status,
    );

    console.log(
      'TOKEN HTTP RESPONSE:',
      responseText,
    );

    if (!response.ok) {
      throw new Error(
        `Failed to obtain auth token: ${response.status} ${responseText}`,
      );
    }

    const data = JSON.parse(responseText);

    if (!data.access_token) {
      throw new Error(
        'Development token response did not contain access_token.',
      );
    }

    const token: string = data.access_token;

    this.accessToken = token;

    this.tokenExpiresAt =
      now + 11 * 60 * 60 * 1000;

    console.log(
      'Development JWT cached.',
    );

    return token;
  }
}

/**
 * Represents an HTTP 429 response from the backend.
 */
class RateLimitError extends Error {
  constructor(
    public readonly retryAfterSeconds: number,
  ) {
    super('Backend rate limit exceeded.');
    this.name = 'RateLimitError';
  }
}

export const syncService = new SyncService();