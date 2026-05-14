"use client";

import { useRef, useCallback, useEffect } from "react";
import Map, { Source, Layer, Marker, NavigationControl } from "react-map-gl/mapbox";
import type { MapRef, LayerProps } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEditorStore } from "@/store/editorStore";
import type { ShapePoint } from "@/lib/api";

// Champaign-Urbana center
const INITIAL_VIEW = {
  longitude: -88.2272,
  latitude: 40.1164,
  zoom: 13,
};

interface RouteMapProps {
  shapePoints: ShapePoint[];
  routeColor: string;
}

const routeLineLayer: LayerProps = {
  id: "route-line",
  type: "line",
  paint: {
    "line-color": ["get", "color"],
    "line-width": 4,
    "line-opacity": 0.9,
  },
};

export default function RouteMap({ shapePoints, routeColor }: RouteMapProps) {
  const mapRef = useRef<MapRef>(null);
  const { stops, selectedStopId, setSelectedStopId } = useEditorStore();

  // Build GeoJSON line from shape points
  const lineGeoJSON = {
    type: "FeatureCollection" as const,
    features:
      shapePoints.length > 0
        ? [
            {
              type: "Feature" as const,
              geometry: {
                type: "LineString" as const,
                // v3: coordinates are nested as { latitude, longitude }
                coordinates: shapePoints.map((p) => [
                  Number(p.coordinates?.longitude ?? 0),
                  Number(p.coordinates?.latitude ?? 0),
                ]),
              },
              properties: { color: `#${routeColor}` },
            },
          ]
        : [],
  };

  // Fit map to stops when they change
  useEffect(() => {
    if (!mapRef.current || stops.length === 0) return;
    const lons = stops.map((s) => s.stop_lon);
    const lats = stops.map((s) => s.stop_lat);
    mapRef.current.fitBounds(
      [
        [Math.min(...lons) - 0.005, Math.min(...lats) - 0.005],
        [Math.max(...lons) + 0.005, Math.max(...lats) + 0.005],
      ],
      { padding: 60, duration: 800 }
    );
  }, [stops.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStopClick = useCallback(
    (stopId: string) => {
      setSelectedStopId(selectedStopId === stopId ? null : stopId);
    },
    [selectedStopId, setSelectedStopId]
  );

  return (
    <Map
      ref={mapRef}
      mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
      initialViewState={INITIAL_VIEW}
      style={{ width: "100%", height: "100%" }}
      mapStyle="mapbox://styles/mapbox/light-v11"
    >
      <NavigationControl position="top-right" />

      {/* Route polyline */}
      <Source id="route-line" type="geojson" data={lineGeoJSON}>
        <Layer {...routeLineLayer} />
      </Source>

      {/* Stop pins */}
      {stops.map((stop, idx) => {
        const id = stop.stop_id ?? `custom-${idx}`;
        const isSelected = id === selectedStopId;
        const color = stop.isAdded ? "#22c55e" : `#${routeColor || "009B77"}`;
        return (
          <Marker
            key={id}
            longitude={stop.stop_lon}
            latitude={stop.stop_lat}
            anchor="center"
          >
            <button
              onClick={() => handleStopClick(id)}
              title={stop.stop_name}
              className="flex items-center justify-center rounded-full border-2 border-white shadow-md transition-transform hover:scale-110 focus:outline-none"
              style={{
                width: isSelected ? 18 : 14,
                height: isSelected ? 18 : 14,
                backgroundColor: color,
                borderWidth: isSelected ? 3 : 2,
                boxShadow: isSelected
                  ? `0 0 0 3px ${color}44`
                  : "0 1px 3px rgba(0,0,0,0.3)",
              }}
            />
          </Marker>
        );
      })}
    </Map>
  );
}
