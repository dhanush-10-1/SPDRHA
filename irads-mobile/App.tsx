import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  ActivityIndicator,
  AppState,
  Alert,
  Modal,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Platform,
} from "react-native";

import {
  checkSpeedGate,
  startRoadSensorCollection,
  SENSOR_WINDOW_SIZE,
  MAX_GPS_ACCURACY_METERS,
} from "./sensors/roadSensor";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import IRADSMap from "./IRADSMap";
import { AIService } from "./src/ai/aiService";
import type { SensorReading } from "./src/sensors/types";
import { API_BASE_URL } from "./src/config";
import { syncService } from "./src/storage/syncService";

// The platform-specific map can accept newer optional props while the native
// map implementation is updated separately. Expo Web resolves IRADSMap.web.tsx.
const IRADSMapWithDestination = IRADSMap as React.ComponentType<any>;

// ============================================================
// TYPES
// ============================================================

type Coordinate = {
  latitude: number;
  longitude: number;
};

type LiveGPSFix = Coordinate & {
  accuracyM: number | null;
  speedKmh: number | null;
  timestamp: number;
};

type DestinationResult = {
  id: string;
  name: string;
  address: string;
  coordinate: Coordinate;
};

type Hazard = Coordinate & {
  id: string;
  intensity: number;
  type: "POTHOLE" | "SPEED_BREAKER";
  confidence: number;
};

type NearbyAnomaliesResponse = {
  count: number;
  radius_m: number;
  anomalies: Array<{
    id: string;
    type: "POTHOLE" | "SPEED_BREAKER";
    confidence: number;
    confidence_avg?: number;
    latitude: number;
    longitude: number;
    gps_accuracy_m?: number;
    speed_kmh?: number;
    detected_at?: string;
    created_at?: string;
    is_processed?: boolean;
  }>;
};

type RouteAnomaliesResponse = {
  count: number;
  corridor_m: number;
  anomalies: Array<{
    id: string;
    type: "POTHOLE" | "SPEED_BREAKER";
    severity: number;
    confidence: number | null;
    report_count: number;
    latitude: number;
    longitude: number;
    distance_to_route_m: number;
    last_seen: string | null;
  }>;
};

// ============================================================
// CONFIGURATION
// ============================================================

// Search radius for nearby road anomalies.
const SEARCH_RADIUS_METERS = 10000;

// Default map location: Bengaluru.
// This also lets you test against your existing Bengaluru data.
const INITIAL_LOCATION: Coordinate = {
  latitude: 12.9716,
  longitude: 77.5946,
};

// Estimate distance between two GPS coordinates in metres.
function distanceMeters(
  a: Coordinate,
  b: Coordinate,
): number {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(Math.min(1, h)));
}


// Project a coordinate onto every route segment. Returns the closest distance
// to the route and distance travelled along the route to that projection.
function projectOntoRoute(
  point: Coordinate,
  route: Coordinate[],
): { distanceToRouteMeters: number; distanceAlongRouteMeters: number } | null {
  if (route.length < 2) return null;

  const earthRadiusMeters = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latScale = (Math.PI / 180) * earthRadiusMeters;
  const lonScale = latScale * Math.cos(toRadians(point.latitude));

  let bestDistance = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  let distanceBeforeSegment = 0;

  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    const ax = (a.longitude - point.longitude) * lonScale;
    const ay = (a.latitude - point.latitude) * latScale;
    const bx = (b.longitude - point.longitude) * lonScale;
    const by = (b.latitude - point.latitude) * latScale;
    const dx = bx - ax;
    const dy = by - ay;
    const segmentLengthSquared = dx * dx + dy * dy;
    const t = segmentLengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / segmentLengthSquared));
    const projectedX = ax + t * dx;
    const projectedY = ay + t * dy;
    const distance = Math.hypot(projectedX, projectedY);
    const segmentLength = Math.sqrt(segmentLengthSquared);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestAlong = distanceBeforeSegment + t * segmentLength;
    }
    distanceBeforeSegment += segmentLength;
  }

  return {
    distanceToRouteMeters: bestDistance,
    distanceAlongRouteMeters: bestAlong,
  };
}

// Keep reports very close to the blue route line to avoid alerting for nearby
// roads. A small tolerance is necessary because phone GPS and report locations
// are not perfectly accurate.
function calculateRouteLength(route: Coordinate[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    total += distanceMeters(route[i - 1], route[i]);
  }
  return total;
}

const POTHOLE_ALERT_DISTANCE_METERS = 100;
const MAX_RIDER_ROUTE_OFFSET_METERS = 30;
const ROUTE_CORRIDOR_METERS = 15;
const ROUTE_PROGRESS_TOLERANCE_METERS = 10;

// ============================================================
// APP
// ============================================================

