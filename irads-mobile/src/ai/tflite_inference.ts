import { loadTensorflowModel } from 'react-native-fast-tflite';

import { normalizeWindow } from './normalization';
import {
  FEATURE_COUNT,
  IMUWindow,
  Prediction,
  PredictionClass,
  WINDOW_SIZE,
} from './types';

const MODEL = require('../../assets/models/irads_model.tflite');

const CLASS_NAMES: PredictionClass[] = [
  'NORMAL',
  'POTHOLE',
  'SPEED_BREAKER',
];
const EXPECTED_INPUT_SHAPE = [1, WINDOW_SIZE, FEATURE_COUNT];
const EXPECTED_OUTPUT_SHAPE = [1, CLASS_NAMES.length];

export class TFLiteInferenceEngine {
  private model: Awaited<
    ReturnType<typeof loadTensorflowModel>
  > | null = null;

  async initialize(): Promise<void> {
    if (this.model !== null) {
      return;
    }

    this.model = await loadTensorflowModel(MODEL, []);

    const input = this.model.inputs[0];
    const output = this.model.outputs[0];

    if (
      !input ||
      input.dataType !== 'float32' ||
      input.shape.length !== EXPECTED_INPUT_SHAPE.length ||
      input.shape.some(
        (dimension, index) =>
          dimension !== EXPECTED_INPUT_SHAPE[index],
      )
    ) {
      this.model = null;
      throw new Error(
        `Invalid TFLite input tensor: expected float32 ${EXPECTED_INPUT_SHAPE.join(
          'x',
        )}.`,
      );
    }

    if (
      !output ||
      output.dataType !== 'float32' ||
      output.shape.length !== EXPECTED_OUTPUT_SHAPE.length ||
      output.shape.some(
        (dimension, index) =>
          dimension !== EXPECTED_OUTPUT_SHAPE[index],
      )
    ) {
      this.model = null;
      throw new Error(
        `Invalid TFLite output tensor: expected float32 ${EXPECTED_OUTPUT_SHAPE.join(
          'x',
        )}.`,
      );
    }
  }

  async predict(window: IMUWindow): Promise<Prediction | null> {
    if (this.model === null) {
      throw new Error(
        'TFLite model is not initialized. Call initialize() first.',
      );
    }

    const normalized = normalizeWindow(window);

    const input = new Float32Array(
      normalized.flat(),
    );

    const outputs = await this.model.run([
      input.buffer.slice(
        input.byteOffset,
        input.byteOffset + input.byteLength,
      ),
    ]);

    const output = outputs[0];

    if (!output) {
      throw new Error('TFLite model returned no output.');
    }

    const scores = Array.from(
      new Float32Array(output),
    );

    if (
      scores.length !== CLASS_NAMES.length ||
      scores.some((score) => !Number.isFinite(score))
    ) {
      throw new Error(
        `Invalid model output: expected ${CLASS_NAMES.length} finite values, got ${scores.length}`,
      );
    }

    const total = scores.reduce(
      (sum, score) => sum + score,
      0,
    );

    if (
      total <= 0 ||
      scores.some((score) => score < 0) ||
      Math.abs(total - 1) > 0.01
    ) {
      throw new Error(
        'TFLite model output is not a valid probability distribution.',
      );
    }

    let bestIndex = 0;

    for (let i = 1; i < scores.length; i++) {
      if (scores[i] > scores[bestIndex]) {
        bestIndex = i;
      }
    }

    const modelClass = CLASS_NAMES[bestIndex];

    return {
      type: modelClass,
      confidence: Math.max(
        0,
        Math.min(1, scores[bestIndex]),
      ),
    };
  }
}