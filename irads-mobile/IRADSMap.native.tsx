import React from "react";
import { StyleSheet, View } from "react-native";
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
type?: string;
};

type Props = {
currentLocation: Coordinate | null;
initialCenter: Coordinate;
routeSelected: boolean;
showHeatmap: boolean;
route: Coordinate[];
hazards: Hazard[];
};

function getIntensityColor(intensity: number): string {
if (intensity >= 0.7) return "#EF4444"; // High: red
if (intensity >= 0.4) return "#F59E0B"; // Medium: orange
return "#22C55E"; // Low: green
}

export default function IRADSMap({
currentLocation,
initialCenter,
routeSelected,
showHeatmap,
route,
hazards,
}: Props) {
const validHazards = hazards.filter(
(hazard) =>
Number.isFinite(hazard.latitude) &&
Number.isFinite(hazard.longitude) &&
Math.abs(hazard.latitude) <= 90 &&
Math.abs(hazard.longitude) <= 180
);

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
<Marker coordinate={currentLocation} title="Your location" pinColor="#38BDF8" />
)}

  {/* Individual coloured dots for road anomalies */}
  {showHeatmap &&
    validHazards.map((hazard) => {
      const intensity = Math.max(
        0,
        Math.min(1, hazard.intensity ?? 0.5)
      );

      const color = getIntensityColor(intensity);

      return (
        <Circle
          key={hazard.id}
          center={{
            latitude: hazard.latitude,
            longitude: hazard.longitude,
          }}
          radius={12}
          fillColor={color}
          strokeColor={color}
          strokeWidth={1}
          zIndex={2}
        />
      );
    })}

  {routeSelected && route.length > 0 && (
    <Polyline
      coordinates={route}
      strokeColor="#38BDF8"
      strokeWidth={5}
    />
  )}
</MapView>

);
}