import type { SensorReading } from "../sensors/types";
import type { Prediction } from "./types";

export class AIService {
  async initialize(): Promise<void> {
    // The App checks Platform.OS before attempting inference.
  }

  async processReading(_reading: SensorReading): Promise<Prediction | null> {
    return null;
  }

  reset(): void {}

  get windowSize(): number {
    return 0;
  }
}
