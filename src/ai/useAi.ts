import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { SensorReading } from '../sensors/types';
import { AIService } from './aiService';
import { Prediction } from './types';

export function useAI() {
  const serviceRef = useRef<AIService | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);

  useEffect(() => {
    const service = new AIService();
    serviceRef.current = service;

    let cancelled = false;

    const initialize = async () => {
      try {
        await service.initialize();

        if (!cancelled) {
          setReady(true);
        }
      } catch (err) {
        console.error('AI initialization failed:', err);

        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to initialize AI model.',
          );
        }
      }
    };

    initialize();

    return () => {
      cancelled = true;
      service.reset();
      serviceRef.current = null;
    };
  }, []);

    const processReading = useCallback(
    async (reading: SensorReading) => {
    const service = serviceRef.current;

    if (!service || !ready) {
      return;
    }

    try {
      const result = await service.processReading(reading);

      if (result !== null) {
        setPrediction(result);
      }
    } catch (err) {
      console.error('AI inference failed:', err);

      setError(
        err instanceof Error
          ? err.message
          : 'AI inference failed.',
      );
    }
    },
  [ready],
);
  return {
    ready,
    error,
    prediction,
    processReading,
  };
}
