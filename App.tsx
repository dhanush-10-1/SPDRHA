import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system';
import * as Location from 'expo-location';
import * as Sharing from 'expo-sharing';
import { DataLogger } from './src/sensors/DataLogger';
import { GPSReading, SensorReading } from './src/sensors/types';
import { sensorManager } from './src/sensors/SensorManager';
import { Accelerometer, Gyroscope } from 'expo-sensors';

const LABELS = ['NORMAL', 'POTHOLE', 'SPEED_BREAKER', 'BUMP'] as const;
type Label = (typeof LABELS)[number];

type PermissionState = {
  sensors: 'pending' | 'granted' | 'denied';
  location: 'pending' | 'granted' | 'denied';
};

type FileItem = {
  name: string;
  uri: string;
  size: number;
};

const emptyReading = (): SensorReading => ({
  timestamp: Date.now(),
  acc: { x: 0, y: 0, z: 0 },
  gyro: { x: 0, y: 0, z: 0 },
  gps: null,
});

function formatGps(gps: GPSReading | null) {
  if (!gps) {
    return 'No GPS';
  }
  return `${gps.speedKmh.toFixed(1)} km/h • ${gps.accuracyM.toFixed(0)} m`;
}

async function shareFile(uri: string) {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    Alert.alert('Sharing unavailable', 'This device cannot open the share sheet.');
    return;
  }
  await Sharing.shareAsync(uri, { mimeType: 'text/csv' });
}

