import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  ActivityIndicator,
  Alert,
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
  type SensorSample,
} from "./sensors/roadSensor";
import * as Location from "expo-location";
import IRADSMap from "./IRADSMap";

// ============================================================
// TYPES
// ============================================================

type Coordinate = {
  latitude: number;
  longitude: number;
};

type Hazard = Coordinate & {
  id: string;
  intensity: number;
  type: "POTHOLE" | "SPEED_BREAKER" | "BUMP";
  confidence: number;
};

type NearbyAnomaliesResponse = {
  count: number;
  radius_m: number;
  anomalies: Array<{
    id: string;
    type: "POTHOLE" | "SPEED_BREAKER" | "BUMP";
    confidence: number;
    latitude: number;
    longitude: number;
    gps_accuracy_m?: number;
    speed_kmh?: number;
    detected_at?: string;
    created_at?: string;
    is_processed?: boolean;
  }>;
};

// ============================================================
// CONFIGURATION
// ============================================================

// FastAPI running on the same computer.
// For a physical phone, replace this with your computer's LAN IP.
const API_BASE_URL = "http://127.0.0.1:8001";

// Search radius for nearby road anomalies.
const SEARCH_RADIUS_METERS = 10000;

// Default map location: Bengaluru.
// This also lets you test against your existing Bengaluru data.
const INITIAL_LOCATION: Coordinate = {
  latitude: 12.9716,
  longitude: 77.5946,
};

// Temporary sample route. Real routing will be implemented later.
const SAMPLE_ROUTE: Coordinate[] = [
  { latitude: 12.9716, longitude: 77.5946 },
  { latitude: 12.973, longitude: 77.598 },
  { latitude: 12.976, longitude: 77.601 },
  { latitude: 12.979, longitude: 77.604 },
];

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

// ============================================================
// APP
// ============================================================

