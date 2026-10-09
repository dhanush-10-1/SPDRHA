import { useEffect, useMemo, useRef, useState } from 'react';
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

import {
  SafeAreaView,
  SafeAreaProvider,
} from 'react-native-safe-area-context';

import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';
import * as Sharing from 'expo-sharing';

import { DataLogger } from './src/sensors/DataLogger';
import {
  GPSReading,
  SensorReading,
} from './src/sensors/types';
import { sensorManager } from './src/sensors/SensorManager';

import {
  Accelerometer,
  Gyroscope,
} from 'expo-sensors';

type PermissionState = {
  sensors: 'pending' | 'granted' | 'denied';
  location: 'pending' | 'granted' | 'denied';
};

type FileItem = {
  name: string;
  uri: string;
  size: number;
};

type Label =
  | 'NORMAL'
  | 'BUMP'
  | 'SPEED_BREAKER'
  | 'POTHOLE';

type LabelCounts = {
  NORMAL: number;
  BUMP: number;
  SPEED_BREAKER: number;
  POTHOLE: number;
};

const emptyReading = (): SensorReading => ({
  timestamp: Date.now(),
  acc: {
    x: 0,
    y: 0,
    z: 0,
  },
  gyro: {
    x: 0,
    y: 0,
    z: 0,
  },
  gps: null,
});

function formatGps(gps: GPSReading | null) {
  if (!gps) {
    return 'No GPS';
  }

  return `${gps.speedKmh.toFixed(1)} km/h • ${gps.accuracyM.toFixed(0)} m`;
}

async function shareFile(uri: string) {
  const available =
    await Sharing.isAvailableAsync();

  if (!available) {
    Alert.alert(
      'Sharing unavailable',
      'This device cannot open the share sheet.',
    );
    return;
  }

  await Sharing.shareAsync(uri, {
    mimeType: 'text/csv',
  });
}