export default function App() {
  const [latestReading, setLatestReading] = useState<SensorReading>(emptyReading());
  const [permissionState, setPermissionState] = useState<PermissionState>({
    sensors: 'pending',
    location: 'pending',
  });
  const [selectedLabel, setSelectedLabel] = useState<Label | null>(null);
  const [recording, setRecording] = useState(false);
  const [rowCount, setRowCount] = useState(0);
  const [savedFileUri, setSavedFileUri] = useState<string | null>(null);
  const [recordedFiles, setRecordedFiles] = useState<FileItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Select a label before recording.');

  const permissionLabel = useMemo(() => {
    const sensors = permissionState.sensors === 'granted' ? 'Granted' : permissionState.sensors === 'denied' ? 'Denied' : 'Checking';
    const location = permissionState.location === 'granted' ? 'Granted' : permissionState.location === 'denied' ? 'Denied' : 'Checking';
    return { sensors, location };
  }, [permissionState]);

  async function refreshFiles() {
    const directory = FileSystem.Paths.document;
    const snapshot = await directory.info();
    if (!snapshot.exists || !snapshot.files) {
      setRecordedFiles([]);
      return;
    }

    const items = snapshot.files
      .filter((name) => name.startsWith('reading_') && name.endsWith('.csv'))
      .map((name) => {
        const file = new FileSystem.File(directory, name);
        const info = file.info();
        return {
          name,
          uri: file.uri,
          size: info.size ?? 0,
        };
      })
      .sort((left, right) => right.name.localeCompare(left.name));

    setRecordedFiles(items);
  }

  async function initializePermissions() {
    setBusy(true);
    try {
      const [accelerometerAvailable, gyroscopeAvailable, locationPermission] = await Promise.all([
        Accelerometer.isAvailableAsync(),
        Gyroscope.isAvailableAsync(),
        Location.requestForegroundPermissionsAsync(),
      ]);
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      const sensorsGranted = accelerometerAvailable && gyroscopeAvailable;
      const locationGranted = locationPermission.granted && servicesEnabled;
      let backgroundGranted = false;
      // Request background permission where applicable. Note: background permission
      // requires a standalone/custom dev build on native platforms to be effective.
      if (Platform.OS === 'android' || Platform.OS === 'ios') {
        try {
          const bg = await Location.requestBackgroundPermissionsAsync();
          backgroundGranted = bg.granted === true;
        } catch (e) {
          backgroundGranted = false;
        }
      }
      setPermissionState({
        sensors: sensorsGranted ? 'granted' : 'denied',
        location: locationGranted ? 'granted' : 'denied',
      });
      if (!sensorsGranted || !locationGranted) {
        setMessage('Permissions denied. Retry to enable sensors and GPS.');
        sensorManager.stop();
      } else {
        await sensorManager.start();
        if (!backgroundGranted) {
          setMessage('Ready to record (foreground). Background location not granted — background logging may not work.');
        } else {
          setMessage('Ready to record. Background location granted.');
        }
      }
    } catch (error) {
      setPermissionState({ sensors: 'denied', location: 'denied' });
      setMessage(error instanceof Error ? error.message : 'Failed to initialize sensors.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const unsubscribe = sensorManager.onReading((reading) => {
      setLatestReading(reading);
    });
    void initializePermissions();
    void refreshFiles();
    return () => {
      unsubscribe();
      sensorManager.stop();
    };
  }, []);

  useEffect(() => {
    if (!recording) {
      return;
    }
    setRowCount(DataLogger.getRowCount());
    const interval = setInterval(() => {
      setRowCount(DataLogger.getRowCount());
    }, 200);
    return () => clearInterval(interval);
  }, [recording]);

  async function handleStart() {
    if (!selectedLabel) {
      return;
    }
    try {
      setBusy(true);
      await DataLogger.startLogging(selectedLabel, sensorManager);
      setRowCount(0);
      setSavedFileUri(null);
      setRecording(true);
      setMessage(`Recording ${selectedLabel}.`);
    } catch (error) {
      Alert.alert('Could not start recording', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    try {
      setBusy(true);
      const fileUri = await DataLogger.stopLogging();
      setRecording(false);
      setRowCount(DataLogger.getRowCount());
      setSavedFileUri(fileUri);
      setMessage(`Saved ${DataLogger.getRowCount()} rows.`);
      await refreshFiles();
    } catch (error) {
      Alert.alert('Could not stop recording', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  async function handleRetry() {
    sensorManager.stop();
    await initializePermissions();
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Road Anomaly Recorder</Text>
          <Text style={styles.subtitle}>Sensor capture only. No ML. No backend.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Permissions</Text>
          <View style={styles.permissionRow}>
            <Text style={styles.permissionLabel}>Sensors</Text>
            <Text style={permissionState.sensors === 'granted' ? styles.good : styles.bad}>{permissionLabel.sensors}</Text>
          </View>
          <View style={styles.permissionRow}>
            <Text style={styles.permissionLabel}>GPS</Text>
            <Text style={permissionState.location === 'granted' ? styles.good : styles.bad}>{permissionLabel.location}</Text>
          </View>
          {permissionState.sensors !== 'granted' || permissionState.location !== 'granted' ? (
            <Pressable style={styles.secondaryButton} onPress={handleRetry} disabled={busy}>
              <Text style={styles.secondaryButtonText}>Retry permissions</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Live Readout</Text>
          <Text style={styles.metric}>Acc X {latestReading.acc.x.toFixed(2)}  Y {latestReading.acc.y.toFixed(2)}  Z {latestReading.acc.z.toFixed(2)}</Text>
          <Text style={styles.metric}>Gyro X {latestReading.gyro.x.toFixed(2)}  Y {latestReading.gyro.y.toFixed(2)}  Z {latestReading.gyro.z.toFixed(2)}</Text>
          <Text style={styles.metric}>GPS {formatGps(latestReading.gps)}</Text>
          {recording ? (
            <View style={styles.recordingRow}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>RECORDING</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Label</Text>
          <View style={styles.labelGrid}>
            {LABELS.map((label) => {
              const active = selectedLabel === label;
              return (
                <Pressable key={label} onPress={() => setSelectedLabel(label)} style={[styles.labelButton, active && styles.labelButtonActive]}>
                  <Text style={[styles.labelButtonText, active && styles.labelButtonTextActive]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recording</Text>
          <Text style={styles.metric}>Rows logged: {rowCount}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actionRow}>
            {!recording ? (
              <Pressable
                style={[styles.primaryButton, (!selectedLabel || busy) && styles.buttonDisabled]}
                disabled={!selectedLabel || busy}
                onPress={handleStart}
              >
                <Text style={styles.primaryButtonText}>Start Recording</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.stopButton} disabled={busy} onPress={handleStop}>
                <Text style={styles.primaryButtonText}>Stop Recording</Text>
              </Pressable>
            )}
            {busy ? <ActivityIndicator color="#111827" /> : null}
          </View>
          {savedFileUri ? (
            <Pressable style={styles.shareButton} onPress={() => shareFile(savedFileUri)}>
              <Text style={styles.shareButtonText}>Share last CSV</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recorded Files</Text>
          {recordedFiles.length === 0 ? <Text style={styles.message}>No CSV files yet.</Text> : null}
          {recordedFiles.map((file) => (
            <View key={file.uri} style={styles.fileRow}>
              <View style={styles.fileInfo}>
                <Text style={styles.fileName}>{file.name}</Text>
                <Text style={styles.fileMeta}>{Math.max(1, Math.round(file.size / 1024))} KB</Text>
              </View>
              <Pressable style={styles.smallShareButton} onPress={() => shareFile(file.uri)}>
                <Text style={styles.smallShareButtonText}>Share</Text>
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  container: {
    padding: 16,
    gap: 16,
  },
  header: {
    paddingTop: 8,
    paddingBottom: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    marginTop: 4,
    color: '#475569',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  permissionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  permissionLabel: {
    color: '#334155',
    fontSize: 15,
  },
  good: {
    color: '#047857',
    fontWeight: '700',
  },
  bad: {
    color: '#b91c1c',
    fontWeight: '700',
  },
  metric: {
    color: '#0f172a',
    fontSize: 15,
    lineHeight: 22,
  },
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#dc2626',
  },
  recordingText: {
    color: '#dc2626',
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  labelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  labelButton: {
    minWidth: '47%',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
  },
  labelButtonActive: {
    backgroundColor: '#0f172a',
  },
  labelButtonText: {
    fontWeight: '700',
    color: '#0f172a',
  },
  labelButtonTextActive: {
    color: '#ffffff',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  primaryButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 14,
  },
  stopButton: {
    backgroundColor: '#dc2626',
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 14,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '800',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  shareButton: {
    backgroundColor: '#111827',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  shareButtonText: {
    color: '#ffffff',
    fontWeight: '800',
  },
  message: {
    color: '#475569',
  },
  fileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 12,
    marginTop: 4,
  },
  fileInfo: {
    flex: 1,
    paddingRight: 12,
  },
  fileName: {
    color: '#0f172a',
    fontWeight: '700',
  },
  fileMeta: {
    color: '#64748b',
    marginTop: 2,
  },
  smallShareButton: {
    backgroundColor: '#0f172a',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  smallShareButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
