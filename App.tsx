import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { sensorManager } from './src/sensors/SensorManager';
import { SensorReading } from './src/sensors/types';
import { useAI } from './src/ai/useAi';
import { clearPendingAnomalyEvents } from './src/storage/database';

export default function App() {
  const {
    ready: aiReady,
    error: aiError,
    prediction,
    processReading,
  } = useAI();

  const [sensorReady, setSensorReady] = useState(false);
  const [sensorError, setSensorError] = useState<string | null>(null);
  const [speed, setSpeed] = useState(0);

  // DEVELOPMENT ONLY:
  // Clear the old pending SQLite anomaly events once.
  useEffect(() => {
    clearPendingAnomalyEvents();
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const startSensors = async () => {
      try {
        await sensorManager.start();

        unsubscribe = sensorManager.onReading(
          (reading: SensorReading) => {
            setSpeed(reading.gps?.speedKmh ?? 0);

            void processReading(reading);
          },
        );

        setSensorReady(true);
      } catch (error) {
        console.error('Sensor initialization failed:', error);

        setSensorError(
          error instanceof Error
            ? error.message
            : 'Failed to initialize sensors.',
        );
      }
    };

    startSensors();

    return () => {
      unsubscribe?.();
      sensorManager.stop();
    };
  }, [processReading]);

  const isReady = sensorReady && aiReady;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.logo}>IRADS</Text>

        <Text style={styles.subtitle}>
          Intelligent Road Anomaly Detection
        </Text>
      </View>

      <View style={styles.statusCard}>
        <View
          style={[
            styles.statusDot,
            isReady && styles.statusDotActive,
          ]}
        />

        <View>
          <Text style={styles.statusTitle}>
            {isReady ? 'Monitoring' : 'Initializing'}
          </Text>

          <Text style={styles.statusText}>
            {isReady
              ? 'Road anomaly detection is active'
              : 'Starting sensors and AI...'}
          </Text>
        </View>
      </View>

      <View style={styles.speedCard}>
        <Text style={styles.cardLabel}>
          CURRENT SPEED
        </Text>

        <Text style={styles.speed}>
          {speed.toFixed(1)}
        </Text>

        <Text style={styles.unit}>
          km/h
        </Text>
      </View>

      <View style={styles.predictionCard}>
        <Text style={styles.cardLabel}>
          AI DETECTION
        </Text>

        {!aiReady && !aiError ? (
          <View style={styles.loading}>
            <ActivityIndicator />

            <Text style={styles.loadingText}>
              Loading AI model...
            </Text>
          </View>
        ) : aiError ? (
          <Text style={styles.errorText}>
            AI error: {aiError}
          </Text>
        ) : prediction ? (
          <>
            <Text style={styles.prediction}>
              {prediction.type.replace('_', ' ')}
            </Text>

            <Text style={styles.confidence}>
              {(prediction.confidence * 100).toFixed(1)}%
              {' '}confidence
            </Text>
          </>
        ) : (
          <Text style={styles.normal}>
            No anomaly detected
          </Text>
        )}
      </View>

      {sensorError && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>
            Sensor error: {sensorError}
          </Text>
        </View>
      )}

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>
          How IRADS works
        </Text>

        <Text style={styles.infoText}>
          Your phone continuously analyzes accelerometer
          and gyroscope data to detect road anomalies.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F14',
    padding: 20,
  },

  header: {
    marginTop: 20,
    marginBottom: 24,
  },

  logo: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
  },

  subtitle: {
    color: '#8D98A7',
    fontSize: 14,
    marginTop: 4,
  },

  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#151B23',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
  },

  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#555',
    marginRight: 14,
  },

  statusDotActive: {
    backgroundColor: '#35D07F',
  },

  statusTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },

  statusText: {
    color: '#8D98A7',
    fontSize: 13,
    marginTop: 3,
  },

  speedCard: {
    alignItems: 'center',
    backgroundColor: '#151B23',
    borderRadius: 20,
    padding: 24,
    marginBottom: 16,
  },

  cardLabel: {
    color: '#8D98A7',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },

  speed: {
    color: '#FFFFFF',
    fontSize: 64,
    fontWeight: '800',
    marginTop: 4,
  },

  unit: {
    color: '#8D98A7',
    fontSize: 14,
  },

  predictionCard: {
    backgroundColor: '#151B23',
    borderRadius: 20,
    padding: 22,
    marginBottom: 16,
    minHeight: 150,
  },

  prediction: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    marginTop: 18,
  },

  confidence: {
    color: '#8D98A7',
    fontSize: 14,
    marginTop: 6,
  },

  normal: {
    color: '#35D07F',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 20,
  },

  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
  },

  loadingText: {
    color: '#8D98A7',
    marginLeft: 10,
  },

  errorCard: {
    backgroundColor: '#291719',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },

  errorText: {
    color: '#FF7B7B',
    fontSize: 13,
  },

  infoCard: {
    backgroundColor: '#151B23',
    borderRadius: 16,
    padding: 18,
    marginTop: 'auto',
  },

  infoTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },

  infoText: {
    color: '#8D98A7',
    fontSize: 13,
    lineHeight: 19,
  },
});