export default function App() {
  const [speedKmh, setSpeedKmh] = useState<number | null>(null);
  const [speedGateMessage, setSpeedGateMessage] = useState(
    "Waiting for GPS speed...",
  );
  const speedRef = useRef<number | null>(null);
  const latestGpsFixRef = useRef<LiveGPSFix | null>(null);
  const aiServiceRef = useRef<AIService | null>(null);
  const [aiStatus, setAiStatus] = useState("Waiting for navigation.");
  const previousPositionRef = useRef<{
    latitude: number;
    longitude: number;
    timestamp: number;
    accuracy: number | null;
  } | null>(null);
  const [currentLocation, setCurrentLocation] =
    useState<Coordinate | null>(null);

  const [source, setSource] = useState("My location");
  const [selectedSourceCoordinate, setSelectedSourceCoordinate] = useState<Coordinate | null>(null);
  const [sourceResults, setSourceResults] = useState<DestinationResult[]>([]);
  const [destination, setDestination] = useState("");
  // Exact selected destination coordinate is rendered as a red map pin.
  const [selectedDestinationCoordinate, setSelectedDestinationCoordinate] =
    useState<Coordinate | null>(null);
  const [destinationResults, setDestinationResults] = useState<DestinationResult[]>([]);
  const [searchingDestination, setSearchingDestination] = useState(false);
  const [loadingRoute, setLoadingRoute] = useState(false);

  const [routeCoordinates, setRouteCoordinates] = useState<Coordinate[]>([]);
  const [routeDistanceMeters, setRouteDistanceMeters] = useState<number | null>(null);
  const [routeDurationSeconds, setRouteDurationSeconds] = useState<number | null>(null);

  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [nearbyConfirmedHazards, setNearbyConfirmedHazards] = useState<Hazard[]>([]);

  const [showHeatmap, setShowHeatmap] = useState(true);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [routeSelected, setRouteSelected] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [navigationProgress, setNavigationProgress] = useState({
    completedMeters: 0,
    remainingMeters: 0,
    percentage: 0,
  });
  const [navigationOnRoute, setNavigationOnRoute] = useState(false);
  const alertedHazardsRef = useRef<Set<string>>(new Set());
  const [recenterRequest, setRecenterRequest] = useState(0);

  const [loadingLocation, setLoadingLocation] = useState(true);
  const [loadingHazards, setLoadingHazards] = useState(false);

  const [hazardError, setHazardError] = useState<string | null>(null);
  // Prevent slower, older requests from overwriting results for a newer route.
  const hazardRequestIdRef = useRef(0);

  // Offline-first sync: pending SQLite events survive app restarts.
  // Retry when the app opens/returns to foreground and periodically while open,
  // so events are uploaded even if the backend starts after detection.
  useEffect(() => {
    if (Platform.OS === "web") return;

    let appIsActive = AppState.currentState === "active";

    const trySyncPendingEvents = (reason: string) => {
      if (!appIsActive) return;
      void syncService.syncPendingEvents().catch((error) => {
        console.warn(`[OFFLINE SYNC] Retry failed (${reason}):`, error);
      });
    };

    trySyncPendingEvents("app-start");

    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      appIsActive = nextState === "active";
      if (appIsActive) trySyncPendingEvents("app-foreground");
    });

    const retryInterval = setInterval(() => {
      if (AppState.currentState === "active") {
        trySyncPendingEvents("periodic-retry");
      }
    }, 15000);

    return () => {
      appIsActive = false;
      appStateSubscription.remove();
      clearInterval(retryInterval);
    };
  }, []);

  // ----------------------------------------------------------
  // LOCATION
  // ----------------------------------------------------------

  useEffect(() => {
    let mounted = true;
    let locationSubscription: Location.LocationSubscription | null = null;

    async function startLocationTracking() {
      try {
        const { status } =
          await Location.requestForegroundPermissionsAsync();

        if (status !== "granted") {
          console.warn("Location permission was not granted.");
          return;
        }

        // Get an initial high-accuracy position before starting live updates.
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        const initialSpeed = location.coords.speed;
        speedRef.current =
          initialSpeed !== null &&
          Number.isFinite(initialSpeed) &&
          initialSpeed >= 0
            ? initialSpeed
            : null;

        previousPositionRef.current = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          timestamp: location.timestamp,
          accuracy: location.coords.accuracy,
        };

        if (mounted) {
          setSpeedKmh(
            speedRef.current === null ? null : speedRef.current * 3.6,
          );
          setSpeedGateMessage(checkSpeedGate(speedRef.current).reason);
          const coordinate = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          };

          latestGpsFixRef.current = {
            ...coordinate,
            accuracyM: location.coords.accuracy,
            speedKmh:
              speedRef.current === null ? null : speedRef.current * 3.6,
            timestamp: location.timestamp,
          };

          setCurrentLocation(coordinate);

          console.log("Initial location:", {
            ...coordinate,
            accuracyMeters: location.coords.accuracy,
          });
        }

        // Keep the position updated as the device moves.
        locationSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 5000,
            distanceInterval: 5,
          },
          (updatedLocation) => {
            if (!mounted) return;

            const coordinate = {
              latitude: updatedLocation.coords.latitude,
              longitude: updatedLocation.coords.longitude,
            };

            const reportedSpeed = updatedLocation.coords.speed;
            let speedMetersPerSecond: number | null =
              reportedSpeed !== null &&
              Number.isFinite(reportedSpeed) &&
              reportedSpeed >= 0
                ? reportedSpeed
                : null;

            const previous = previousPositionRef.current;
            const currentAccuracy = updatedLocation.coords.accuracy;
            const elapsedSeconds = previous
              ? (updatedLocation.timestamp - previous.timestamp) / 1000
              : 0;

            let speedSource: "GPS" | "POSITION_ESTIMATE" | "UNAVAILABLE" =
              speedMetersPerSecond !== null ? "GPS" : "UNAVAILABLE";

            // Web geolocation often omits coords.speed. Estimate it only when
            // both fixes are reasonably accurate and the elapsed time is valid.
            if (
              speedMetersPerSecond === null &&
              Platform.OS === "web" &&
              previous &&
              previous.accuracy !== null &&
              currentAccuracy !== null &&
              previous.accuracy <= 30 &&
              currentAccuracy <= 30 &&
              elapsedSeconds >= 1 &&
              elapsedSeconds <= 15
            ) {
              const distance = distanceMeters(previous, coordinate);
              // Require movement to exceed likely GPS noise. If it does not,
              // keep speed unavailable instead of incorrectly assuming 0 km/h.
              const movementThreshold = Math.max(
                5,
                previous.accuracy,
                currentAccuracy,
              );

              if (distance > movementThreshold) {
                speedMetersPerSecond = distance / elapsedSeconds;
                speedSource = "POSITION_ESTIMATE";
              }
            }

            console.log("GPS DEBUG:", {
              platform: Platform.OS,
              latitude: coordinate.latitude,
              longitude: coordinate.longitude,
              reportedSpeedMetersPerSecond: reportedSpeed,
              accuracyMeters: currentAccuracy,
              elapsedSeconds,
              speedSource,
              estimatedOrReportedSpeedKmh:
                speedMetersPerSecond === null
                  ? null
                  : Number((speedMetersPerSecond * 3.6).toFixed(2)),
            });

            previousPositionRef.current = {
              latitude: coordinate.latitude,
              longitude: coordinate.longitude,
              timestamp: updatedLocation.timestamp,
              accuracy: currentAccuracy,
            };

            speedRef.current = speedMetersPerSecond;
            latestGpsFixRef.current = {
              ...coordinate,
              accuracyM: currentAccuracy,
              speedKmh:
                speedMetersPerSecond === null
                  ? null
                  : speedMetersPerSecond * 3.6,
              timestamp: updatedLocation.timestamp,
            };

            const gate = checkSpeedGate(speedMetersPerSecond);
            setSpeedKmh(gate.speedKmh);
            setSpeedGateMessage(gate.reason);

            setCurrentLocation(coordinate);

            console.log("Speed gate:", {
              allowed: gate.allowed,
              reason: gate.reason,
              speedKmh: gate.speedKmh,
            });
          }
        );
      } catch (error) {
        console.error("Could not retrieve or track location:", error);
      } finally {
        if (mounted) {
          setLoadingLocation(false);
        }
      }
    }

    void startLocationTracking();

    return () => {
      mounted = false;
      locationSubscription?.remove();
    };
  }, []);

  // ----------------------------------------------------------
  // SPEED-GATED SENSOR COLLECTION + TFLITE INFERENCE
  // ----------------------------------------------------------

  useEffect(() => {
    // Sensor collection and inference remain OFF until navigation starts.
    if (!isNavigating) {
      console.log("Navigation inactive: sensor collection stopped.");
      setAiStatus("Stopped. Start navigation to run the model.");
      return;
    }

    // react-native-fast-tflite requires a native development build.
    // Keep the browser map usable without trying to load the native runtime.
    if (Platform.OS === "web") {
      console.log("TFLite inference requires the Android/iOS development build.");
      setAiStatus("Web preview: route/map only. Run the Android build for TFLite inference.");
      return;
    }

    let active = true;
    let stopSensors: (() => void) | null = null;
    let lastSensorDebugLogAt = 0;

    async function startInferenceAndSensors() {
      try {
        setAiStatus("Loading on-device TFLite model...");
        console.log("Initializing IRADS TFLite model.");

        const service = aiServiceRef.current ?? new AIService();
        await service.initialize();

        if (!active) {
          service.reset();
          return;
        }

        aiServiceRef.current = service;
        setAiStatus(
          `Model ready. Waiting for ${SENSOR_WINDOW_SIZE} sensor samples at speed >= 5 km/h.`,
        );
        console.log("IRADS TFLite model initialized.");

        stopSensors = startRoadSensorCollection((sample) => {
          // Temporary sensor diagnostic: log once per second even when the
          // speed gate rejects the sample, so sensor delivery can be verified
          // safely while the phone is stationary.
          const sensorDebugNow = Date.now();
          if (sensorDebugNow - lastSensorDebugLogAt >= 1000) {
            console.log("IRADS RAW SENSOR DEBUG:", {
              timestamp: sample.timestamp,
              accelerometer: {
                x: sample.ax,
                y: sample.ay,
                z: sample.az,
              },
              gyroscope: {
                x: sample.gx,
                y: sample.gy,
                z: sample.gz,
              },
              speedKmh:
                speedRef.current === null
                  ? null
                  : Number((speedRef.current * 3.6).toFixed(2)),
            });
            lastSensorDebugLogAt = sensorDebugNow;
          }

          const gate = checkSpeedGate(speedRef.current);

          // Do not feed stationary/invalid-speed readings into a window.
          // WindowManager also resets a window when it sees a gap >100 ms.
          if (!gate.allowed) {
            return;
          }

          const fix = latestGpsFixRef.current;
          const gpsIsFresh =
            fix !== null &&
            Number.isFinite(fix.timestamp) &&
            Date.now() - fix.timestamp >= 0 &&
            Date.now() - fix.timestamp <= 10000;
          const gpsIsAccurate =
            fix !== null &&
            fix.accuracyM !== null &&
            Number.isFinite(fix.accuracyM) &&
            fix.accuracyM <= MAX_GPS_ACCURACY_METERS;
          const gpsHasSpeed =
            fix !== null &&
            fix.speedKmh !== null &&
            Number.isFinite(fix.speedKmh);

          const gps: SensorReading["gps"] =
            fix && gpsIsFresh && gpsIsAccurate && gpsHasSpeed
              ? {
                  lat: fix.latitude,
                  lng: fix.longitude,
                  speedKmh: fix.speedKmh as number,
                  accuracyM: fix.accuracyM as number,
                  timestamp: fix.timestamp,
                }
              : null;

          const reading: SensorReading = {
            timestamp: sample.timestamp,
            // The collector runs at about 30 Hz. Its millisecond timestamps
            // are sufficient for the existing 100 ms window-gap guard.
            sensorTimestampMs: sample.timestamp,
            acc: {
              x: sample.ax,
              y: sample.ay,
              z: sample.az,
            },
            gyro: {
              x: sample.gx,
              y: sample.gy,
              z: sample.gz,
            },
            gps,
          };

          void service
            .processReading(reading)
            .then((prediction) => {
              if (!active || prediction === null) {
                return;
              }

              const percent = (prediction.confidence * 100).toFixed(1);
              console.log("IRADS TFLite prediction:", {
                type: prediction.type,
                confidence: prediction.confidence,
                gpsAttached: gps !== null,
              });

              if (prediction.type === "NORMAL") {
                setAiStatus(`Model: NORMAL (${percent}%).`);
              } else if (gps === null) {
                setAiStatus(
                  `Model: ${prediction.type} (${percent}%), but GPS is stale/inaccurate; event not saved.`,
                );
              } else {
                setAiStatus(
                  `Model: ${prediction.type} (${percent}%). Checking confidence/cooldown and syncing eligible event.`,
                );
              }
            })
            .catch((error) => {
              if (!active) return;
              console.error("IRADS inference failed:", error);
              setAiStatus(
                `Inference error: ${
                  error instanceof Error ? error.message : "see console"
                }`,
              );
            });
        });

        console.log("Navigation started: sensor collection and inference enabled.");
      } catch (error) {
        if (!active) return;
        console.error("Could not initialize IRADS TFLite inference:", error);
        setAiStatus(
          `Model initialization failed: ${
            error instanceof Error ? error.message : "see console"
          }`,
        );
      }
    }

    void startInferenceAndSensors();

    return () => {
      active = false;
      stopSensors?.();
      aiServiceRef.current?.reset();
      console.log("Navigation stopped: sensor collection disabled.");
    };
  }, [isNavigating]);

  // ----------------------------------------------------------
  // FETCH ANOMALIES FROM FASTAPI
  // ----------------------------------------------------------

  const fetchNearbyHazards = useCallback(
    async (location: Coordinate) => {
      const requestId = ++hazardRequestIdRef.current;
      setLoadingHazards(true);
      setHazardError(null);

      try {
        const params = new URLSearchParams({
          latitude: String(location.latitude),
          longitude: String(location.longitude),
          radius_m: String(SEARCH_RADIUS_METERS),
        });

        const url =
          `${API_BASE_URL}/api/v1/anomalies/nearby?` +
          params.toString();

        console.log("Fetching nearby road anomalies:", url);

        const response = await fetch(url, {
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          throw new Error(
            `Nearby-anomaly request failed with HTTP ${response.status}`,
          );
        }

        const data: NearbyAnomaliesResponse = await response.json();

        if (!Array.isArray(data.anomalies)) {
          throw new Error(
            "Unexpected nearby-anomaly response: anomalies must be an array.",
          );
        }

        const fetchedHazards: Hazard[] = data.anomalies
          .filter(
            (anomaly) =>
              Number.isFinite(Number(anomaly.latitude)) &&
              Number.isFinite(Number(anomaly.longitude)) &&
              Number.isFinite(Number(anomaly.confidence ?? anomaly.confidence_avg)) &&
              ["POTHOLE", "SPEED_BREAKER"].includes(anomaly.type),
          )
          .map((anomaly) => {
            const confidence = Math.max(
              0,
              Math.min(1, Number(anomaly.confidence ?? anomaly.confidence_avg)),
            );

            return {
              id: String(anomaly.id),
              latitude: Number(anomaly.latitude),
              longitude: Number(anomaly.longitude),
              type: anomaly.type,
              confidence,
              intensity: confidence,
            };
          });

        if (requestId !== hazardRequestIdRef.current) return;
        setNearbyConfirmedHazards(fetchedHazards);
        console.log(`Loaded ${fetchedHazards.length} nearby anomalies.`);
      } catch (error) {
        if (requestId !== hazardRequestIdRef.current) return;
        console.error("Failed to fetch nearby anomalies:", error);
        setHazardError("Anomaly data is temporarily unavailable. Route planning still works.");
        setNearbyConfirmedHazards([]);
      } finally {
        if (requestId === hazardRequestIdRef.current) {
          setLoadingHazards(false);
        }
      }
    },
    [],
  );

  // This endpoint reads active CONFIRMED anomalies and filters them against
  // the route geometry in PostGIS. Route coordinates must be [longitude, latitude].
  const fetchRouteHazards = useCallback(
    async (route: Coordinate[]) => {
      if (route.length < 2) {
        setHazards([]);
        return;
      }

      const requestId = ++hazardRequestIdRef.current;
      setLoadingHazards(true);
      setHazardError(null);

      try {
        const params = new URLSearchParams({
          corridor_m: String(ROUTE_CORRIDOR_METERS),
        });
        const url =
          `${API_BASE_URL}/api/v1/anomalies/along-route?${params.toString()}`;
        const routeCoordinates = route.map((point) => [
          point.longitude,
          point.latitude,
        ]);

        console.log("Fetching confirmed anomalies along selected route:", {
          url,
          coordinateCount: routeCoordinates.length,
          corridorMeters: ROUTE_CORRIDOR_METERS,
        });

        const response = await fetch(url, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(routeCoordinates),
        });

        if (!response.ok) {
          const responseText = await response.text().catch(() => "");
          throw new Error(
            `Route-anomaly request failed with HTTP ${response.status}${responseText ? `: ${responseText}` : ""}`,
          );
        }

        const data: RouteAnomaliesResponse = await response.json();
        if (!Array.isArray(data.anomalies)) {
          throw new Error(
            "Unexpected route-anomaly response: anomalies must be an array.",
          );
        }

        const fetchedHazards: Hazard[] = data.anomalies
          .filter(
            (anomaly) =>
              Number.isFinite(Number(anomaly.latitude)) &&
              Number.isFinite(Number(anomaly.longitude)) &&
              ["POTHOLE", "SPEED_BREAKER"].includes(anomaly.type),
          )
          .map((anomaly) => {
            const confidenceValue = Number(anomaly.confidence);
            const confidence = Number.isFinite(confidenceValue)
              ? Math.max(0, Math.min(1, confidenceValue))
              : 0;

            return {
              id: String(anomaly.id),
              latitude: Number(anomaly.latitude),
              longitude: Number(anomaly.longitude),
              type: anomaly.type,
              confidence,
              intensity: confidence,
            };
          });

        if (requestId !== hazardRequestIdRef.current) return;
        setHazards(fetchedHazards);
        console.log(
          `Loaded ${fetchedHazards.length} confirmed anomalies along the selected route (API returned ${data.count}).`,
        );
      } catch (error) {
        if (requestId !== hazardRequestIdRef.current) return;
        console.error("Failed to fetch anomalies along selected route:", error);
        setHazardError("Anomaly data is temporarily unavailable. Route planning still works.");
        setHazards([]);
      } finally {
        if (requestId === hazardRequestIdRef.current) {
          setLoadingHazards(false);
        }
      }
    },
    [],
  );

  const lastNearbyFetchLocationRef = useRef<Coordinate | null>(null);

  // Before a route is selected, preserve the existing nearby-raw-report map.
  // While a route is selected, the separate effect below owns hazard fetching.
  useEffect(() => {
    if (routeSelected) {
      // The route-fetch effect owns requests while a route is selected. Do not
      // invalidate its response on every GPS position update.
      return;
    }

    if (!currentLocation) {
      hazardRequestIdRef.current += 1;
      setLoadingHazards(false);
      setHazards([]);
      setNearbyConfirmedHazards([]);
      setHazardError(
        loadingLocation
          ? null
          : "Location unavailable. Enable location access to find nearby anomalies.",
      );
      return;
    }

    const previous = lastNearbyFetchLocationRef.current;
    if (previous && distanceMeters(previous, currentLocation) < 150) return;
    lastNearbyFetchLocationRef.current = currentLocation;
    void fetchNearbyHazards(currentLocation);
  }, [currentLocation, loadingLocation, routeSelected, fetchNearbyHazards]);

  // Fetch route-specific, confirmed anomalies once for each selected route.
  // GPS updates do not trigger this effect, so moving does not repeatedly post
  // the full route to the backend.
  useEffect(() => {
    if (!routeSelected || routeCoordinates.length < 2) return;
    void fetchRouteHazards(routeCoordinates);
  }, [routeSelected, routeCoordinates, fetchRouteHazards]);

  // Update progress and warn once per pothole as live GPS changes.
  // Route geometry is used so nearby roads and hazards behind the rider
  // do not generate warnings. These are foreground-only alerts.
  useEffect(() => {
    if (!isNavigating || !currentLocation || routeCoordinates.length < 2) {
      setNavigationOnRoute(false);
      return;
    }

    const rider = projectOntoRoute(currentLocation, routeCoordinates);
    if (!rider || rider.distanceToRouteMeters > MAX_RIDER_ROUTE_OFFSET_METERS) {
      setNavigationOnRoute(false);
      return;
    }
    setNavigationOnRoute(true);

    const total = calculateRouteLength(routeCoordinates);
    const completed = Math.max(0, Math.min(total, rider.distanceAlongRouteMeters));
    setNavigationProgress({
      completedMeters: completed,
      remainingMeters: Math.max(0, total - completed),
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    });

    // Do not issue alerts from stale or low-quality GPS fixes.
    const fix = latestGpsFixRef.current;
    if (!fix || Date.now() - fix.timestamp > 10000 ||
        fix.accuracyM === null || fix.accuracyM > 30) return;

    const upcoming = hazards
      .filter((hazard) => hazard.type === "POTHOLE" &&
        !alertedHazardsRef.current.has(hazard.id))
      .map((hazard) => {
        const projected = projectOntoRoute(hazard, routeCoordinates);
        if (!projected || projected.distanceToRouteMeters > ROUTE_CORRIDOR_METERS) {
          return null;
        }
        return {
          id: hazard.id,
          distanceAhead: projected.distanceAlongRouteMeters - rider.distanceAlongRouteMeters,
        };
      })
      .filter((item): item is { id: string; distanceAhead: number } =>
        item !== null && item.distanceAhead > 0 &&
        item.distanceAhead <= POTHOLE_ALERT_DISTANCE_METERS)
      .sort((a, b) => a.distanceAhead - b.distanceAhead);

    const nearest = upcoming[0];
    if (!nearest) return;
    // Voice and vibration alerts will be enabled in a later phase.
  }, [isNavigating, currentLocation, routeCoordinates, hazards]);

  // ----------------------------------------------------------
  // MAP CONFIGURATION
  // ----------------------------------------------------------
  const mapCenter = currentLocation ?? INITIAL_LOCATION;

  // The backend returns active confirmed anomalies within the route corridor.
  // Locally, hide anomalies already behind the user's current route progress.
  // Before route selection, the map retains the existing nearby-raw-report behavior.
  const routeProgress = routeSelected && currentLocation && routeCoordinates.length >= 2
    ? projectOntoRoute(currentLocation, routeCoordinates)
    : null;

  const routeHazards = routeSelected && routeCoordinates.length >= 2
    ? hazards.filter((hazard) => {
        const projection = projectOntoRoute(hazard, routeCoordinates);
        if (!projection || projection.distanceToRouteMeters > ROUTE_CORRIDOR_METERS) {
          return false;
        }
        if (routeProgress && projection.distanceAlongRouteMeters <
            routeProgress.distanceAlongRouteMeters - ROUTE_PROGRESS_TOLERANCE_METERS) {
          return false;
        }
        return true;
      })
    : hazards;

  // Show nearby confirmed anomalies when no route is selected.
  // During route selection/navigation, show only anomalies on the selected route.
  const mapHazards = routeSelected ? routeHazards : nearbyConfirmedHazards;
