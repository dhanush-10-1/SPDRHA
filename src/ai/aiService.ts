import * as Crypto from 'expo-crypto';

import { SensorReading } from '../sensors/types';
import { saveAnomalyEvent } from '../storage/database';
import { getDeviceIdHash } from '../storage/deviceIdentity';
import { syncService } from '../storage/syncService';
import { TFLiteInferenceEngine } from './tflite_inference';
import { IMUWindow, Prediction } from './types';
import { WindowManager } from './windowManager';

function isAnomalyPrediction(
  prediction: Prediction,
): prediction is Prediction & {
  type: 'POTHOLE' | 'SPEED_BREAKER';
} {
  return (
    prediction.type === 'POTHOLE' ||
    prediction.type === 'SPEED_BREAKER'
  );
}

export class AIService {
  private windowManager = new WindowManager();
  private inferenceEngine = new TFLiteInferenceEngine();

  private inferenceRunning = false;
  private deviceIdHash: string | null = null;

  // Prevent multiple anomaly events from being created
  // for the same physical disturbance.
  private lastAnomalyAt = 0;
  private readonly ANOMALY_COOLDOWN_MS = 2000;

  async initialize(): Promise<void> {
    await this.inferenceEngine.initialize();
    this.deviceIdHash = await getDeviceIdHash();
  }

  async processReading(
    reading: SensorReading,
  ): Promise<Prediction | null> {
    const window = this.windowManager.addReading(reading);

    if (window === null) {
      return null;
    }

    if (this.inferenceRunning) {
      return null;
    }

    this.inferenceRunning = true;

    try {
      const prediction =
        await this.inferenceEngine.predict(window);

      if (
        prediction !== null &&
        isAnomalyPrediction(prediction)
      ) {
        const now = Date.now();

        // Ignore anomaly predictions while cooldown is active.
        if (
          now - this.lastAnomalyAt <
          this.ANOMALY_COOLDOWN_MS
        ) {
          console.log(
            'Anomaly ignored: cooldown active.',
          );

          return prediction;
        }

        // Start cooldown before saving the event.
        this.lastAnomalyAt = now;

        await this.savePrediction(
          prediction,
          reading,
          window,
        );
      }

      return prediction;
    } finally {
      this.inferenceRunning = false;
    }
  }

  private async savePrediction(
    prediction: Prediction & {
      type: 'POTHOLE' | 'SPEED_BREAKER';
    },
    reading: SensorReading,
    window: IMUWindow,
  ): Promise<void> {
    if (this.deviceIdHash === null) {
      throw new Error(
        'Device identity is not initialized.',
      );
    }

    const gps = reading.gps;

    if (gps === null) {
      console.warn(
        'Anomaly detected but GPS is unavailable. Event was not saved.',
      );
      return;
    }

    /*
     * Calculate the peak absolute Z-axis acceleration
     * across the complete inference window.
     */
    const rawZPeak = Math.max(
      ...window.map((sample) => Math.abs(sample[2])),
    );

    await saveAnomalyEvent({
      id: Crypto.randomUUID(),

      type: prediction.type,

      confidence: prediction.confidence,

      latitude: gps.lat,

      longitude: gps.lng,

      gpsAccuracyM: gps.accuracyM,

      speedKmh: gps.speedKmh,

      rawZPeak,

      detectedAt: reading.timestamp,

      deviceIdHash: this.deviceIdHash,

      syncStatus: 'PENDING',
    });

    /*
     * Start synchronization without blocking
     * the sensor/inference loop.
     */
    void syncService.syncPendingEvents();
  }

  reset(): void {
    this.windowManager.reset();
    this.inferenceRunning = false;
    this.lastAnomalyAt = 0;
  }

  get windowSize(): number {
    return this.windowManager.size;
  }
}