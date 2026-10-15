import React from "react";
import { StyleSheet } from "react-native";
import MapView, {
  Circle,
  Marker,
  Polyline,
  PROVIDER_DEFAULT,
} from "react-native-maps";

type Coordinate = {
  latitude: number;
  longitude: number;
};

type Hazard = Coordinate & {
  id: string;
  intensity: number;
};

type Props = {
  currentLocation: Coordinate | null;
  initialCenter: Coordinate;
  routeSelected: boolean;
  showHeatmap: boolean;
  route: Coordinate[];
  hazards: Hazard[];
};

export default function IRADSMap({
  currentLocation,
  initialCenter,
  routeSelected,
  showHeatmap,
  route,
  hazards,
}: Props) {
  return (
    <MapView
      style={StyleSheet.absoluteFill}
      provider={PROVIDER_DEFAULT}
      initialRegion={{
        ...initialCenter,
        latitudeDelta: 0.035,
        longitudeDelta: 0.035,
      }}
      showsUserLocation
      showsMyLocationButton
      showsCompass
      toolbarEnabled={false}
    >
      {currentLocation && (
        <Marker
          coordinate={currentLocation}
          title="Your location"
          pinColor="#38BDF8"
        />
      )}

      {routeSelected && (
        <Polyline
          coordinates={route}
          strokeColor="#38BDF8"
          strokeWidth={5}
        />
      )}

      {routeSelected &&
        showHeatmap &&
        hazards.map((hazard) => (
          <Circle
            key={hazard.id}
            center={{
              latitude: hazard.latitude,
              longitude: hazard.longitude,
            }}
            radius={hazard.intensity * 100}
            fillColor={
              hazard.intensity > 0.7
                ? "rgba(239,68,68,0.35)"
                : hazard.intensity > 0.4
                  ? "rgba(250,204,21,0.35)"
                  : "rgba(34,197,94,0.35)"
            }
            strokeColor="transparent"
          />
        ))}
    </MapView>
  );
}