// ----------------------------------------------------------
  // MESSAGES
  // ----------------------------------------------------------

  function showMessage(title: string, message: string) {
    if (Platform.OS === "web") {
      window.alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  }

  // ----------------------------------------------------------
  // SOURCE SEARCH, DESTINATION SEARCH AND ROUTING
  // ----------------------------------------------------------

  async function handleSearchSource() {
    const query = source.trim();
    if (!query || query.toLowerCase() === "my location") {
      setSource("My location");
      setSelectedSourceCoordinate(null);
      setSourceResults([]);
      return;
    }

    setSourceResults([]);
    try {
      const params = new URLSearchParams({ q: query, limit: "5" });
      if (currentLocation) {
        params.set("lat", String(currentLocation.latitude));
        params.set("lon", String(currentLocation.longitude));
      }
      const response = await fetch(
        `https://photon.komoot.io/api/?${params.toString()}`,
        { headers: { Accept: "application/geo+json" } },
      );
      if (!response.ok) throw new Error(`Source search returned HTTP ${response.status}.`);
      const results = await response.json();
      const features = Array.isArray(results?.features) ? results.features : [];
      const places: DestinationResult[] = features
        .filter((feature: any) => Array.isArray(feature?.geometry?.coordinates) && feature.geometry.coordinates.length >= 2)
        .map((feature: any, index: number) => {
          const properties = feature.properties ?? {};
          const name = String(properties.name || properties.street || properties.city || query);
          const address = [properties.name, properties.street, properties.housenumber, properties.district, properties.city, properties.state, properties.country]
            .filter(Boolean).map(String).filter((value, i, arr) => arr.indexOf(value) === i).join(", ");
          return {
            id: String(properties.osm_id ?? `${name}-${index}`),
            name,
            address: address || name,
            coordinate: { longitude: Number(feature.geometry.coordinates[0]), latitude: Number(feature.geometry.coordinates[1]) },
          };
        })
        .filter((place: DestinationResult) => Number.isFinite(place.coordinate.latitude) && Number.isFinite(place.coordinate.longitude));
      setSourceResults(places);
      if (!places.length) showMessage("No starting locations found", "Try a more specific address or landmark.");
    } catch (error) {
      console.error("Source search failed:", error);
      showMessage("Source search failed", error instanceof Error ? error.message : "Check your internet connection and try again.");
    }
  }

  function handleUseMyLocation() {
    setSource("My location");
    setSelectedSourceCoordinate(null);
    setSourceResults([]);
    setSelectedDestinationCoordinate(null);
    setRouteSelected(false);
    setIsNavigating(false);
    setRouteCoordinates([]);
    setRouteDistanceMeters(null);
    setRouteDurationSeconds(null);
    setHazards([]);
  }

  function handleSelectSource(place: DestinationResult) {
    setSource(place.name);
    setSelectedSourceCoordinate(place.coordinate);
    setSourceResults([]);
    setSelectedDestinationCoordinate(null);
    setRouteSelected(false);
    setIsNavigating(false);
    setRouteCoordinates([]);
    setRouteDistanceMeters(null);
    setRouteDurationSeconds(null);
    setHazards([]);
  }

  async function handleSearchRoute() {
    const query = destination.trim();

    if (!query) {
      showMessage("Destination required", "Enter a place, address, or landmark to search.");
      return;
    }

    setSearchingDestination(true);
    setDestinationResults([]);
    setSelectedDestinationCoordinate(null);
    setRouteSelected(false);
    setIsNavigating(false);
    setRouteCoordinates([]);
    setRouteDistanceMeters(null);
    setRouteDurationSeconds(null);

    try {
      // Photon is used instead of calling Nominatim directly from the app.
      // Public geocoding services may rate-limit or block mobile requests.
      const params = new URLSearchParams({ q: query, limit: "5" });
      if (currentLocation) {
        params.set("lat", String(currentLocation.latitude));
        params.set("lon", String(currentLocation.longitude));
      }

      const response = await fetch(
        `https://photon.komoot.io/api/?${params.toString()}`,
        { headers: { "Accept": "application/geo+json" } }
      );

      if (!response.ok) {
        throw new Error(`Destination search returned HTTP ${response.status}.`);
      }

      const results = await response.json();
      const features = Array.isArray(results?.features) ? results.features : [];
      const places: DestinationResult[] = features
        .filter((feature: any) =>
          Array.isArray(feature?.geometry?.coordinates) &&
          feature.geometry.coordinates.length >= 2 &&
          Number.isFinite(Number(feature.geometry.coordinates[0])) &&
          Number.isFinite(Number(feature.geometry.coordinates[1]))
        )
        .map((feature: any, index: number) => {
          const properties = feature.properties ?? {};
          const name = String(
            properties.name || properties.street || properties.city || properties.state || query
          );
          const address = [
            properties.name,
            properties.street,
            properties.housenumber,
            properties.district,
            properties.city,
            properties.state,
            properties.country,
          ].filter(Boolean).map(String).filter((value, i, arr) => arr.indexOf(value) === i).join(", ");

          return {
            id: String(properties.osm_id ?? `${name}-${index}`),
            name,
            address: address || name,
            coordinate: {
              longitude: Number(feature.geometry.coordinates[0]),
              latitude: Number(feature.geometry.coordinates[1]),
            },
          };
        });

      setDestinationResults(places);

      if (places.length === 0) {
        showMessage("No destinations found", "Try a more specific place name or address.");
      }
    } catch (error) {
      console.error("Destination search failed:", error);
      showMessage(
        "Search failed",
        error instanceof Error ? error.message : "Could not search destinations. Check your internet connection."
      );
    } finally {
      setSearchingDestination(false);
    }
  }

  async function handleSelectDestination(place: DestinationResult) {
    const origin = selectedSourceCoordinate ?? currentLocation;
    if (!origin) {
      showMessage("Starting location unavailable", "Choose a starting location or allow location access to use My location.");
      return;
    }

    setDestination(place.name);
    setDestinationResults([]);
    setLoadingRoute(true);
    setSelectedDestinationCoordinate(null);
    setRouteSelected(false);
    setIsNavigating(false);
    setRouteCoordinates([]);
    setHazards([]);
    setHazardError(null);

    try {
      // OSRM expects longitude,latitude coordinate order.
      const coordinates =
        `${origin.longitude},${origin.latitude};` +
        `${place.coordinate.longitude},${place.coordinate.latitude}`;
      const url =
        `https://router.project-osrm.org/route/v1/driving/${coordinates}` +
        "?overview=full&geometries=geojson&steps=true";

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Routing service returned HTTP ${response.status}.`);
      }

      const data = await response.json();
      const route = data?.routes?.[0];

      if (data?.code !== "Ok" || !route?.geometry?.coordinates?.length) {
        throw new Error("No driving route was found for that destination.");
      }

      const points: Coordinate[] = route.geometry.coordinates.map(
        (point: [number, number]) => ({
          longitude: Number(point[0]),
          latitude: Number(point[1]),
        })
      );

      // Demo preparation: log exact coordinates sampled from the calculated route.
      const demoFractions = [0.15, 0.35, 0.55, 0.75, 0.90];
      const demoRoutePoints = demoFractions.map((fraction, index) => {
        const pointIndex = Math.max(
          0,
          Math.min(points.length - 1, Math.round((points.length - 1) * fraction)),
        );
        return { slot: index + 1, fraction, ...points[pointIndex] };
      });
      console.log("IRADS_DEMO_ROUTE_POINTS_JSON:" + JSON.stringify(demoRoutePoints));
      // Select a repeatable point on the calculated route for the temporary
      // route-anomaly test. Copy these coordinates from the Expo logs when
      // creating a controlled demo anomaly; this does not write to the database.
      const testPointIndex = Math.max(
        0,
        Math.min(points.length - 1, Math.floor((points.length - 1) * 0.75)),
      );
      console.log(
        "IRADS_TEMP_ANOMALY_ROUTE_POINT:",
        points[testPointIndex],
      );

      setRouteCoordinates(points);
      setSelectedDestinationCoordinate(place.coordinate);
      setRouteDistanceMeters(Number(route.distance));
      setRouteDurationSeconds(Number(route.duration));
      setRouteSelected(true);

      showMessage(
        "Route ready",
        `From: ${source.trim() || "My location"}\nTo: ${place.name}\nDistance: ${(Number(route.distance) / 1000).toFixed(1)} km\nEstimated driving time: ${Math.max(1, Math.round(Number(route.duration) / 60))} min`
      );
    } catch (error) {
      console.error("Route calculation failed:", error);
        showMessage(
        "Could not calculate route",
        error instanceof Error ? error.message : "Check your internet connection and try again."
      );
    } finally {
      setLoadingRoute(false);
    }
  }

  function formatRouteDistance(meters: number | null) {
    if (meters === null || !Number.isFinite(meters)) return "--";
    return meters >= 1000
      ? `${(meters / 1000).toFixed(1)} km`
      : `${Math.round(meters)} m`;
  }

  function formatRouteDuration(seconds: number | null) {
    if (seconds === null || !Number.isFinite(seconds)) return "--";
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes ? `${hours} h ${remainingMinutes} min` : `${hours} h`;
  }

  // ----------------------------------------------------------
  // NAVIGATION
  // ----------------------------------------------------------

  function handleNavigation() {
    if (!routeSelected) {
      showMessage(
        "Plan a route first",
        "Enter your destination and select GO."
      );

      return;
    }

    if (!isNavigating) {
      if (!currentLocation) {
        showMessage("GPS unavailable", "Wait for your live GPS position before navigating.");
        return;
      }
      alertedHazardsRef.current.clear();
      setNavigationProgress({ completedMeters: 0, remainingMeters: 0, percentage: 0 });
    } else if (Platform.OS !== "web") {
      Speech.stop();
    }
    setIsNavigating((previous) => !previous);
  }

  // ----------------------------------------------------------
  // MY LOCATION
  // ----------------------------------------------------------

  function handleMyLocation() {
    if (!currentLocation) {
      showMessage(
        "Location unavailable",
        "Allow location access and wait for your GPS position to load.",
      );
      return;
    }

    setRecenterRequest((request) => request + 1);
  }

  // ----------------------------------------------------------
  // SETTINGS
  // ----------------------------------------------------------

  function handleSettings() {
    setSettingsVisible(true);
  }

  // ----------------------------------------------------------
  // UI
  // ----------------------------------------------------------

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="#101820"
      />

      {/* Header */}

      <View style={styles.header}>
        <View>
          <Text style={styles.logo}>IRADS</Text>
          <Text style={styles.subtitle}>Road intelligence</Text>
        </View>

        <TouchableOpacity
          style={styles.settingsButton}
          onPress={handleSettings}
          accessibilityLabel="Settings"
        >
          <Text style={styles.settingsIcon}>{"\u2699\uFE0E"}</Text>
        </TouchableOpacity>
      </View>

      {/* Source and destination */}

      {!isNavigating ? <View style={styles.searchPanel}>
        <View style={styles.searchRow}>
          <View style={styles.sourceDot} />

          <TextInput
            style={styles.searchInput}
            value={source}
            onChangeText={(text) => {
              setSource(text);
              setSelectedSourceCoordinate(null);
              setSourceResults([]);
              setSelectedDestinationCoordinate(null);
              setRouteSelected(false);
              setIsNavigating(false);
              setRouteCoordinates([]);
              setRouteDistanceMeters(null);
              setRouteDurationSeconds(null);
              setHazards([]);
            }}
            placeholder="Starting location or My location"
            placeholderTextColor="#8995A3"
            returnKeyType="search"
            onSubmitEditing={() => void handleSearchSource()}
            accessibilityLabel="Starting location"
          />
          <View style={styles.speedChip}>
            <Text style={styles.speedChipValue}>{speedKmh === null ? "--" : speedKmh.toFixed(1)}</Text>
            <Text style={styles.speedChipUnit}>km/h</Text>
          </View>
          {source.trim().toLowerCase() === "my location" ? (
            <TouchableOpacity style={styles.sourceActionButton} onPress={handleUseMyLocation}>
              <Text style={styles.sourceActionButtonText}>GPS</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.sourceActionButton} onPress={() => void handleSearchSource()}>
              <Text style={styles.sourceActionButtonText}>SET</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.searchDivider} />

        <View style={styles.searchRow}>
          <View style={styles.destinationPin} />

          <TextInput
            style={styles.searchInput}
            value={destination}
            onChangeText={(text) => {
              setDestination(text);
              setDestinationResults([]);
              setSelectedDestinationCoordinate(null);
              setRouteSelected(false);
              setIsNavigating(false);
              setRouteCoordinates([]);
              setRouteDistanceMeters(null);
              setRouteDurationSeconds(null);
              setHazards([]);
            }}
            placeholder="Where do you want to go?"
            placeholderTextColor="#8995A3"
            returnKeyType="search"
            onSubmitEditing={handleSearchRoute}
            accessibilityLabel="Destination"
          />

          <TouchableOpacity
            style={styles.searchButton}
            onPress={handleSearchRoute}
          >
            <Text style={styles.searchButtonText}>GO</Text>
          </TouchableOpacity>
        </View>
      </View> : null}

      {isNavigating && (
        <View style={styles.navDestinationBanner}>
          <Text style={styles.navDestinationText} numberOfLines={1}>Navigating to {destination}</Text>
        </View>
      )}

      {sourceResults.length > 0 && (
        <View style={styles.destinationResultsPanel}>
          {sourceResults.map((place) => (
            <TouchableOpacity key={place.id} style={styles.destinationResultItem} onPress={() => handleSelectSource(place)}>
              <Text style={styles.destinationResultName}>{place.name}</Text>
              <Text style={styles.destinationResultAddress}>{place.address}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.destinationResultItem} onPress={handleUseMyLocation}>
            <Text style={styles.destinationResultName}>Use my current location instead</Text>
          </TouchableOpacity>
          <Text style={styles.attributionText}>Search data © OpenStreetMap contributors</Text>
        </View>
      )}

      {(searchingDestination || loadingRoute) && (
        <View style={styles.destinationResultsPanel}>
          <ActivityIndicator size="small" color="#38BDF8" />
          <Text style={styles.destinationResultText}>
            {searchingDestination ? "Searching OpenStreetMap..." : "Calculating driving route..."}
          </Text>
        </View>
      )}

      {destinationResults.length > 0 && (
        <View style={styles.destinationResultsPanel}>
          {destinationResults.map((place) => (
            <TouchableOpacity
              key={place.id}
              style={styles.destinationResultItem}
              onPress={() => void handleSelectDestination(place)}
            >
              <Text style={styles.destinationResultName}>{place.name}</Text>
              <Text style={styles.destinationResultAddress}>{place.address}</Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.attributionText}>
            Search data © OpenStreetMap contributors
          </Text>
        </View>
      )}

      {/* Map */}

      <View style={styles.mapContainer}>
        {/* Show the live GPS marker and follow the rider while navigating. */}
        <IRADSMapWithDestination
          currentLocation={currentLocation}
          isNavigating={isNavigating}
          initialCenter={mapCenter}
          routeSelected={routeSelected}
          showHeatmap={showHeatmap}
          route={routeCoordinates}
          hazards={mapHazards}
          destinationCoordinate={selectedDestinationCoordinate}
          destinationLabel={destination || "Destination"}
          recenterRequest={recenterRequest}
        />

        {loadingLocation && (
          <View style={styles.locationBadge}>
            <ActivityIndicator
              size="small"
              color="#38BDF8"
            />

            <Text style={styles.locationBadgeText}>
              Locating you...
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.myLocationButton}
          onPress={handleMyLocation}
          accessibilityLabel="Show my location"
        >
          <View style={styles.locationCrosshair}>
            <View style={styles.crosshairRing} />
            <View style={styles.crosshairCenter} />
            <View style={[styles.crosshairTick, styles.crosshairTop]} />
            <View style={[styles.crosshairTick, styles.crosshairBottom]} />
            <View style={[styles.crosshairTickHorizontal, styles.crosshairLeft]} />
            <View style={[styles.crosshairTickHorizontal, styles.crosshairRight]} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Navigation essentials stay visible without scrolling. */}
      {isNavigating && routeSelected && (
        <View style={styles.activeNavigationBar}>
          <View style={styles.activeNavigationStats}>
            <View style={styles.activeNavigationMetric}>
              <Text style={styles.activeNavigationLabel}>DISTANCE LEFT</Text>
              <Text style={styles.activeNavigationValue}>
                {navigationOnRoute
                  ? formatRouteDistance(navigationProgress.remainingMeters)
                  : "Off route"}
              </Text>
            </View>
            <View style={styles.activeNavigationMetric}>
              <Text style={styles.activeNavigationLabel}>SPEED</Text>
              <Text style={styles.activeNavigationValue}>
                {speedKmh === null ? "--" : speedKmh.toFixed(1)}
                <Text style={styles.activeNavigationUnit}> km/h</Text>
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.quickStopButton}
            onPress={handleNavigation}
            accessibilityRole="button"
            accessibilityLabel="Stop navigation"
          >
            <Text style={styles.quickStopText}>Stop navigation</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom panel */}

      {!isNavigating && <View style={styles.bottomPanel}>
        <View style={styles.heatmapRow}>
          <View style={styles.heatmapTextContainer}>
            <Text style={styles.heatmapTitle}>
              Road anomaly heatmap
            </Text>

            <Text style={styles.heatmapSubtitle}>
              Display nearby reported road anomalies
            </Text>
          </View>

          <Switch
            value={showHeatmap}
            onValueChange={setShowHeatmap}
            trackColor={{
              false: "#344054",
              true: "#0F766E",
            }}
            thumbColor={
              showHeatmap ? "#5EEAD4" : "#D0D5DD"
            }
          />
        </View>

        {/* Live anomaly status */}

        <View style={styles.anomalyStatus}>
          {loadingHazards ? (
            <>
              <ActivityIndicator
                size="small"
                color="#38BDF8"
              />

              <Text style={styles.statusText}>
                {routeSelected
                  ? "Loading anomalies along your route..."
                  : "Loading nearby road anomalies..."}
              </Text>
            </>
          ) : hazardError ? (
            <Text style={styles.errorText}>
              Could not load anomalies: {hazardError}
            </Text>
          ) : (
            <Text style={styles.statusText}>
              {routeSelected
                ? `${routeHazards.length} anomalies along your route ahead`
                : `${nearbyConfirmedHazards.length} confirmed anomalies within 10 km`}
            </Text>
          )}
        </View>

        <View style={styles.routeCard}>
          <View style={styles.routeHeader}>
            <Text style={styles.routeTitle}>
              {routeSelected
                ? "Selected route"
                : "Plan your journey"}
            </Text>

            {routeSelected && (
              <View style={styles.routeBadge}>
                <Text style={styles.routeBadgeText}>
                  LIVE ROUTE
                </Text>
              </View>
            )}
          </View>

          {routeSelected ? (
            <>
              <View style={styles.routeStats}>
                <View>
                  <Text style={styles.routeDistance}>
                    {formatRouteDistance(routeDistanceMeters)}
                  </Text>

                  <Text style={styles.statLabel}>
                    Distance
                  </Text>
                </View>

                <View>
                  <Text style={styles.routeDistance}>
                    {formatRouteDuration(routeDurationSeconds)}
                  </Text>

                  <Text style={styles.statLabel}>
                    Estimated time
                  </Text>
                </View>

                <View>
                  <Text style={styles.routeDistance}>
                    {routeHazards.length}
                  </Text>

                  <Text style={styles.statLabel}>
                    Anomalies on route
                  </Text>
                </View>
              </View>


            </>
          ) : (
            <Text style={styles.emptyRouteText}>
              Search for a destination to explore route
              information.
            </Text>
          )}

          {isNavigating && routeSelected && (
            <View style={{ paddingVertical: 12 }}>
              <Text style={styles.routeDistance}>
                Journey completed: {navigationProgress.percentage}%
              </Text>
              <Text style={styles.statusText}>
                Travelled: {formatRouteDistance(navigationProgress.completedMeters)}
              </Text>
              <Text style={styles.statusText}>
                Remaining: {formatRouteDistance(navigationProgress.remainingMeters)}
              </Text>
              {!navigationOnRoute && (
                <Text style={styles.errorText}>
                  GPS is off the selected route or unavailable. Progress and alerts paused.
                </Text>
              )}
              <View style={{ height: 8, backgroundColor: "#334155", borderRadius: 4,
                marginTop: 10, overflow: "hidden" }}>
                <View style={{ height: "100%", width: `${navigationProgress.percentage}%`,
                  backgroundColor: "#38BDF8" }} />
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.navigationButton,
              isNavigating && styles.stopNavigationButton,
            ]}
            onPress={handleNavigation}
          >
            <Text style={styles.navigationButtonText}>
              {isNavigating
                ? "Stop navigation"
                : "Start navigation"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>}

      <Modal
        visible={settingsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSettingsVisible(false)}
      >
        <View style={styles.settingsBackdrop}>
          <View style={styles.settingsSheet}>
            <View style={styles.settingsSheetHeader}>
              <Text style={styles.settingsSheetTitle}>Settings</Text>
              <TouchableOpacity
                onPress={() => setSettingsVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Close settings"
                style={styles.settingsCloseButton}
              >
                <Text style={styles.settingsCloseText}>X</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.settingsOptionRow}>
              <View style={styles.settingsOptionDetails}>
                <Text style={styles.settingsOptionTitle}>Show road anomalies</Text>
                <Text style={styles.settingsOptionHint}>Display reported hazards on the map</Text>
              </View>
              <Switch
                value={showHeatmap}
                onValueChange={setShowHeatmap}
                trackColor={{ false: "#344054", true: "#0F766E" }}
                thumbColor={showHeatmap ? "#5EEAD4" : "#D0D5DD"}
              />
            </View>
            <View style={styles.settingsInfoSection}>
              <Text style={styles.settingsInfoHeading}>Device status</Text>
              <Text style={styles.settingsInfoText}>GPS: {currentLocation ? "Connected" : "Unavailable"}</Text>
              <Text style={styles.settingsInfoText}>
                Speed: {speedKmh === null ? "Unavailable" : `${speedKmh.toFixed(1)} km/h`}
              </Text>
              <Text style={styles.settingsInfoText}>Navigation: {isNavigating ? "Active" : "Inactive"}</Text>
            </View>
            <Text style={styles.settingsFootnote}>
              Alert preferences are not available yet.
            </Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#101820",
  },

  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  logo: {
    fontSize: 25,
    fontWeight: "800",
    color: "#F8FAFC",
    letterSpacing: 2,
  },

  subtitle: {
    color: "#94A3B8",
    fontSize: 12,
    marginTop: 2,
  },

  settingsButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#1E293B",
    alignItems: "center",
    justifyContent: "center",
  },

  settingsIcon: {
    fontSize: 27,
    lineHeight: 33,
    color: "#F8FAFC",
    textAlign: "center",
    includeFontPadding: false,
  },

  searchPanel: {
    marginHorizontal: 14,
    marginBottom: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: "#1E293B",
  },

  searchRow: {
    minHeight: 49,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  sourceDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: "#38BDF8",
  },

  destinationPin: {
    width: 11,
    height: 11,
    borderRadius: 3,
    backgroundColor: "#F59E0B",
  },

  searchInput: {
    flex: 1,
    color: "#F8FAFC",
    fontSize: 14,
    paddingVertical: 10,
    outlineStyle: "none",
  } as any,

  searchDivider: {
    height: 1,
    backgroundColor: "#334155",
    marginLeft: 23,
  },

  sourceActionButton: {
    backgroundColor: "#334155",
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },

  sourceActionButtonText: {
    color: "#F8FAFC",
    fontWeight: "700",
    fontSize: 12,
  },

  searchButton: {
    backgroundColor: "#0F766E",
    borderRadius: 9,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },

  searchButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },

  destinationResultsPanel: {
    backgroundColor: "#18232F",
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 2,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    zIndex: 10,
    elevation: 5,
  },

  destinationResultItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#344054",
  },

  destinationResultName: {
    color: "#F8FAFC",
    fontSize: 15,
    fontWeight: "600",
  },

  destinationResultAddress: {
    color: "#A7B3C2",
    fontSize: 12,
    marginTop: 4,
  },

  destinationResultText: {
    color: "#F8FAFC",
    fontSize: 13,
    marginTop: 8,
  },

  attributionText: {
    color: "#A7B3C2",
    fontSize: 10,
    marginTop: 10,
    textAlign: "center",
  },

  mapContainer: {
    flex: 1,
    minHeight: 220,
    marginHorizontal: 10,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#1E293B",
    position: "relative",
  },

  locationBadge: {
    position: "absolute",
    top: 12,
    left: 12,
    backgroundColor: "#101820",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  locationBadgeText: {
    color: "#F8FAFC",
    fontSize: 12,
  },

  myLocationButton: {
    position: "absolute",
    bottom: 18,
    right: 14,
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },

  locationCrosshair: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  crosshairRing: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2.5,
    borderColor: "#0F766E",
  },
  crosshairCenter: {
    position: "absolute",
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#0F766E",
  },
  crosshairTick: {
    position: "absolute",
    width: 2.5,
    height: 6,
    backgroundColor: "#0F766E",
  },
  crosshairTop: { top: 0 },
  crosshairBottom: { bottom: 0 },
  crosshairTickHorizontal: {
    position: "absolute",
    height: 2.5,
    width: 6,
    backgroundColor: "#0F766E",
  },
  crosshairLeft: { left: 0 },
  crosshairRight: { right: 0 },
  settingsBackdrop: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 22,
    backgroundColor: "rgba(0, 0, 0, 0.68)",
  },
  settingsSheet: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    padding: 20,
  },
  settingsSheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 22,
  },
  settingsSheetTitle: {
    fontSize: 23,
    fontWeight: "700",
    color: "#F8FAFC",
  },
  settingsCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#334155",
    alignItems: "center",
    justifyContent: "center",
  },
  settingsCloseText: { color: "#F8FAFC", fontSize: 16, fontWeight: "700" },
  settingsOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 18,
    gap: 12,
  },
  settingsOptionDetails: { flex: 1 },
  settingsOptionTitle: { color: "#F8FAFC", fontSize: 16, fontWeight: "600" },
  settingsOptionHint: { color: "#94A3B8", fontSize: 12, marginTop: 4 },
  settingsInfoSection: {
    borderTopWidth: 1,
    borderTopColor: "#334155",
    paddingTop: 16,
    gap: 9,
  },
  settingsInfoHeading: { color: "#F8FAFC", fontWeight: "700", fontSize: 15 },
  settingsInfoText: { color: "#CBD5E1", fontSize: 14 },
  settingsFootnote: { color: "#94A3B8", fontSize: 12, marginTop: 20 },

  navDestinationBanner: {
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#1E293B",
    borderRadius: 12,
  },
  navDestinationText: {
    color: "#F8FAFC",
    fontSize: 15,
    fontWeight: "700",
  },
  speedChip: {
    minWidth: 60,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  speedChipValue: {
    color: "#F8FAFC",
    fontSize: 16,
    fontWeight: "800",
  },
  speedChipUnit: {
    color: "#94A3B8",
    fontSize: 10,
  },
  activeNavigationBar: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    marginHorizontal: 10,
    marginTop: 10,
    marginBottom: 10,
    padding: 12,
  },
  activeNavigationStats: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 10,
  },
  activeNavigationMetric: {
    flex: 1,
    paddingHorizontal: 10,
  },
  activeNavigationLabel: {
    color: "#94A3B8",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  activeNavigationValue: {
    color: "#F8FAFC",
    fontSize: 27,
    fontWeight: "800",
    marginTop: 2,
  },
  activeNavigationUnit: {
    fontSize: 12,
    fontWeight: "500",
    color: "#CBD5E1",
  },
  quickStopButton: {
    backgroundColor: "#B91C1C",
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  quickStopText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 16,
  },

  bottomPanel: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
  },

  heatmapRow: {
    minHeight: 65,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
  },

  heatmapTextContainer: {
    flex: 1,
  },

  heatmapTitle: {
    fontSize: 14,
    color: "#F8FAFC",
    fontWeight: "600",
  },

  heatmapSubtitle: {
    color: "#94A3B8",
    fontSize: 11,
    marginTop: 4,
  },

  anomalyStatus: {
    minHeight: 28,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  statusText: {
    color: "#94A3B8",
    fontSize: 11,
  },

  errorText: {
    color: "#F87171",
    fontSize: 11,
    flexShrink: 1,
  },

  routeCard: {
    padding: 14,
    backgroundColor: "#1E293B",
    borderRadius: 17,
  },

  routeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  routeTitle: {
    fontSize: 15,
    color: "#F8FAFC",
    fontWeight: "700",
  },

  routeBadge: {
    backgroundColor: "#854D0E",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },

  routeBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#FEF3C7",
  },

  routeStats: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 15,
  },

  routeDistance: {
    fontSize: 19,
    fontWeight: "700",
    color: "#F8FAFC",
  },

  statLabel: {
    color: "#94A3B8",
    fontSize: 11,
    marginTop: 4,
  },

  disclaimer: {
    color: "#FBBF24",
    fontSize: 10,
    marginTop: 12,
    lineHeight: 15,
  },

  emptyRouteText: {
    color: "#94A3B8",
    fontSize: 12,
    marginTop: 12,
    lineHeight: 18,
  },

  navigationButton: {
    height: 47,
    marginTop: 15,
    borderRadius: 12,
    backgroundColor: "#0F766E",
    alignItems: "center",
    justifyContent: "center",
  },

  stopNavigationButton: {
    backgroundColor: "#B91C1C",
  },

  navigationButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
});
