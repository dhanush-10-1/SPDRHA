import * as Crypto from 'expo-crypto';

import { SensorReading } from '../sensors/types';
import { saveAnomalyEvent } from '../storage/database';
import { getDeviceIdHash } from '../storage/deviceIdentity';
import { syncService } from '../storage/syncService';
import { TFLiteInferenceEngine } from './tflite_inference';
import { IMUWindow, Prediction } from './types';
import { AnomalyPersistencePolicy } from './anomalyPersistencePolicy';
import { InferenceLifecycle } from './inferenceLifecycle';
import { WindowManager } from './windowManager';

type InferenceEngine = Pick<
  TFLiteInferenceEngine,
  'initialize' | 'predict'
>;

type SaveAnomalyEvent = typeof saveAnomalyEvent;

type InferenceInput = {
  window: IMUWindow;
  reading: SensorReading;
};

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
  private inferenceEngine: InferenceEngine;
  private saveEvent: SaveAnomalyEvent;
  private startSync: () => Promise<void>;
  onAnomalySaved?: (type: 'POTHOLE' | 'SPEED_BREAKER') => void;

  private inferenceLifecycle = new InferenceLifecycle<
    InferenceInput,
    Prediction | null
  >();
  private deviceIdHash: string | null = null;

  private persistencePolicy = new AnomalyPersistencePolicy();

  constructor(
    inferenceEngine: InferenceEngine = new TFLiteInferenceEngine(),
    saveEvent: SaveAnomalyEvent = saveAnomalyEvent,
    startSync: () => Promise<void> = () =>
      syncService.syncPendingEvents(),
    initialDeviceIdHash: string | null = null,
  ) {
    this.inferenceEngine = inferenceEngine;
    this.saveEvent = saveEvent;
    this.startSync = startSync;
    this.deviceIdHash = initialDeviceIdHash;
  }

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

    return this.inferenceLifecycle.submit(
      { window, reading },
      (input, generation) =>
        this.runInference(
          input.window,
          input.reading,
          generation,
        ),
    );
  }

  private async runInference(
    window: IMUWindow,
    reading: SensorReading,
    generation: number,
  ): Promise<Prediction | null> {
    let prediction: Prediction | null = null;

    prediction = await this.inferenceEngine.predict(window);

    if (!this.inferenceLifecycle.isCurrent(generation)) {
      return null;
    }

    if (
      prediction !== null &&
      isAnomalyPrediction(prediction)
    ) {
      if (prediction.confidence < 0.70) {
        console.log(
          `Anomaly ignored: confidence ${prediction.confidence.toFixed(3)} is below the 0.70 threshold.`,
        );
        return prediction;
      }
      const now = Date.now();

      if (
      !this.persistencePolicy.shouldPersist(
        prediction,
        reading.gps !== null,
        now,
      )
      ) {
      console.log(
        reading.gps === null
          ? 'Anomaly ignored: GPS unavailable.'
          : 'Anomaly ignored: cooldown active.',
      );

      return prediction;
      }

      const persisted = await this.savePrediction(
        prediction,
        reading,
        window,
      );

      if (persisted) {
        this.persistencePolicy.markPersisted(now);
      }
    }

    return prediction;
  }

  private async savePrediction(
    prediction: Prediction & {
      type: 'POTHOLE' | 'SPEED_BREAKER';
    },
    reading: SensorReading,
    window: IMUWindow,
  ): Promise<boolean> {
    const gps = reading.gps;

    if (gps === null) {
      console.warn(
        'Anomaly detected but GPS is unavailable. Event was not saved.',
      );
      return false;
    }

    if (this.deviceIdHash === null) {
      throw new Error(
        'Device identity is not initialized.',
      );
    }

    /*
     * Calculate the peak absolute Z-axis acceleration
     * across the complete inference window.
     */
    const rawZPeak = Math.max(
      ...window.map((sample) => Math.abs(sample[2])),
    );

    await this.saveEvent({
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

    // Notify the UI only after SQLite has saved the event.
    try {
      this.onAnomalySaved?.(prediction.type);
    } catch (error) {
      console.warn('Anomaly notification callback failed:', error);
    }

    /*
     * Start synchronization without blocking
     * the sensor/inference loop.
     */
    void this.startSync().catch((error) => {
      console.warn(
        'Anomaly synchronization failed:',
        error,
      );
    });

    return true;
  }

  reset(): void {
    this.inferenceLifecycle.reset();
    this.windowManager.reset();
    this.persistencePolicy.reset();
  }

  get windowSize(): number {
    return this.windowManager.size;
  }
}
