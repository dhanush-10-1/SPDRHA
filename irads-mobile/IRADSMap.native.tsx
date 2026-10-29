import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import MapView, {
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
  type Region,
} from "react-native-maps";

type Coordinate = { latitude: number; longitude: number };
type Hazard = Coordinate & {
  id: string;
  intensity: number;
  type: "POTHOLE" | "SPEED_BREAKER";
  confidence: number;
};
type IRADSMapProps = {
  currentLocation: Coordinate | null;
  initialCenter: Coordinate;
  routeSelected: boolean;
  isNavigating?: boolean;
  showHeatmap: boolean;
  route: Coordinate[];
  hazards: Hazard[];
  destinationCoordinate?: Coordinate | null;
  destinationLabel?: string;
  recenterRequest?: number;
};

const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#17212b" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#a5b4c5" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#17212b" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#344454" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#1d2b36" }] },
  { featureType: "poi.park", elementType: "geometry.fill", stylers: [{ color: "#18372f" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#293846" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#3a4b5b" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#435365" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#253440" }] },
  { featureType: "water", elementType: "geometry.fill", stylers: [{ color: "#0c1822" }] },
];

// Find the closest point on the route and keep only the route ahead.
// Coordinates are projected into a local metre-based plane for stable GPS snapping.
function routeAhead(route: Coordinate[], location: Coordinate): Coordinate[] {
  if (route.length < 2) return route;
  const metresPerDegreeLat = 111_195;
  const metresPerDegreeLon = metresPerDegreeLat * Math.cos(location.latitude * Math.PI / 180);
  let bestDistance = Infinity;
  let bestIndex = -1;
  let bestT = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    const ax = (a.longitude - location.longitude) * metresPerDegreeLon;
    const ay = (a.latitude - location.latitude) * metresPerDegreeLat;
    const dx = (b.longitude - a.longitude) * metresPerDegreeLon;
    const dy = (b.latitude - a.latitude) * metresPerDegreeLat;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const distance = Math.hypot(ax + t * dx, ay + t * dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
      bestT = t;
    }
  }
  // Off-route GPS: preserve the route rather than erasing it unpredictably.
  if (bestDistance > 30 || bestIndex < 0) return route;
  const a = route[bestIndex];
  const b = route[bestIndex + 1];
  const snapped = {
    latitude: a.latitude + (b.latitude - a.latitude) * bestT,
    longitude: a.longitude + (b.longitude - a.longitude) * bestT,
  };
  return [snapped, ...route.slice(bestIndex + 1)];
}

export default function IRADSMap({
  currentLocation,
  initialCenter,
  routeSelected,
  isNavigating = false,
  showHeatmap,
  route,
  hazards,
  destinationCoordinate = null,
  destinationLabel = "Destination",
  recenterRequest = 0,
}: IRADSMapProps) {
  const mapRef = useRef<MapView | null>(null);
  const lastRecenterRequest = useRef(recenterRequest);
  const initialRegion: Region = {
    ...initialCenter,
    latitudeDelta: 0.055,
    longitudeDelta: 0.055,
  };
  const visibleRoute = useMemo(
    () => isNavigating && currentLocation ? routeAhead(route, currentLocation) : route,
    [isNavigating, currentLocation?.latitude, currentLocation?.longitude, route],
  );

  useEffect(() => {
    if (!routeSelected || isNavigating || route.length < 2 || !mapRef.current) return;
    const fitCoordinates = destinationCoordinate ? [...route, destinationCoordinate] : route;
    const timer = setTimeout(() => {
      mapRef.current?.fitToCoordinates(fitCoordinates, {
        edgePadding: { top: 42, right: 34, bottom: 42, left: 34 },
        animated: true,
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [routeSelected, isNavigating, route, destinationCoordinate]);

  useEffect(() => {
    if (routeSelected || !currentLocation || !mapRef.current) return;
    mapRef.current.animateToRegion({ ...currentLocation, latitudeDelta: 0.055, longitudeDelta: 0.055 }, 300);
  }, [routeSelected, currentLocation?.latitude, currentLocation?.longitude]);

  useEffect(() => {
    if (!isNavigating || !currentLocation || !mapRef.current) return;
    mapRef.current.animateToRegion({ ...currentLocation, latitudeDelta: 0.008, longitudeDelta: 0.008 }, 500);
  }, [isNavigating, currentLocation?.latitude, currentLocation?.longitude]);

  useEffect(() => {
    if (lastRecenterRequest.current === recenterRequest) return;
    lastRecenterRequest.current = recenterRequest;
    if (!currentLocation || !mapRef.current) return;
    mapRef.current.animateToRegion({ ...currentLocation, latitudeDelta: 0.008, longitudeDelta: 0.008 }, 500);
  }, [recenterRequest, currentLocation?.latitude, currentLocation?.longitude]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={initialRegion}
        customMapStyle={DARK_MAP_STYLE}
        toolbarEnabled={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        loadingEnabled
      >
        {routeSelected && visibleRoute.length >= 2 && (
          <Polyline coordinates={visibleRoute} strokeColor="#38BDF8" strokeWidth={5} lineCap="round" lineJoin="round" />
        )}
        {showHeatmap && hazards.map((hazard) => {
          const isPothole = hazard.type === "POTHOLE";
          const color = isPothole ? "#EF4444" : "#F59E0B";
          const confidence = Math.max(0, Math.min(1, Number(hazard.confidence ?? hazard.intensity) || 0));
          return (
            <React.Fragment key={hazard.id}>
              <Marker
                coordinate={hazard}
                title={isPothole ? "Pothole" : "Speed breaker"}
                description={`Confidence: ${(confidence * 100).toFixed(0)}%`}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
              >
                <View
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: color,
                    borderWidth: 2,
                    borderColor: "#FFFFFF",
                  }}
                />
              </Marker>
            </React.Fragment>
          );
        })}
        {destinationCoordinate && (
          <Marker coordinate={destinationCoordinate} title={destinationLabel} description="Selected destination" pinColor="#EF4444" zIndex={2000} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false} />
        )}
        {currentLocation && (
          <Marker coordinate={currentLocation} title="My current location" description="Live GPS position" anchor={{ x: 0.5, y: 0.5 }} zIndex={3000}>
            <View style={styles.locationOuter}><View style={styles.locationInner} /></View>
          </Marker>
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 220, width: "100%", height: "100%" },
  map: { width: "100%", height: "100%", minHeight: 220, backgroundColor: "#17212b" },
  locationOuter: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", elevation: 5 },
  locationInner: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#2563EB" },
});
