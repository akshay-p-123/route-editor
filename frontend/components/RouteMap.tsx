"use client";

import { useRef, useCallback, useEffect, useMemo, useState } from "react";
import Map, {
  Source,
  Layer,
  Marker,
  NavigationControl,
} from "react-map-gl/maplibre";
import type { MapRef, LayerProps, MarkerDragEvent } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useQuery } from "@tanstack/react-query";
import { useEditorStore } from "@/store/editorStore";
import { mtd, type ShapePoint } from "@/lib/api";
import { buildStopMap, nearestStop, buildModifiedGeometry, routeWithOSRM } from "@/lib/stopUtils";

const INITIAL_VIEW = { longitude: -88.2272, latitude: 40.1164, zoom: 13 };

// 1 km drag-snap radius (squared degrees)
const DRAG_SNAP_DIST = 0.0001;

interface RouteMapProps {
  shapePoints: ShapePoint[];
  routeColor: string;
}

// ── Layer specs ───────────────────────────────────────────────────────────────

const originalLineLayer: LayerProps = {
  id: "original-line",
  type: "line",
  paint: {
    "line-color": "#9ca3af",
    "line-width": 3,
    "line-dasharray": [4, 3],
    "line-opacity": 0.7,
  },
};

const modifiedLineLayer: LayerProps = {
  id: "modified-line",
  type: "line",
  paint: {
    "line-color": ["get", "color"],
    "line-width": 4,
    "line-opacity": 0.95,
  },
};

const plainLineLayer: LayerProps = {
  id: "route-line",
  type: "line",
  paint: {
    "line-color": ["get", "color"],
    "line-width": 4,
    "line-opacity": 0.9,
  },
};

// ── X marker SVG ─────────────────────────────────────────────────────────────

