import React, { useEffect } from "react";
import {
  CircleMarker,
  Circle,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
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
  type?: "POTHOLE" | "SPEED_BREAKER";
  confidence?: number;
};

type Props = {
  currentLocation: Coordinate | null;
  initialCenter: Coordinate;
  routeSelected: boolean;
  showHeatmap: boolean;
  route: Coordinate[];
  hazards: Hazard[];
};

function RecenterMap({ center }: { center: Coordinate }) {
  const map = useMap();

  useEffect(() => {
    map.setView([center.latitude, center.longitude]);
  }, [center.latitude, center.longitude, map]);

  return null;
}

export default function IRADSMap({
  currentLocation,
  initialCenter,
  routeSelected,
  showHeatmap,
  route,
  hazards,
}: Props) {
  const center = currentLocation ?? initialCenter;

  return (
    <MapContainer
      center={[center.latitude, center.longitude]}
      zoom={14}
      scrollWheelZoom
      style={{
        position: "absolute",
        inset: 0,
        height: "100%",
        width: "100%",
      }}
    >
      <RecenterMap center={center} />

      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {/* Current location */}
      {currentLocation && (
        <CircleMarker
          center={[
            currentLocation.latitude,
            currentLocation.longitude,
          ]}
          radius={8}
          pathOptions={{
            color: "#0284C7",
            fillColor: "#38BDF8",
            fillOpacity: 1,
          }}
        >
          <Tooltip>You are here</Tooltip>
        </CircleMarker>
      )}

      {/* Route: displayed only after route selection */}
      {routeSelected && route.length > 0 && (
        <Polyline
          positions={route.map(
            (point): [number, number] => [
              point.latitude,
              point.longitude,
            ]
          )}
          pathOptions={{
            color: "#38BDF8",
            weight: 5,
          }}
        />
      )}

      {/* Real anomaly reports: visible before route selection */}
      {showHeatmap &&
        hazards.map((hazard) => {
          const intensity = Math.max(
            0,
            Math.min(1, hazard.intensity)
          );

          const color =
            intensity >= 0.7
              ? "#EF4444"
              : intensity >= 0.4
                ? "#EAB308"
                : "#22C55E";

          return (
            <React.Fragment key={hazard.id}>
              <Circle
                center={[
                  hazard.latitude,
                  hazard.longitude,
                ]}
                radius={Math.max(20, intensity * 100)}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: 0.3,
                  weight: 1,
                }}
              />

              <CircleMarker
                center={[
                  hazard.latitude,
                  hazard.longitude,
                ]}
                radius={5}
                pathOptions={{
                  color: "#FFFFFF",
                  weight: 1,
                  fillColor: color,
                  fillOpacity: 1,
                }}
              >
                <Tooltip>
                  <strong>
                    {(hazard.type ?? "ROAD ANOMALY").replace(
                      "_",
                      " "
                    )}
                  </strong>
                  <br />
                  Confidence:{" "}
                  {Math.round(intensity * 100)}%
                </Tooltip>
              </CircleMarker>
            </React.Fragment>
          );
        })}
    </MapContainer>
  );
}