export default function App() {
  const [speedKmh, setSpeedKmh] = useState<number | null>(null);
  const [speedGateMessage, setSpeedGateMessage] = useState(
    "Waiting for GPS speed...",
  );
  const speedRef = useRef<number | null>(null);
  const previousPositionRef = useRef<{
    latitude: number;
    longitude: number;
    timestamp: number;
    accuracy: number | null;
  } | null>(null);
  const [currentLocation, setCurrentLocation] =
    useState<Coordinate | null>(null);

  const [source, setSource] = useState("My location");
  const [destination, setDestination] = useState("");

  const [hazards, setHazards] = useState<Hazard[]>([]);

  const [showHeatmap, setShowHeatmap] = useState(true);
  const [routeSelected, setRouteSelected] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  const [loadingLocation, setLoadingLocation] = useState(true);
  const [loadingHazards, setLoadingHazards] = useState(false);

  const [hazardError, setHazardError] = useState<string | null>(null);

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
  // SPEED-GATED SENSOR COLLECTION
  // ----------------------------------------------------------

  useEffect(() => {
    // expo-sensors IMU collection is intended for native devices.
    if (Platform.OS === "web") {
      console.log("IMU collection is available on supported native devices.");
      return;
    }

    let samples: SensorSample[] = [];

    const stopSensors = startRoadSensorCollection((sample) => {
      const gate = checkSpeedGate(speedRef.current);

      if (!gate.allowed) {
        samples = [];
        return;
      }

      samples.push(sample);

      if (samples.length >= SENSOR_WINDOW_SIZE) {
        console.log("Eligible sensor window collected:", {
          sampleCount: samples.length,
          speedKmh:
            speedRef.current === null
              ? null
              : Number((speedRef.current * 3.6).toFixed(2)),
          firstSample: samples[0],
          lastSample: samples[samples.length - 1],
        });

        // TODO: Send this window to the trained classifier.
        samples = [];
      }
    });

    return () => {
      stopSensors();
      samples = [];
    };
  }, []);

  // ----------------------------------------------------------
  // FETCH NEARBY ANOMALIES FROM FASTAPI
  // ----------------------------------------------------------

  const fetchNearbyHazards = useCallback(
    async (location: Coordinate) => {
      setLoadingHazards(true);
      setHazardError(null);

      try {
        const params = new URLSearchParams({
          latitude: String(location.latitude),
          longitude: String(location.longitude),
          radius_m: String(SEARCH_RADIUS_METERS),
        });

        const url =
          `${API_BASE_URL}/api/v1/anomalies/raw/nearby?` +
          params.toString();

        console.log("Fetching road anomalies:", url);

        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(
            `Backend request failed with HTTP ${response.status}`
          );
        }

        const data: NearbyAnomaliesResponse = await response.json();

        if (!Array.isArray(data.anomalies)) {
          throw new Error(
            "Unexpected API response: anomalies must be an array."
          );
        }

        const fetchedHazards: Hazard[] = data.anomalies
          .filter(
            (anomaly) =>
              Number.isFinite(Number(anomaly.latitude)) &&
              Number.isFinite(Number(anomaly.longitude)) &&
              Number.isFinite(Number(anomaly.confidence)) &&
              ["POTHOLE", "SPEED_BREAKER", "BUMP"].includes(
                anomaly.type
              )
          )
          .map((anomaly) => {
            const confidence = Math.max(
              0,
              Math.min(1, Number(anomaly.confidence))
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

        setHazards(fetchedHazards);

        console.log(
          `Loaded ${fetchedHazards.length} nearby anomalies.`
        );
      } catch (error) {
        console.error("Failed to fetch nearby anomalies:", error);

        setHazardError(
          error instanceof Error
            ? error.message
            : "Could not load road anomalies."
        );

        setHazards([]);
      } finally {
        setLoadingHazards(false);
      }
    },
    []
  );

  // Fetch anomalies when the user's location becomes available.
  // If location permission is denied, use Bengaluru for testing.

  useEffect(() => {
  if (!currentLocation) {
    setHazards([]);
    setHazardError(
      loadingLocation
        ? null
        : "Location unavailable. Enable location access to find nearby anomalies."
    );
    return;
  }

  void fetchNearbyHazards(currentLocation);
}, [currentLocation, loadingLocation, fetchNearbyHazards]);

  // ----------------------------------------------------------
  // MAP CONFIGURATION
  // ----------------------------------------------------------
  const mapCenter = currentLocation ?? INITIAL_LOCATION;

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
  // ROUTE SEARCH
  // ----------------------------------------------------------

  function handleSearchRoute() {
    if (!destination.trim()) {
      showMessage(
        "Destination required",
        "Enter a destination to plan your route."
      );

      return;
    }

    // Temporary prototype behaviour.
    // Real geocoding and route calculation come next.

    setRouteSelected(true);
    setIsNavigating(false);

    showMessage(
      "Prototype route",
      "This route uses sample data. Real destination search and routing have not been connected yet."
    );
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

    setIsNavigating((previous) => !previous);
  }

  // ----------------------------------------------------------
  // MY LOCATION
  // ----------------------------------------------------------

  function handleMyLocation() {
    if (!currentLocation) {
      showMessage(
        "Location unavailable",
        "Allow location access and try again."
      );

      return;
    }

    showMessage(
      "Location available",
      `Latitude: ${currentLocation.latitude.toFixed(5)}\n` +
        `Longitude: ${currentLocation.longitude.toFixed(5)}`
    );
  }

  // ----------------------------------------------------------
  // SETTINGS
  // ----------------------------------------------------------

  function handleSettings() {
    showMessage(
      "Settings",
      "Nearby anomaly alerts and other preferences will be implemented next."
    );
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
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      {/* Source and destination */}

      <View style={styles.searchPanel}>
        <View style={styles.searchRow}>
          <View style={styles.sourceDot} />

          <TextInput
            style={styles.searchInput}
            value={source}
            onChangeText={setSource}
            placeholder="Starting location"
            placeholderTextColor="#8995A3"
            accessibilityLabel="Starting location"
          />
        </View>

        <View style={styles.searchDivider} />

        <View style={styles.searchRow}>
          <View style={styles.destinationPin} />

          <TextInput
            style={styles.searchInput}
            value={destination}
            onChangeText={setDestination}
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
      </View>

      {/* Map */}

      <View style={styles.mapContainer}>
        <IRADSMap
          currentLocation={currentLocation}
          initialCenter={mapCenter}
          routeSelected={routeSelected}
          showHeatmap={showHeatmap}
          route={SAMPLE_ROUTE}
          hazards={hazards}
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
          <Text style={styles.myLocationIcon}>◎</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom panel */}

      <View style={styles.bottomPanel}>
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
                Loading nearby road anomalies...
              </Text>
            </>
          ) : hazardError ? (
            <Text style={styles.errorText}>
              Could not load anomalies: {hazardError}
            </Text>
          ) : (
            <Text style={styles.statusText}>
              {hazards.length} reported anomalies within 10 km
            </Text>
          )}
        </View>

        {/* Live GPS speed gate */}
        <View style={styles.anomalyStatus}>
          <Text style={styles.statusText}>
            Vehicle speed: {speedKmh === null ? "Unavailable" : `${speedKmh.toFixed(1)} km/h`}
          </Text>
        </View>
        <View style={styles.anomalyStatus}>
          <Text
            style={[
              styles.statusText,
              { color: speedKmh !== null && speedKmh >= 5 ? "#5EEAD4" : "#FBBF24" },
            ]}
          >
            {speedGateMessage}
          </Text>
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
                  SAMPLE
                </Text>
              </View>
            )}
          </View>

          {routeSelected ? (
            <>
              <View style={styles.routeStats}>
                <View>
                  <Text style={styles.routeDistance}>
                    8.4 km
                  </Text>

                  <Text style={styles.statLabel}>
                    Distance
                  </Text>
                </View>

                <View>
                  <Text style={styles.routeDistance}>
                    22 min
                  </Text>

                  <Text style={styles.statLabel}>
                    Estimated time
                  </Text>
                </View>

                <View>
                  <Text style={styles.routeDistance}>
                    {hazards.length}
                  </Text>

                  <Text style={styles.statLabel}>
                    Nearby reports
                  </Text>
                </View>
              </View>

              <Text style={styles.disclaimer}>
                Route details are sample data. Anomaly count is
                fetched from the backend and is not restricted to
                the selected route.
              </Text>
            </>
          ) : (
            <Text style={styles.emptyRouteText}>
              Search for a destination to explore route
              information.
            </Text>
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
      </View>
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
    fontSize: 23,
    color: "#F8FAFC",
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

  myLocationIcon: {
    fontSize: 27,
    color: "#0F766E",
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