function XPin() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" style={{ display: "block" }}>
      <circle cx="10" cy="10" r="9" fill="#9ca3af" stroke="white" strokeWidth="1.5" opacity="0.85" />
      <line x1="6.5" y1="6.5" x2="13.5" y2="13.5" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="13.5" y1="6.5" x2="6.5" y2="13.5" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RouteMap({ shapePoints, routeColor }: RouteMapProps) {
  const mapRef = useRef<MapRef>(null);
  const {
    stops,
    originalStops,
    isDirty,
    selectedStopId,
    setSelectedStopId,
    replaceStop,
  } = useEditorStore();

  // Road-following coords for the modified route, computed via OSRM.
  // Falls back to shape-segment approach if OSRM is unavailable.
  const [modifiedCoords, setModifiedCoords] = useState<[number, number][] | null>(null);

  // Reuse the cached stops query (same key as RoutePicker — no extra fetch)
  const { data: stopsData } = useQuery({
    queryKey: ["mtd-stops"],
    queryFn: () => mtd.stops(),
    staleTime: 10 * 60 * 1000,
  });

  const stopMap = useMemo(
    () => buildStopMap(stopsData?.result ?? []),
    [stopsData]
  );

  // ── OSRM routing for modified line ──────────────────────────────────────────
  useEffect(() => {
    if (!isDirty || stops.length < 2) {
      setModifiedCoords(null);
      return;
    }
    // Immediately show the shape-segment approximation so the old path
    // disappears right away, then refine with OSRM after the debounce.
    setModifiedCoords(buildModifiedGeometry(stops, shapePoints));

    const timer = setTimeout(async () => {
      const waypoints = stops.map((s) => ({ lat: s.stop_lat, lon: s.stop_lon }));
      const osrm = await routeWithOSRM(waypoints);
      if (osrm) setModifiedCoords(osrm);
      // If OSRM fails, keep the shape-segment version already showing
    }, 400);
    return () => clearTimeout(timer);
  }, [isDirty, stops, shapePoints]);

  // ── Diff sets ───────────────────────────────────────────────────────────────
  const origIdSet = useMemo(
    () => new Set(originalStops.map((s) => s.stop_id).filter(Boolean) as string[]),
    [originalStops]
  );
  const currIdSet = useMemo(
    () => new Set(stops.map((s) => s.stop_id).filter(Boolean) as string[]),
    [stops]
  );

  // ── Nearby stop suggestions ─────────────────────────────────────────────────
  // When a stop is selected, surface nearby MTD stops as replacement candidates.
  // ~500 m radius (0.000025 squared degrees). Excludes stops already in the route.
  const NEARBY_DIST = 0.0004; // ~2 km radius

  const selectedStop = useMemo(
    () => stops.find((s) => s.stop_id === selectedStopId) ?? null,
    [stops, selectedStopId]
  );

  const nearbyStops = useMemo(() => {
    if (!selectedStop?.stop_id) return [];
    const results: Array<{ id: string; name: string; lat: number; lon: number }> = [];
    for (const [id, info] of stopMap) {
      if (currIdSet.has(id)) continue; // already in route
      const d =
        (info.lat - selectedStop.stop_lat) ** 2 +
        (info.lon - selectedStop.stop_lon) ** 2;
      if (d < NEARBY_DIST && d > 0) {
        results.push({ id, ...info });
      }
    }
    // Sort closest first
    results.sort((a, b) => {
      const da =
        (a.lat - selectedStop.stop_lat) ** 2 +
        (a.lon - selectedStop.stop_lon) ** 2;
      const db =
        (b.lat - selectedStop.stop_lat) ** 2 +
        (b.lon - selectedStop.stop_lon) ** 2;
      return da - db;
    });
    return results.slice(0, 20); // cap at 20 suggestions
  }, [selectedStop, stopMap, currIdSet]);

  // Original stops that are no longer in the current route → gray X
  const removedStops = useMemo(
    () => (isDirty ? originalStops.filter((s) => s.stop_id && !currIdSet.has(s.stop_id)) : []),
    [isDirty, originalStops, currIdSet]
  );

  // ── GeoJSON ─────────────────────────────────────────────────────────────────

  // Original shape (gray dashed) — only shown when edits exist
  const originalLineGeoJSON = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: isDirty && shapePoints.length > 0 ? [{
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: shapePoints.map((p) => [
          Number(p.coordinates?.longitude ?? 0),
          Number(p.coordinates?.latitude ?? 0),
        ]),
      },
      properties: {},
    }] : [],
  }), [isDirty, shapePoints]);

  // Modified route — OSRM road-following coords (or shape-segment fallback).
  const modifiedLineGeoJSON = useMemo(() => {
    const coords = isDirty && modifiedCoords && modifiedCoords.length > 1
      ? modifiedCoords
      : [];
    return {
      type: "FeatureCollection" as const,
      features: coords.length > 1 ? [{
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: coords },
        properties: { color: `#${routeColor}` },
      }] : [],
    };
  }, [isDirty, modifiedCoords, routeColor]);

  // Plain route (no edits) — original shape in route color
  const plainLineGeoJSON = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: !isDirty && shapePoints.length > 0 ? [{
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: shapePoints.map((p) => [
          Number(p.coordinates?.longitude ?? 0),
          Number(p.coordinates?.latitude ?? 0),
        ]),
      },
      properties: { color: `#${routeColor}` },
    }] : [],
  }), [isDirty, shapePoints, routeColor]);

  // ── Fit bounds ──────────────────────────────────────────────────────────────
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

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleStopClick = useCallback(
    (stopId: string) => setSelectedStopId(selectedStopId === stopId ? null : stopId),
    [selectedStopId, setSelectedStopId]
  );

  const handleNearbyClick = useCallback(
    (nearby: { id: string; name: string; lat: number; lon: number }) => {
      if (!selectedStopId) return;
      replaceStop(selectedStopId, {
        stopId: nearby.id,
        name: nearby.name,
        lat: nearby.lat,
        lon: nearby.lon,
      });
      setSelectedStopId(null);
    },
    [selectedStopId, replaceStop, setSelectedStopId]
  );

  const handleDragEnd = useCallback(
    (e: MarkerDragEvent, oldStopId: string) => {
      const lat = e.lngLat.lat;
      const lon = e.lngLat.lng;
      const snap = nearestStop(lat, lon, stopMap, new Set([oldStopId]), DRAG_SNAP_DIST);
      if (snap) {
        replaceStop(oldStopId, { stopId: snap.id, name: snap.name, lat: snap.lat, lon: snap.lon });
      }
    },
    [stopMap, replaceStop]
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Map
      ref={mapRef}
      initialViewState={INITIAL_VIEW}
      style={{ width: "100%", height: "100%" }}
      mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
    >
      <NavigationControl position="top-right" />

      {/* Original gray dashed line (shown when edits exist) */}
      <Source id="original-line" type="geojson" data={originalLineGeoJSON}>
        <Layer {...originalLineLayer} />
      </Source>

      {/* Modified colored line through current stops (shown when edits exist) */}
      <Source id="modified-line" type="geojson" data={modifiedLineGeoJSON}>
        <Layer {...modifiedLineLayer} />
      </Source>

      {/* Plain colored route line (no edits) */}
      <Source id="route-line" type="geojson" data={plainLineGeoJSON}>
        <Layer {...plainLineLayer} />
      </Source>

      {/* Nearby stop suggestions — shown when a stop is selected */}
      {nearbyStops.map((nearby) => (
        <Marker
          key={`nearby-${nearby.id}`}
          longitude={nearby.lon}
          latitude={nearby.lat}
          anchor="center"
        >
          <button
            onClick={() => handleNearbyClick(nearby)}
            title={nearby.name}
            className="group relative flex items-center justify-center focus:outline-none"
          >
            {/* Diamond shape */}
            <span
              className="block rotate-45 border-2 border-white shadow-md transition-transform group-hover:scale-125"
              style={{
                width: 12,
                height: 12,
                backgroundColor: "#f59e0b",
                boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
              }}
            />
            {/* Tooltip */}
            <span className="pointer-events-none absolute bottom-full mb-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-0.5 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity">
              {nearby.name}
            </span>
          </button>
        </Marker>
      ))}

      {/* Gray X markers for removed/replaced stops */}
      {removedStops.map((stop, idx) => (
        <Marker
          key={`removed-${stop.stop_id ?? idx}`}
          longitude={stop.stop_lon}
          latitude={stop.stop_lat}
          anchor="center"
        >
          <XPin />
        </Marker>
      ))}

      {/* Current stop pins — draggable */}
      {stops.map((stop, idx) => {
        const id = stop.stop_id ?? `custom-${idx}`;
        const isSelected = id === selectedStopId;
        const isAdded = stop.isAdded || (!!stop.stop_id && !origIdSet.has(stop.stop_id));
        const color = isAdded ? "#22c55e" : `#${routeColor || "009B77"}`;
        return (
          <Marker
            key={id}
            longitude={stop.stop_lon}
            latitude={stop.stop_lat}
            anchor="center"
            draggable={!!stop.stop_id}
            onDragEnd={(e) => stop.stop_id && handleDragEnd(e, stop.stop_id)}
          >
            <button
              onClick={() => handleStopClick(id)}
              title={stop.stop_name}
              className="rounded-full border-2 border-white shadow-md transition-transform hover:scale-110 focus:outline-none cursor-grab active:cursor-grabbing"
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
