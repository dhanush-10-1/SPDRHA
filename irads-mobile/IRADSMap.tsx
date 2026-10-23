import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import MapView, {
  Circle,
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
  type Region,
} from "react-native-maps";

type Coordinate = {
  latitude: number;
  longitude: number;
};

type Hazard = Coordinate & {
  id: string;
  intensity: number;
  type: "POTHOLE" | "SPEED_BREAKER";
  confidence: number;
};

type IRADSMapProps = {
  // Accepted for compatibility with App.tsx. Intentionally not drawn as a marker.
  currentLocation: Coordinate | null;
  initialCenter: Coordinate;
  routeSelected: boolean;
  showHeatmap: boolean;
  route: Coordinate[];
  hazards: Hazard[];
  destinationCoordinate?: Coordinate | null;
  destinationLabel?: string;
};

const DEFAULT_LATITUDE_DELTA = 0.055;
const DEFAULT_LONGITUDE_DELTA = 0.055;

// Dark map palette matching the IRADS interface.
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

export default function IRADSMap({
  initialCenter,
  routeSelected,
  showHeatmap,
  route,
  hazards,
  destinationCoordinate = null,
  destinationLabel = "Destination",
}: IRADSMapProps) {
  const mapRef = useRef<MapView | null>(null);

  const initialRegion: Region = {
    latitude: initialCenter.latitude,
    longitude: initialCenter.longitude,
    latitudeDelta: DEFAULT_LATITUDE_DELTA,
    longitudeDelta: DEFAULT_LONGITUDE_DELTA,
  };

  // Fit the chosen route and destination when a route is selected/changed.
  // No live-location marker is rendered; initialCenter still controls the map view.
  useEffect(() => {
    if (!routeSelected || route.length < 2 || !mapRef.current) return;

    const fitCoordinates = destinationCoordinate
      ? [...route, destinationCoordinate]
      : route;

    const timer = setTimeout(() => {
      mapRef.current?.fitToCoordinates(fitCoordinates, {
        edgePadding: { top: 42, right: 34, bottom: 42, left: 34 },
        animated: true,
      });
    }, 150);

    return () => clearTimeout(timer);
  }, [routeSelected, route, destinationCoordinate]);

  // Before route selection, keep the map centered on the current GPS coordinate.
  // This moves the camera without drawing the blue current-location point.
  useEffect(() => {
    if (routeSelected || !mapRef.current) return;
    mapRef.current.animateToRegion(
      {
        latitude: initialCenter.latitude,
        longitude: initialCenter.longitude,
        latitudeDelta: DEFAULT_LATITUDE_DELTA,
        longitudeDelta: DEFAULT_LONGITUDE_DELTA,
      },
      250,
    );
  }, [routeSelected, initialCenter.latitude, initialCenter.longitude]);

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
        {routeSelected && route.length >= 2 && (
          <Polyline
            coordinates={route}
            strokeColor="#38BDF8"
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
          />
        )}

        {showHeatmap && hazards.map((hazard) => {
          const isPothole = hazard.type === "POTHOLE";
          const color = isPothole ? "#EF4444" : "#F59E0B";
          const confidence = Math.max(
            0,
            Math.min(1, Number(hazard.confidence ?? hazard.intensity) || 0),
          );

          return (
            <React.Fragment key={hazard.id}>
              <Circle
                center={hazard}
                radius={14 + confidence * 14}
                strokeColor={color}
                strokeWidth={2}
                fillColor={`${color}55`}
              />
              <Marker
                coordinate={hazard}
                title={isPothole ? "Pothole" : "Speed breaker"}
                description={`Confidence: ${(confidence * 100).toFixed(0)}%`}
                pinColor={color}
                tracksViewChanges={false}
              />
            </React.Fragment>
          );
        })}

        {destinationCoordinate && (
          <Marker
            coordinate={destinationCoordinate}
            title={destinationLabel}
            description="Selected destination"
            pinColor="#EF4444"
            zIndex={2000}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={false}
          />
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 220,
    width: "100%",
    height: "100%",
  },
  map: {
    width: "100%",
    height: "100%",
    minHeight: 220,
    backgroundColor: "#17212b",
  },
});
