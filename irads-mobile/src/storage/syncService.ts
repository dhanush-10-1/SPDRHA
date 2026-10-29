import {
  getPendingAnomalyEvents,
  markAnomalyEventSynced,
} from './database';
import type { AnomalyEvent } from './database';
import { API_BASE_URL } from '../config';
import { getDeviceIdHash } from './deviceIdentity';
import { getPilotKey } from './pilotCredentials';

const REQUEST_TIMEOUT_MS = 8000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export class SyncService {
  private syncing = false;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private consecutiveFailures = 0;
  private retryNotBefore = 0;

  async syncPendingEvents(): Promise<void> {
    if (this.syncing) return;

    if (Date.now() < this.retryNotBefore) return;
    this.syncing = true;

    try {
      const events = await getPendingAnomalyEvents();
      if (events.length === 0) {
        this.consecutiveFailures = 0;
        this.retryNotBefore = 0;
        return;
      }

      console.log(`Found ${events.length} pending anomaly event(s).`);

      for (const event of events) {
        try {
          await this.syncEvent(event);
          this.consecutiveFailures = 0;
          this.retryNotBefore = 0;
        } catch (error) {
          console.warn(`Failed to sync event ${event.id}; it remains PENDING:`, error);

          if (error instanceof RateLimitError) {
            this.retryNotBefore = Date.now() + error.retryAfterSeconds * 1000;
            console.warn(`Rate limited. Next sync attempt in ${error.retryAfterSeconds}s.`);
          } else {
            this.consecutiveFailures = Math.min(this.consecutiveFailures + 1, 8);
            const delay = Math.min(
              MAX_RETRY_DELAY_MS,
              2000 * 2 ** (this.consecutiveFailures - 1),
            );
            this.retryNotBefore = Date.now() + delay;
            console.warn(`Offline/server error. Retrying in ${Math.ceil(delay / 1000)}s.`);
          }

          // When the backend is unreachable, stop here instead of firing one
          // failed request for every queued event. All remaining rows stay PENDING.
          break;
        }
      }
    } catch (error) {
      this.consecutiveFailures = Math.min(this.consecutiveFailures + 1, 8);
      const delay = Math.min(
        MAX_RETRY_DELAY_MS,
        2000 * 2 ** (this.consecutiveFailures - 1),
      );
      this.retryNotBefore = Date.now() + delay;
      console.warn(`Could not read the offline event queue. Retrying in ${Math.ceil(delay / 1000)}s:`, error);
    } finally {
      this.syncing = false;
    }
  }

  private async syncEvent(event: AnomalyEvent): Promise<void> {
    console.log(`Attempting to sync event: ${event.id}`);
    const token = await this.getToken();

    const response = await fetchWithTimeout(`${API_BASE_URL}/api/v1/anomalies`, {
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
    });

    const responseText = await response.text();
    console.log('SYNC HTTP STATUS:', response.status);
    console.log('SYNC HTTP RESPONSE:', responseText);

    if (response.status === 429) {
      const retryAfter = Number.parseInt(response.headers.get('Retry-After') ?? '60', 10);
      throw new RateLimitError(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60);
    }

    if (response.status === 401) {
      this.accessToken = null;
      this.tokenExpiresAt = 0;
      throw new Error(`Backend returned 401; cached development token cleared. ${responseText}`);
    }

    if (!response.ok) {
      throw new Error(`Backend rejected event: ${response.status} ${responseText}`);
    }

    // Only mark the event synced after the server has returned a successful HTTP response.
    await markAnomalyEventSynced(event.id);
    console.log(`Synced anomaly event successfully: ${event.id}`);
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken !== null && now < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const [deviceIdHash, pilotKey] = await Promise.all([
      getDeviceIdHash(),
      getPilotKey(),
    ]);
    if (!pilotKey || pilotKey.length < 32) {
      throw new Error('Pilot access key is missing. Enroll this device before syncing.');
    }

    console.log('Requesting pilot JWT...');
    const response = await fetchWithTimeout(`${API_BASE_URL}/api/v1/dev/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pilot-Key': pilotKey,
      },
      body: JSON.stringify({ device_id_hash: deviceIdHash }),
    });
    const responseText = await response.text();

    console.log('TOKEN HTTP STATUS:', response.status);
    // Do not log the token response or the pilot key.
    if (!response.ok) {
      throw new Error(`Failed to obtain pilot auth token (HTTP ${response.status}).`);
    }

    let data: { access_token?: string };
    try {
      data = JSON.parse(responseText) as { access_token?: string };
    } catch {
      throw new Error('Pilot token endpoint returned invalid JSON.');
    }

    if (!data.access_token) {
      throw new Error('Pilot token response did not contain access_token.');
    }

    this.accessToken = data.access_token;
    // Refresh before the token's expected 12-hour expiry.
    this.tokenExpiresAt = Date.now() + 11 * 60 * 60 * 1000;
    console.log('Pilot JWT cached.');
    return this.accessToken;
  }
}

class RateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('Backend rate limit exceeded.');
    this.name = 'RateLimitError';
  }
}

export const syncService = new SyncService();
