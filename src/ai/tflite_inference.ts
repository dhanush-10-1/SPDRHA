import { loadTensorflowModel } from 'react-native-fast-tflite';

import { normalizeWindow } from './normalization';
import {
  IMUWindow,
  Prediction,
  PredictionClass,
} from './types';

const MODEL = require('../../assets/models/irads_model.tflite');

type ModelClass =
  | 'NORMAL'
  | 'BUMP'
  | 'POTHOLE'
  | 'SPEED_BREAKER';

const CLASS_NAMES: ModelClass[] = [
  'NORMAL',
  'BUMP',
  'POTHOLE',
  'SPEED_BREAKER',
];

export class TFLiteInferenceEngine {
  private model: Awaited<
    ReturnType<typeof loadTensorflowModel>
  > | null = null;

  async initialize(): Promise<void> {
    if (this.model !== null) {
      return;
    }

    this.model = await loadTensorflowModel(MODEL, []);
  }

  async predict(window: IMUWindow): Promise<Prediction | null> {
    if (this.model === null) {
      throw new Error(
        'TFLite model is not initialized. Call initialize() first.',
      );
    }

    if (window.length !== 50) {
      throw new Error(
        `Invalid window size: expected 50, got ${window.length}`,
      );
    }

    const normalized = normalizeWindow(window);

    const input = new Float32Array(
      normalized.flat(),
    );

    const outputs = await this.model.run([
      input.buffer,
    ]);

    const output = outputs[0];

    if (!output) {
      throw new Error('TFLite model returned no output.');
    }

    const scores = Array.from(
      new Float32Array(output),
    );

    if (scores.length !== 4) {
      throw new Error(
        `Invalid model output: expected 4 values, got ${scores.length}`,
      );
    }

    let bestIndex = 0;

    for (let i = 1; i < scores.length; i++) {
      if (scores[i] > scores[bestIndex]) {
        bestIndex = i;
      }
    }

    const modelClass = CLASS_NAMES[bestIndex];

    // The temporary model has BUMP,
    // but BUMP is not part of the final IRADS application.
    if (modelClass === 'BUMP') {
      return null;
    }

    const type: PredictionClass = modelClass;

    return {
      type,
      confidence: scores[bestIndex],
    };
  }
}