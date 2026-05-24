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
    // Dashed when suspicious (property set via GeoJSON)
    "line-dasharray": ["case", ["get", "suspicious"], ["literal", [4, 3]], ["literal", [1, 0]]],
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

// ── Direction arrow ───────────────────────────────────────────────────────────

function DirectionArrow({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" style={{ display: "block" }} className="pointer-events-none drop-shadow">
      {/* Filled arrow pointing up, rotated by parent */}
      <polygon points="11,2 19,18 11,13 3,18" fill={color} stroke="white" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

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
    isCustom,
    selectedStopId,
    setSelectedStopId,
    addStop,
    replaceStop,
    routePreviewEnabled,
    setSuspiciousRoute,
    setRouteComputing,
  } = useEditorStore();

  const [modifiedCoords, setModifiedCoords] = useState<[number, number][] | null>(null);
  // Tracks the latest OSRM request so stale responses are discarded.
  const requestIdRef = useRef(0);

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
  const hasShape = shapePoints.length > 0;
  useEffect(() => {
    // Skip OSRM only when the MTD shape is available and no edits have been made yet.
    // Saved routes with no shape (shapePoints=[]) always need OSRM to draw their line.
    if ((!isDirty && !isCustom && hasShape) || stops.length < 2 || !routePreviewEnabled) {
      setModifiedCoords(null);
      setSuspiciousRoute(false);
      setRouteComputing(false);
      return;
    }

    // Show loading indicator immediately when preview is enabled.
    setRouteComputing(true);

    // Claim this request slot. The async callback below only applies its result
    // if the slot hasn't been taken by a newer edit (race condition fix).
    const myId = ++requestIdRef.current;

    const timer = setTimeout(async () => {
      const waypoints = stops.map((s) => ({ lat: s.stop_lat, lon: s.stop_lon }));
      const result = await routeWithOSRM(waypoints);

      // Discard if a newer edit started while we were waiting
      if (requestIdRef.current !== myId) return;

      setRouteComputing(false);

      if (result) {
        if (result.suspicious) {
          // OSRM returned an unreasonably long detour — use shape-segment fallback
          setModifiedCoords(buildModifiedGeometry(stops, shapePoints));
          setSuspiciousRoute(true);
        } else {
          setModifiedCoords(result.coords);
          setSuspiciousRoute(false);
        }
      } else {
        // OSRM unavailable — fall back to shape-segment approach
        setModifiedCoords(buildModifiedGeometry(stops, shapePoints));
        setSuspiciousRoute(false);
      }
    }, 800);

    return () => {
      clearTimeout(timer);
      // If the effect is cleaned up before OSRM responds (e.g. rapid edits),
      // clear the computing indicator so it doesn't get stuck.
      setRouteComputing(false);
    };
  }, [isDirty, isCustom, hasShape, stops, shapePoints, routePreviewEnabled, setSuspiciousRoute, setRouteComputing]);

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
  const NEARBY_DIST = 0.0016; // ~4 km radius

  const selectedStop = useMemo(
    () => stops.find((s) => s.stop_id === selectedStopId) ?? null,
    [stops, selectedStopId]
  );

  const nearbyStops = useMemo(() => {
    if (!selectedStop?.stop_id) return [];
    const results: Array<{ id: string; name: string; lat: number; lon: number }> = [];
    for (const [id, info] of stopMap) {
      if (currIdSet.has(id)) continue; // already in route
      if (!info.name.includes(" (")) continue; // skip group-level entries with no direction
      const d =
        (info.lat - selectedStop.stop_lat) ** 2 +
        (info.lon - selectedStop.stop_lon) ** 2;
      if (d < NEARBY_DIST && d > 0) {
        results.push({ id, ...info });
      }
    }
    results.sort((a, b) => {
      const da =
        (a.lat - selectedStop.stop_lat) ** 2 +
        (a.lon - selectedStop.stop_lon) ** 2;
      const db =
        (b.lat - selectedStop.stop_lat) ** 2 +
        (b.lon - selectedStop.stop_lon) ** 2;
      return da - db;
    });
    return results.slice(0, 30);
  }, [selectedStop, stopMap, currIdSet]);

  // IDs already covered by nearbyStops — used to deduplicate route-group suggestions.
  const nearbyStopIds = useMemo(
    () => new Set(nearbyStops.map((s) => s.id)),
    [nearbyStops]
  );

  // Route-group suggestions: stops from the original route not currently in the edit.
  // Only shown in editing mode (isCustom=false) when a stop is selected.
  // Uses shapePoints for live MTD routes; falls back to originalStops for saved routes.
  const routeGroupStops = useMemo(() => {
    if (isCustom || !selectedStop?.stop_id) return [];
    const results: Array<{ id: string; name: string; lat: number; lon: number }> = [];
    if (shapePoints.length > 0) {
      for (const pt of shapePoints) {
        if (!pt.stopId || currIdSet.has(pt.stopId) || nearbyStopIds.has(pt.stopId)) continue;
        const info = stopMap.get(pt.stopId);
        if (!info) continue;
        results.push({ id: pt.stopId, name: info.name, lat: info.lat, lon: info.lon });
      }
    } else {
      for (const stop of originalStops) {
        if (!stop.stop_id || currIdSet.has(stop.stop_id) || nearbyStopIds.has(stop.stop_id)) continue;
        results.push({ id: stop.stop_id, name: stop.stop_name, lat: stop.stop_lat, lon: stop.stop_lon });
      }
    }
    return results;
  }, [isCustom, selectedStop, shapePoints, originalStops, stopMap, currIdSet, nearbyStopIds]);

  // Original stops that are no longer in the current route → gray X
  const removedStops = useMemo(
    () => (isDirty ? originalStops.filter((s) => s.stop_id && !currIdSet.has(s.stop_id)) : []),
    [isDirty, originalStops, currIdSet]
  );

  // ── Direction arrow ─────────────────────────────────────────────────────────
  // Placed 25% along the first segment so it sits visually next to stop 0.
  const directionArrow = useMemo(() => {
    if (stops.length < 2) return null;
    const from = stops[0];
    const to = stops[1];
    const dLat = to.stop_lat - from.stop_lat;
    const dLon = (to.stop_lon - from.stop_lon) * Math.cos((from.stop_lat * Math.PI) / 180);
    const bearingDeg = Math.atan2(dLon, dLat) * (180 / Math.PI);
    return {
      lat: from.stop_lat + 0.25 * (to.stop_lat - from.stop_lat),
      lon: from.stop_lon + 0.25 * (to.stop_lon - from.stop_lon),
      bearingDeg,
    };
  }, [stops]);

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
  // When suspicious, rendered in amber to signal the path may be inaccurate.
  const { isSuspiciousRoute } = useEditorStore();
  const modifiedLineGeoJSON = useMemo(() => {
    const coords = (isDirty || isCustom || !hasShape) && routePreviewEnabled && modifiedCoords && modifiedCoords.length > 1
      ? modifiedCoords
      : [];
    const lineColor = isSuspiciousRoute ? "#f59e0b" : `#${routeColor}`;
    return {
      type: "FeatureCollection" as const,
      features: coords.length > 1 ? [{
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: coords },
        properties: { color: lineColor, suspicious: isSuspiciousRoute },
      }] : [],
    };
  }, [isDirty, isCustom, routePreviewEnabled, modifiedCoords, routeColor, isSuspiciousRoute]);

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
    if (isDirty) return; // Don't re-fit while the user is actively editing
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
      if (isCustom) {
        // Building mode: insert a new stop after the currently selected one
        const idx = stops.findIndex((s) => s.stop_id === selectedStopId);
        addStop(
          { stopId: nearby.id, name: nearby.name, subName: null, type: 0,
            location: { latitude: nearby.lat, longitude: nearby.lon } },
          idx >= 0 ? idx : undefined
        );
      } else {
        // Editing mode: replace the selected stop with the nearby one
        if (!selectedStopId) return;
        replaceStop(selectedStopId, { stopId: nearby.id, name: nearby.name, lat: nearby.lat, lon: nearby.lon });
        setSelectedStopId(null);
      }
    },
    [isCustom, selectedStopId, stops, addStop, replaceStop, setSelectedStopId]
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

      {/* Direction arrow — 25% along the first segment */}
      {directionArrow && (
        <Marker longitude={directionArrow.lon} latitude={directionArrow.lat} anchor="center">
          <div style={{ transform: `rotate(${directionArrow.bearingDeg}deg)` }}>
            <DirectionArrow color={`#${routeColor}`} />
          </div>
        </Marker>
      )}

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
            {/* Pulse ring — building mode only */}
            {isCustom && (
              <span
                className="absolute animate-ping rounded-full opacity-30"
                style={{ width: 24, height: 24, backgroundColor: "#f59e0b" }}
              />
            )}
            {/* Diamond */}
            <span
              className="relative block rotate-45 border-2 border-white transition-transform group-hover:scale-125"
              style={{
                width: 16,
                height: 16,
                backgroundColor: isCustom ? "#f59e0b" : "#6366f1",
                boxShadow: "0 2px 6px rgba(0,0,0,0.45)",
              }}
            />
            {/* Mode indicator: + for building, → for editing */}
            <span className="pointer-events-none absolute text-white font-bold leading-none select-none" style={{ fontSize: 10 }}>
              {isCustom ? "+" : "→"}
            </span>
            {/* Tooltip */}
            <span className="pointer-events-none absolute bottom-full mb-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-0.5 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity">
              {nearby.name}
            </span>
          </button>
        </Marker>
      ))}

      {/* Route-group stop suggestions — editing mode only, shown when a stop is selected */}
      {routeGroupStops.map((stop) => (
        <Marker
          key={`route-${stop.id}`}
          longitude={stop.lon}
          latitude={stop.lat}
          anchor="center"
        >
          <button
            onClick={() => handleNearbyClick(stop)}
            title={stop.name}
            className="group relative flex items-center justify-center focus:outline-none"
          >
            <span
              className="relative block rotate-45 border-2 border-white transition-transform group-hover:scale-125"
              style={{
                width: 16,
                height: 16,
                backgroundColor: "#6366f1",
                boxShadow: "0 2px 6px rgba(0,0,0,0.45)",
              }}
            />
            <span className="pointer-events-none absolute text-white font-bold leading-none select-none" style={{ fontSize: 10 }}>
              →
            </span>
            <span className="pointer-events-none absolute bottom-full mb-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-0.5 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity">
              {stop.name}
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
