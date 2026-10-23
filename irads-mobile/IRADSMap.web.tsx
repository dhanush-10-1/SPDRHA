import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import L from "leaflet";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

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
  currentLocation: Coordinate | null;
  initialCenter: Coordinate;
  routeSelected: boolean;
  showHeatmap: boolean;
  route: Coordinate[];
  hazards: Hazard[];
  destinationCoordinate?: Coordinate | null;
  destinationLabel?: string;
};

// Red teardrop pin with a white centre; its anchor is at the pointed tip.
const destinationIcon = L.divIcon({
  className: "irads-destination-pin-wrapper",
  html: `
    <div style="
      width:32px;height:32px;position:relative;transform:rotate(-45deg);
      background:#ef4444;border:2px solid #ffffff;border-radius:50% 50% 50% 0;
      box-shadow:0 2px 8px rgba(0,0,0,.45);box-sizing:border-box;
      display:flex;align-items:center;justify-content:center;
    ">
      <div style="width:9px;height:9px;background:#ffffff;border-radius:50%;"></div>
    </div>
  `,
  iconSize: [36, 42],
  iconAnchor: [18, 40],
  popupAnchor: [0, -38],
});

function ViewportController({
  initialCenter,
  routeSelected,
  route,
  destinationCoordinate,
}: Pick<
  IRADSMapProps,
  "initialCenter" | "routeSelected" | "route" | "destinationCoordinate"
>) {
  const map = useMap();

  // Fit the full route only when a route is selected/changed. GPS updates won't
  // continually reset the viewport while the user is navigating.
  useEffect(() => {
    if (!routeSelected || route.length < 2) return;

    const bounds = L.latLngBounds(
      route.map((point) => [point.latitude, point.longitude] as [number, number]),
    );
    if (destinationCoordinate) {
      bounds.extend([
        destinationCoordinate.latitude,
        destinationCoordinate.longitude,
      ]);
    }
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
  }, [map, routeSelected, route, destinationCoordinate]);

  // Before a route is selected, keep the map centered on the live location.
  useEffect(() => {
    if (routeSelected) return;
    map.setView(
      [initialCenter.latitude, initialCenter.longitude],
      Math.max(map.getZoom(), 13),
    );
  }, [map, routeSelected, initialCenter.latitude, initialCenter.longitude]);

  return null;
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
}: IRADSMapProps) {
  const routeLatLngs = route.map(
    (point) => [point.latitude, point.longitude] as [number, number],
  );

  return (
    <View style={styles.container}>
      <MapContainer
        center={[initialCenter.latitude, initialCenter.longitude]}
        zoom={13}
        scrollWheelZoom
        style={styles.map}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <ViewportController
          initialCenter={initialCenter}
          routeSelected={routeSelected}
          route={route}
          destinationCoordinate={destinationCoordinate}
        />

        {routeSelected && routeLatLngs.length >= 2 && (
          <Polyline
            positions={routeLatLngs}
            pathOptions={{ color: "#38bdf8", weight: 5, opacity: 0.95 }}
          />
        )}

        {currentLocation && (
          <>
            <CircleMarker
              center={[currentLocation.latitude, currentLocation.longitude]}
              radius={8}
              pathOptions={{
                color: "#ffffff",
                weight: 2,
                fillColor: "#0284c7",
                fillOpacity: 1,
              }}
            >
              <Popup>Your current location</Popup>
            </CircleMarker>
            <CircleMarker
              center={[currentLocation.latitude, currentLocation.longitude]}
              radius={16}
              pathOptions={{
                color: "#0284c7",
                weight: 2,
                opacity: 0.55,
                fillOpacity: 0,
              }}
            />
          </>
        )}

        {showHeatmap && hazards.map((hazard) => {
          const isPothole = hazard.type === "POTHOLE";
          const color = isPothole ? "#ef4444" : "#f59e0b";
          const confidence = Math.max(0, Math.min(1, hazard.confidence || hazard.intensity || 0));
          return (
            <React.Fragment key={hazard.id}>
              <CircleMarker
                center={[hazard.latitude, hazard.longitude]}
                radius={10 + confidence * 4}
                pathOptions={{
                  color,
                  weight: 2,
                  fillColor: color,
                  fillOpacity: 0.48,
                }}
              >
                <Popup>
                  <strong>{isPothole ? "Pothole" : "Speed breaker"}</strong>
                  <br />Confidence: {(confidence * 100).toFixed(0)}%
                </Popup>
              </CircleMarker>
              <CircleMarker
                center={[hazard.latitude, hazard.longitude]}
                radius={4}
                pathOptions={{
                  color: "#ffffff",
                  weight: 1,
                  fillColor: color,
                  fillOpacity: 1,
                }}
              />
            </React.Fragment>
          );
        })}

        {destinationCoordinate && (
          <Marker
            position={[
              destinationCoordinate.latitude,
              destinationCoordinate.longitude,
            ]}
            icon={destinationIcon}
            zIndexOffset={2000}
          >
            <Popup>
              <strong>Destination</strong>
              <br />{destinationLabel}
            </Popup>
          </Marker>
        )}
      </MapContainer>
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
    backgroundColor: "#e5e7eb",
  },
});