export default function App() {
  const [latestReading, setLatestReading] =
    useState<SensorReading>(emptyReading());

  /*
   * The selected label applies to all samples recorded
   * while that label is selected.
   */
  const [currentLabel, setCurrentLabel] =
    useState<Label>('NORMAL');

  /*
   * Ref is important because the sensor callback is
   * registered once. It always contains the latest label.
   */
  const currentLabelRef =
    useRef<Label>('NORMAL');

  const [permissionState, setPermissionState] =
    useState<PermissionState>({
      sensors: 'pending',
      location: 'pending',
    });

  const [recording, setRecording] =
    useState(false);

  const [rowCount, setRowCount] =
    useState(0);

  const [labelCounts, setLabelCounts] =
    useState<LabelCounts>({
      NORMAL: 0,
      BUMP: 0,
      SPEED_BREAKER: 0,
      POTHOLE: 0,
    });

  const [savedFileUri, setSavedFileUri] =
    useState<string | null>(null);

  const [recordedFiles, setRecordedFiles] =
    useState<FileItem[]>([]);

  const [busy, setBusy] =
    useState(false);

  const [message, setMessage] =
    useState('Ready to record.');

  const currentMagnitude =
    Math.sqrt(
      latestReading.acc.x *
        latestReading.acc.x +
        latestReading.acc.y *
          latestReading.acc.y +
        latestReading.acc.z *
          latestReading.acc.z,
    );

  const gpsSpeed =
    latestReading.gps?.speedKmh ?? 0;

  const permissionLabel = useMemo(() => {
    const sensors =
      permissionState.sensors === 'granted'
        ? 'Granted'
        : permissionState.sensors === 'denied'
          ? 'Denied'
          : 'Checking';

    const location =
      permissionState.location === 'granted'
        ? 'Granted'
        : permissionState.location === 'denied'
          ? 'Denied'
          : 'Checking';

    return {
      sensors,
      location,
    };
  }, [permissionState]);

  async function refreshFiles() {
    const directory =
      FileSystem.documentDirectory;

    if (!directory) {
      setRecordedFiles([]);
      return;
    }

    try {
      const names =
        await FileSystem.readDirectoryAsync(
          directory,
        );

      const items =
        await Promise.all(
          names
            .filter(
              (name) =>
                name.startsWith('reading_') &&
                name.endsWith('.csv'),
            )
            .map(async (name) => {
              const fileUri =
                `${directory}${name}`;

              const info =
                await FileSystem.getInfoAsync(
                  fileUri,
                );

              const size =
                info.exists &&
                'size' in info &&
                typeof info.size === 'number'
                  ? info.size
                  : 0;

              return {
                name,
                uri: fileUri,
                size,
              };
            }),
        );

      setRecordedFiles(
        items.sort((left, right) =>
          right.name.localeCompare(
            left.name,
          ),
        ),
      );
    } catch (error) {
      console.warn(
        'Failed to refresh recorded files:',
        error,
      );
    }
  }

  async function initializePermissions() {
    setBusy(true);

    try {
      const [
        accelerometerAvailable,
        gyroscopeAvailable,
      ] = await Promise.all([
        Accelerometer.isAvailableAsync(),
        Gyroscope.isAvailableAsync(),
      ]);

      let locationPermission =
        {
          granted: false,
        } as Location.LocationPermissionResponse;

      let servicesEnabled = false;
      let backgroundGranted = false;

      try {
        locationPermission =
          await Location.requestForegroundPermissionsAsync();

        servicesEnabled =
          await Location.hasServicesEnabledAsync();
      } catch (error) {
        console.warn(
          'Location permission request failed; continuing without GPS.',
          error,
        );
      }

      /*
       * Background location is useful for longer recordings,
       * but recording can still work with foreground permission.
       */
      if (
        Platform.OS === 'android' ||
        Platform.OS === 'ios'
      ) {
        try {
          const bg =
            await Location.requestBackgroundPermissionsAsync();

          backgroundGranted =
            bg.granted === true;
        } catch (error) {
          console.warn(
            'Background location permission unavailable; continuing with foreground-only GPS.',
            error,
          );

          backgroundGranted = false;
        }
      }

      const sensorsGranted =
        accelerometerAvailable &&
        gyroscopeAvailable;

      const locationGranted =
        locationPermission.granted &&
        servicesEnabled;

      setPermissionState({
        sensors: sensorsGranted
          ? 'granted'
          : 'denied',

        location: locationGranted
          ? 'granted'
          : 'denied',
      });

      if (!sensorsGranted) {
        setMessage(
          'Sensor hardware unavailable. Enable motion sensors to continue.',
        );

        sensorManager.stop();
        return;
      }

      await sensorManager.start();

      if (!locationGranted) {
        setMessage(
          'Sensors ready. GPS is unavailable; recording will continue without location data.',
        );
      } else if (!backgroundGranted) {
        setMessage(
          'Ready to record (foreground). Background location not granted.',
        );
      } else {
        setMessage(
          'Ready to record. Background location granted.',
        );
      }
    } catch (error) {
      setPermissionState({
        sensors: 'denied',
        location: 'denied',
      });

      setMessage(
        error instanceof Error
          ? error.message
          : 'Failed to initialize sensors.',
      );
    } finally {
      setBusy(false);
    }
  }

  /*
   * One callback receives synchronized readings from
   * SensorManager at approximately 50 Hz.
   */
  useEffect(() => {
    const unsubscribe =
      sensorManager.onReading(
        (reading) => {
          setLatestReading(reading);

          if (!DataLogger.isLogging()) {
            return;
          }

          /*
           * Get the latest manually selected label.
           */
          const label =
            currentLabelRef.current;

          /*
           * Save the synchronized sensor row
           * together with the current label.
           */
          DataLogger.appendRow(
            reading,
            label,
          );

          /*
           * Update UI counters.
           */
          const labelKey =
            label as keyof LabelCounts;

          setLabelCounts((prev) => ({
            ...prev,
            [labelKey]:
              prev[labelKey] + 1,
          }));
        },
      );

    void initializePermissions();
    void refreshFiles();

    return () => {
      unsubscribe();
      sensorManager.stop();
    };
  }, []);

  /*
   * Update displayed row count while recording.
   */
  useEffect(() => {
    if (!recording) {
      return;
    }

    setRowCount(
      DataLogger.getRowCount(),
    );

    const interval = setInterval(() => {
      setRowCount(
        DataLogger.getRowCount(),
      );
    }, 200);

    return () => {
      clearInterval(interval);
    };
  }, [recording]);

  function handleLabelChange(
    label: Label,
  ) {
    currentLabelRef.current = label;
    setCurrentLabel(label);
  }

  function handleStart() {
    if (DataLogger.isLogging()) {
      setMessage(
        'Recording already in progress.',
      );
      return;
    }

    try {
      setBusy(true);

      /*
       * Every recording starts as NORMAL.
       *
       * The passenger can change the label before
       * or during the recording.
       */
      currentLabelRef.current =
        'NORMAL';

      setCurrentLabel('NORMAL');

      DataLogger.startLogging();

      setRowCount(0);

      setLabelCounts({
        NORMAL: 0,
        BUMP: 0,
        SPEED_BREAKER: 0,
        POTHOLE: 0,
      });

      setSavedFileUri(null);

      setRecording(true);

      setMessage(
        'Recording in progress.',
      );
    } catch (error) {
      Alert.alert(
        'Could not start recording',
        error instanceof Error
          ? error.message
          : 'Unknown error',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    if (!DataLogger.isLogging()) {
      setRecording(false);
      return;
    }

    try {
      setBusy(true);

      const fileUri =
        await DataLogger.stopLogging();

      setRecording(false);

      setRowCount(
        DataLogger.getRowCount(),
      );

      setSavedFileUri(fileUri);

      setMessage(
        `Saved ${DataLogger.getRowCount()} rows.`,
      );

      await refreshFiles();
    } catch (error) {
      Alert.alert(
        'Could not stop recording',
        error instanceof Error
          ? error.message
          : 'Unknown error',
      );
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
      <SafeAreaView
        style={styles.safeArea}
      >
        <ScrollView
          contentContainerStyle={
            styles.container
          }
        >
          {/* HEADER */}

          <View style={styles.header}>
            <Text style={styles.title}>
              Road Anomaly Recorder
            </Text>

            <Text
              style={styles.subtitle}
            >
              Synchronized 50 Hz IMU data
              + GPS metadata
            </Text>
          </View>

          {/* PERMISSIONS */}

          <View style={styles.card}>
            <Text
              style={styles.cardTitle}
            >
              Permissions
            </Text>

            <View
              style={styles.permissionRow}
            >
              <Text
                style={
                  styles.permissionLabel
                }
              >
                Sensors
              </Text>

              <Text
                style={
                  permissionState.sensors ===
                  'granted'
                    ? styles.good
                    : styles.bad
                }
              >
                {permissionLabel.sensors}
              </Text>
            </View>

            <View
              style={styles.permissionRow}
            >
              <Text
                style={
                  styles.permissionLabel
                }
              >
                GPS
              </Text>

              <Text
                style={
                  permissionState.location ===
                  'granted'
                    ? styles.good
                    : styles.bad
                }
              >
                {permissionLabel.location}
              </Text>
            </View>

            {permissionState.sensors !==
              'granted' ||
            permissionState.location !==
              'granted' ? (
              <Pressable
                style={
                  styles.secondaryButton
                }
                onPress={handleRetry}
                disabled={busy}
              >
                <Text
                  style={
                    styles.secondaryButtonText
                  }
                >
                  Retry permissions
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* LIVE READOUT */}

          <View style={styles.card}>
            <Text
              style={styles.cardTitle}
            >
              Live Readout
            </Text>

            <Text style={styles.metric}>
              Acc X{' '}
              {latestReading.acc.x.toFixed(
                2,
              )}
              {'  '}
              Y{' '}
              {latestReading.acc.y.toFixed(
                2,
              )}
              {'  '}
              Z{' '}
              {latestReading.acc.z.toFixed(
                2,
              )}
            </Text>

            <Text style={styles.metric}>
              Gyro X{' '}
              {latestReading.gyro.x.toFixed(
                2,
              )}
              {'  '}
              Y{' '}
              {latestReading.gyro.y.toFixed(
                2,
              )}
              {'  '}
              Z{' '}
              {latestReading.gyro.z.toFixed(
                2,
              )}
            </Text>

            <Text style={styles.metric}>
              GPS{' '}
              {formatGps(
                latestReading.gps,
              )}
            </Text>

            {recording &&
            gpsSpeed > 0 &&
            gpsSpeed < 5 ? (
              <Text
                style={styles.speedWarning}
              >
                ⚠️ Speed below 5 km/h —
                these samples are not useful
                for anomaly detection.
              </Text>
            ) : null}

            <View
              style={
                styles.currentLabelRow
              }
            >
              <Text
                style={
                  styles.currentLabelText
                }
              >
                Current:
              </Text>

              <View
                style={[
                  styles.currentLabelBadge,

                  currentLabel ===
                    'NORMAL' &&
                    styles.labelNormal,

                  currentLabel ===
                    'POTHOLE' &&
                    styles.labelPothole,

                  currentLabel ===
                    'SPEED_BREAKER' &&
                    styles.labelSpeedBreaker,

                  currentLabel ===
                    'BUMP' &&
                    styles.labelBump,
                ]}
              >
                <Text
                  style={
                    styles.currentLabelBadgeText
                  }
                >
                  {currentLabel}
                </Text>
              </View>

              <Text
                style={
                  styles.currentLabelText
                }
              >
                magnitude:{' '}
                {currentMagnitude.toFixed(
                  2,
                )}
              </Text>
            </View>

            {recording ? (
              <View
                style={
                  styles.recordingRow
                }
              >
                <View
                  style={
                    styles.recordingDot
                  }
                />

                <Text
                  style={
                    styles.recordingText
                  }
                >
                  RECORDING
                </Text>
              </View>
            ) : null}
          </View>

          {/* TRAINING LABEL */}

          <View style={styles.card}>
            <Text
              style={styles.cardTitle}
            >
              Training Label
            </Text>

            <Text
              style={styles.labelHelp}
            >
              Select the road condition
              currently being recorded.
            </Text>

            <View
              style={styles.labelButtons}
            >
              {(
                [
                  'NORMAL',
                  'BUMP',
                  'SPEED_BREAKER',
                  'POTHOLE',
                ] as Label[]
              ).map((label) => (
                <Pressable
                  key={label}
                  onPress={() =>
                    handleLabelChange(
                      label,
                    )
                  }
                  style={[
                    styles.labelButton,

                    currentLabel ===
                      label &&
                      styles.labelButtonActive,
                  ]}
                >
                  <Text
                    style={
                      styles.labelButtonText
                    }
                  >
                    {label.replace(
                      '_',
                      ' ',
                    )}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* RECORDING */}

          <View style={styles.card}>
            <Text
              style={styles.cardTitle}
            >
              Recording
            </Text>

            <Text style={styles.metric}>
              Rows logged: {rowCount}
            </Text>

            {recording ? (
              <View
                style={styles.labelCounts}
              >
                <View
                  style={
                    styles.labelCountRow
                  }
                >
                  <Text
                    style={[
                      styles.labelCountName,
                      styles.labelCountNormal,
                    ]}
                  >
                    NORMAL
                  </Text>

                  <Text
                    style={
                      styles.labelCountValue
                    }
                  >
                    {labelCounts.NORMAL}
                  </Text>
                </View>

                <View
                  style={
                    styles.labelCountRow
                  }
                >
                  <Text
                    style={[
                      styles.labelCountName,
                      styles.labelCountBump,
                    ]}
                  >
                    BUMP
                  </Text>

                  <Text
                    style={
                      styles.labelCountValue
                    }
                  >
                    {labelCounts.BUMP}
                  </Text>
                </View>

                <View
                  style={
                    styles.labelCountRow
                  }
                >
                  <Text
                    style={[
                      styles.labelCountName,
                      styles.labelCountSpeedBreaker,
                    ]}
                  >
                    SPEED BREAKER
                  </Text>

                  <Text
                    style={
                      styles.labelCountValue
                    }
                  >
                    {
                      labelCounts.SPEED_BREAKER
                    }
                  </Text>
                </View>

                <View
                  style={
                    styles.labelCountRow
                  }
                >
                  <Text
                    style={[
                      styles.labelCountName,
                      styles.labelCountPothole,
                    ]}
                  >
                    POTHOLE
                  </Text>

                  <Text
                    style={
                      styles.labelCountValue
                    }
                  >
                    {labelCounts.POTHOLE}
                  </Text>
                </View>
              </View>
            ) : null}

            <Text
              style={styles.message}
            >
              {message}
            </Text>

            <View
              style={styles.actionRow}
            >
              {!recording ? (
                <Pressable
                  style={[
                    styles.primaryButton,
                    busy &&
                      styles.buttonDisabled,
                  ]}
                  disabled={busy}
                  onPress={handleStart}
                >
                  <Text
                    style={
                      styles.primaryButtonText
                    }
                  >
                    Start Recording
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  style={styles.stopButton}
                  disabled={busy}
                  onPress={handleStop}
                >
                  <Text
                    style={
                      styles.primaryButtonText
                    }
                  >
                    Stop Recording
                  </Text>
                </Pressable>
              )}

              {busy ? (
                <ActivityIndicator
                  color="#111827"
                />
              ) : null}
            </View>

            {savedFileUri ? (
              <Pressable
                style={
                  styles.shareButton
                }
                onPress={() =>
                  shareFile(
                    savedFileUri,
                  )
                }
              >
                <Text
                  style={
                    styles.shareButtonText
                  }
                >
                  Share last CSV
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* RECORDED FILES */}

          <View style={styles.card}>
            <Text
              style={styles.cardTitle}
            >
              Recorded Files
            </Text>

            {recordedFiles.length ===
            0 ? (
              <Text
                style={styles.message}
              >
                No CSV files yet.
              </Text>
            ) : null}

            {recordedFiles.map(
              (file) => (
                <View
                  key={file.uri}
                  style={styles.fileRow}
                >
                  <View
                    style={styles.fileInfo}
                  >
                    <Text
                      style={
                        styles.fileName
                      }
                    >
                      {file.name}
                    </Text>

                    <Text
                      style={
                        styles.fileMeta
                      }
                    >
                      {Math.max(
                        1,
                        Math.round(
                          file.size /
                            1024,
                        ),
                      )}{' '}
                      KB
                    </Text>
                  </View>

                  <Pressable
                    style={
                      styles.smallShareButton
                    }
                    onPress={() =>
                      shareFile(
                        file.uri,
                      )
                    }
                  >
                    <Text
                      style={
                        styles.smallShareButtonText
                      }
                    >
                      Share
                    </Text>
                  </Pressable>
                </View>
              ),
            )}
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

    shadowOffset: {
      width: 0,
      height: 4,
    },

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

  speedWarning: {
    color: '#FF6B00',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },

  currentLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },

  currentLabelText: {
    color: '#334155',
    fontWeight: '700',
  },

  currentLabelBadge: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 14,
  },

  currentLabelBadgeText: {
    color: '#111827',
    fontWeight: '800',
  },

  labelNormal: {
    backgroundColor: '#86efac',
  },

  labelPothole: {
    backgroundColor: '#fca5a5',
  },

  labelSpeedBreaker: {
    backgroundColor: '#fdba74',
  },

  labelBump: {
    backgroundColor: '#fde047',
  },

  labelHelp: {
    color: '#64748b',
    fontSize: 13,
  },

  labelButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },

  labelButton: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },

  labelButtonActive: {
    backgroundColor: '#dbeafe',
    borderColor: '#2563eb',
  },

  labelButtonText: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 12,
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

  labelCounts: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 10,
    gap: 6,
  },

  labelCountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  labelCountName: {
    fontWeight: '700',
  },

  labelCountValue: {
    color: '#111827',
    fontWeight: '700',
  },

  labelCountNormal: {
    color: '#047857',
  },

  labelCountBump: {
    color: '#ca8a04',
  },

  labelCountSpeedBreaker: {
    color: '#ea580c',
  },

  labelCountPothole: {
    color: '#dc2626',
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