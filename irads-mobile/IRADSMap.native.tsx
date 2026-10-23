import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import MapView, {
  Circle,
  Marker,
  Polyline,
  PROVIDER_DEFAULT,
  type Region,
} from "react-native-maps";

type Coordinate = {
  latitude: number;
  longitude: number;
};

type Hazard = Coordinate & {
  id: string;
  intensity?: number;
  confidence?: number | null;
  type?: string;
};

type Props = {
  currentLocation: Coordinate | null;
  initialCenter: Coordinate;
  routeSelected: boolean;
  showHeatmap: boolean;
  route: Coordinate[];
  hazards: Hazard[];
  destinationCoordinate?: Coordinate | null;
  destinationLabel?: string;
  recenterRequest?: number;
};

const DEFAULT_LATITUDE_DELTA = 0.035;
const DEFAULT_LONGITUDE_DELTA = 0.035;

function getHazardColor(type?: string): string {
  switch (type) {
    case "POTHOLE":
      return "#EF4444";
    case "SPEED_BREAKER":
      return "#F59E0B";
    case "BUMP":
      return "#A78BFA";
    default:
      return "#EF4444";
  }
}

export default function IRADSMap({
  currentLocation,
  initialCenter,
  routeSelected,
  showHeatmap,
  route,
  hazards,
  destinationCoordinate = null,
  destinationLabel = "Destination",
  recenterRequest = 0,
}: Props) {
  const mapRef = useRef<MapView | null>(null);

  const initialRegion: Region = {
    ...initialCenter,
    latitudeDelta: DEFAULT_LATITUDE_DELTA,
    longitudeDelta: DEFAULT_LONGITUDE_DELTA,
  };

  // Fit the selected route when the user calculates a route.
  useEffect(() => {
    if (!routeSelected || route.length < 2 || !mapRef.current) {
      return;
    }

    const coordinates = destinationCoordinate
      ? [...route, destinationCoordinate]
      : route;

    const timer = setTimeout(() => {
      mapRef.current?.fitToCoordinates(coordinates, {
        edgePadding: {
          top: 55,
          right: 35,
          bottom: 55,
          left: 35,
        },
        animated: true,
      });
    }, 250);

    return () => clearTimeout(timer);
  }, [routeSelected, route, destinationCoordinate]);

  // Recenter only when the user taps the location button.
  // GPS updates alone should not continuously move the camera.
  useEffect(() => {
    if (recenterRequest <= 0 || !currentLocation || !mapRef.current) {
      return;
    }

    mapRef.current.animateToRegion(
      {
        ...currentLocation,
        latitudeDelta: 0.008,
        longitudeDelta: 0.008,
      },
      500,
    );
  }, [recenterRequest]);

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      provider={PROVIDER_DEFAULT}
      initialRegion={initialRegion}
      showsUserLocation={false}
      showsMyLocationButton={false}
      showsCompass
      toolbarEnabled={false}
    >
      {/* Custom blue GPS indicator with a soft halo. */}
      {currentLocation && (
        <>
          <Circle
            center={currentLocation}
            radius={22}
            strokeColor="rgba(56,189,248,0.50)"
            strokeWidth={1}
            fillColor="rgba(56,189,248,0.18)"
            zIndex={50}
          />

          <Marker
            coordinate={currentLocation}
            title="Your current location"
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            zIndex={100}
          >
            <View style={styles.currentLocationDot} />
          </Marker>
        </>
      )}

      {/* Confirmed anomalies: coloured dots, not default map pins. */}
      {showHeatmap &&
        hazards
          .filter(
            (hazard) =>
              Number.isFinite(hazard.latitude) &&
              Number.isFinite(hazard.longitude) &&
              Math.abs(hazard.latitude) <= 90 &&
              Math.abs(hazard.longitude) <= 180,
          )
          .map((hazard) => {
            const color = getHazardColor(hazard.type);

            return (
              <Marker
                key={hazard.id}
                coordinate={{
                  latitude: hazard.latitude,
                  longitude: hazard.longitude,
                }}
                title={hazard.type?.replace("_", " ") ?? "Road anomaly"}
                description={
                  hazard.confidence == null
                    ? "Synthetic demonstration anomaly"
                    : `Confidence: ${(hazard.confidence * 100).toFixed(0)}%`
                }
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                zIndex={150}
              >
                <View
                  style={[
                    styles.anomalyDot,
                    { backgroundColor: color },
                  ]}
                />
              </Marker>
            );
          })}

      {/* Keep the blue route line. */}
      {routeSelected && route.length > 1 && (
        <Polyline
          coordinates={route}
          strokeColor="#38BDF8"
          strokeWidth={5}
          zIndex={10}
        />
      )}

      {/* The selected destination deliberately remains a red pin. */}
      {destinationCoordinate && (
        <Marker
          coordinate={destinationCoordinate}
          title={destinationLabel}
          description="Selected destination"
          pinColor="#EF4444"
          zIndex={2000}
          anchor={{ x: 0.5, y: 1 }}
        />
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({
  currentLocationDot: {
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: "#38BDF8",
    borderColor: "#FFFFFF",
    borderWidth: 2,
  },
  anomalyDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    borderColor: "#FFFFFF",
    borderWidth: 1.5,
  },
});
