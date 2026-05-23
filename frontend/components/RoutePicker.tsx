"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEditorStore } from "@/store/editorStore";
import type { EditorStop } from "@/store/editorStore";
import { mtd, savedRoutes, type RouteGroup, type Trip, type ShapePoint, type SavedRoute } from "@/lib/api";
import { buildStopMap, nearestStop, type StopMap } from "@/lib/stopUtils";
import { validateRoute } from "@/lib/validation";
import { createClient } from "@/lib/supabase";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronRight, Plus, Pencil } from "lucide-react";

interface RoutePickerProps {
  onNewRoute: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strip the boarding-point suffix, e.g. "Green & Wright (NE Corner)" → "Green & Wright". */
function stopGroupName(name: string): string {
  const idx = name.indexOf(" (");
  return idx >= 0 ? name.substring(0, idx) : name;
}

/**
 * Remove consecutive stops that are at the same intersection.
 * The MTD shape occasionally has two boarding points from the same stop group
 * back-to-back (e.g. NE Corner immediately followed by SE Corner).
 */
function deduplicateConsecutive(stops: EditorStop[]): EditorStop[] {
  if (stops.length <= 1) return stops;
  const out: EditorStop[] = [stops[0]];
  for (let i = 1; i < stops.length; i++) {
    const prev = out[out.length - 1];
    if (stopGroupName(prev.stop_name) !== stopGroupName(stops[i].stop_name)) {
      out.push(stops[i]);
    }
  }
  return out.map((s, i) => ({ ...s, stop_sequence: i }));
}

/**
 * Build EditorStop[] from already-fetched shape points.
 * Extracts intermediate stops via stopId annotations, snaps terminals, and
 * deduplicates consecutive same-intersection stops.
 */
function buildStopsFromPoints(shapePoints: ShapePoint[], stopMap: StopMap): EditorStop[] {
  const intermediate: EditorStop[] = shapePoints
    .filter((p) => p.stopId != null)
    .flatMap((p, idx) => {
      const info = stopMap.get(p.stopId!);
      const lat = info?.lat ?? Number(p.coordinates?.latitude ?? 0);
      const lon = info?.lon ?? Number(p.coordinates?.longitude ?? 0);
      if (!lat && !lon) return [];
      return [{
        stop_sequence: idx,
        stop_id: p.stopId!,
        stop_name: info?.name ?? p.stopId!,
        stop_lat: lat,
        stop_lon: lon,
      }];
    });

  const usedIds = new Set(intermediate.map((s) => s.stop_id!));
  const result = [...intermediate];
  const firstPt = shapePoints[0];
  const lastPt  = shapePoints[shapePoints.length - 1];

  if (firstPt?.coordinates) {
    const lat = Number(firstPt.coordinates.latitude);
    const lon = Number(firstPt.coordinates.longitude);
    const snap = nearestStop(lat, lon, stopMap, usedIds);
    if (snap) {
      result.unshift({ stop_sequence: 0, stop_id: snap.id, stop_name: snap.name, stop_lat: snap.lat, stop_lon: snap.lon });
      usedIds.add(snap.id);
    }
  }

  const isCircular =
    firstPt?.coordinates && lastPt?.coordinates &&
    (Number(firstPt.coordinates.latitude)  - Number(lastPt.coordinates.latitude))  ** 2 +
    (Number(firstPt.coordinates.longitude) - Number(lastPt.coordinates.longitude)) ** 2 < 0.000001;

  if (!isCircular && lastPt?.coordinates) {
    const lat = Number(lastPt.coordinates.latitude);
    const lon = Number(lastPt.coordinates.longitude);
    const snap = nearestStop(lat, lon, stopMap, usedIds);
    if (snap) {
      result.push({ stop_sequence: result.length, stop_id: snap.id, stop_name: snap.name, stop_lat: snap.lat, stop_lon: snap.lon });
    }
  }

  result.forEach((s, i) => { s.stop_sequence = i; });
  return deduplicateConsecutive(result);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RoutePicker({ onNewRoute }: RoutePickerProps) {
  const { selectedRouteGroup, selectedDirection, loadRoute, isDirty, savedRouteId } = useEditorStore();
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => setToken(session?.access_token ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setToken(session?.access_token ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const { data: rgData, isLoading, isError } = useQuery({
    queryKey: ["mtd-route-groups"],
    queryFn: () => mtd.routeGroups(),
    staleTime: 5 * 60 * 1000,
  });

  const queryClient = useQueryClient();

  const { data: stopsData } = useQuery({
    queryKey: ["mtd-stops"],
    queryFn: () => mtd.stops(),
    staleTime: 60 * 60 * 1000, // 1 h — stops change with schedule releases, not intraday
  });

  // Lazy: only fetch trips once the user expands a route group.
  // Trips is the largest payload; deferring it keeps the initial page load fast.
  const { data: tripsData, isLoading: isTripsLoading } = useQuery({
    queryKey: ["mtd-trips"],
    queryFn: () => mtd.trips(),
    staleTime: 60 * 60 * 1000,
    enabled: expandedGroupId !== null,
  });

  const { data: mySavedRoutes } = useQuery({
    queryKey: ["saved-routes", token],
    queryFn: () => savedRoutes.list(token!),
    enabled: !!token,
    staleTime: 30 * 1000,
  });

  const customRoutes = useMemo(
    () => (mySavedRoutes ?? []).filter((r) => r.is_custom),
    [mySavedRoutes]
  );

  function handleCustomRouteOpen(route: SavedRoute) {
    const stops: EditorStop[] = route.route_stops
      .sort((a, b) => a.stop_sequence - b.stop_sequence)
      .map((s) => ({
        stop_sequence: s.stop_sequence,
        stop_id: s.stop_id ?? null,
        stop_name: s.stop_name,
        stop_lat: s.stop_lat,
        stop_lon: s.stop_lon,
      }));
    const errs = validateRoute(stops);
    useEditorStore.setState({
      selectedRouteGroup: null,
      selectedDirection: null,
      originalStops: stops,
      stops,
      shapeId: null,
      isCustom: true,
      customMeta: { name: route.name, shortName: route.short_name ?? "", color: route.color ?? "#009B77" },
      savedRouteId: route.id,
      activeRerouteId: route.reroute_id ?? null,
      isDirty: false,
      routePreviewEnabled: true,
      isSuspiciousRoute: false,
      isRouteComputing: false,
      selectedStopId: null,
      validationErrors: errs,
      isValid: errs.filter((e) => e.severity === "error").length === 0,
    });
  }

  const routeGroups = useMemo(
    () =>
      (rgData?.result ?? [])
        .slice()
        .sort((a, b) => (a.sortNumber ?? 0) - (b.sortNumber ?? 0)),
    [rgData]
  );

  /**
   * For each route group, compute the unique directions available from trips.
   * Sorted so direction id=0 (e.g. Northbound/Eastbound/Clockwise) comes first.
   */
  const directionsByGroup = useMemo(() => {
    const map = new Map<string, Array<{ name: string; dirId: number | null }>>();
    for (const trip of tripsData?.result ?? []) {
      const gid = trip.route?.routeGroupId;
      if (!gid) continue;
      if (!map.has(gid)) map.set(gid, []);
      const dirs = map.get(gid)!;
      const name = trip.direction?.name ?? "Loop";
      const dirId = trip.direction?.id != null ? Number(trip.direction.id) : null;
      if (!dirs.find((d) => d.name === name)) dirs.push({ name, dirId });
    }
    // Sort: direction id 0 first, then 1, then null (Loop/undirected)
    for (const dirs of map.values()) {
      dirs.sort((a, b) => {
        if (a.dirId === null && b.dirId === null) return 0;
        if (a.dirId === null) return 1;
        if (b.dirId === null) return -1;
        return a.dirId - b.dirId;
      });
    }
    return map;
  }, [tripsData]);

  function toggleGroup(group: RouteGroup) {
    setExpandedGroupId((prev) => (prev === group.id ? null : group.id));
  }

  async function handleDirectionSelect(group: RouteGroup, dirName: string) {
    const key = `${group.id}:${dirName}`;
    setLoadingKey(key);
    setErrorKey(null);
    try {
      const allTrips = tripsData?.result ?? [];
      const allStops = stopsData?.result ?? [];
      const stopMap = buildStopMap(allStops);

      // All trips for this direction that have a shape
      const candidates = allTrips.filter(
        (t) =>
          t.route?.routeGroupId === group.id &&
          (t.direction?.name ?? "Loop") === dirName &&
          !!t.shapeId
      );

      if (candidates.length === 0) { setErrorKey(key); return; }

      // Count how many trips use each shapeId. The most-used shapes are regular
      // full-service runs; rare shapes are short-turns or one-off service.
      const shapeCount = new Map<string, { trip: Trip; count: number }>();
      for (const trip of candidates) {
        const entry = shapeCount.get(trip.shapeId!);
        if (entry) entry.count++;
        else shapeCount.set(trip.shapeId!, { trip, count: 1 });
      }

      // Take the top 3 most-common shapes. This covers the full route + any common
      // variants without fetching every obscure short-turn shape.
      const topShapes = [...shapeCount.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);

      // Fetch those shapes in parallel, using TanStack Query so revisiting the same
      // direction costs zero extra network calls (shapes are cached for 1 hour).
      const shapeResults = await Promise.all(
        topShapes.map(async ({ trip }) => {
          const data = await queryClient.fetchQuery({
            queryKey: ["mtd-shape", trip.shapeId!],
            queryFn: () => mtd.shape(trip.shapeId!),
            staleTime: 60 * 60 * 1000,
          });
          const points = data.result?.shapePoints ?? [];
          return { trip, shapeId: trip.shapeId!, points, stopCount: points.filter((p) => p.stopId != null).length };
        })
      );

      shapeResults.sort((a, b) => b.stopCount - a.stopCount);
      const best = shapeResults[0];
      if (!best || best.stopCount === 0) { setErrorKey(key); return; }

      // Build stops from the already-fetched points — no duplicate shape fetch
      const stops = buildStopsFromPoints(best.points, stopMap);
      if (stops.length === 0) { setErrorKey(key); return; }

      loadRoute(group, dirName, stops, best.shapeId);
    } catch {
      setErrorKey(key);
    } finally {
      setLoadingKey(null);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          Routes
        </h2>
        <Button size="sm" variant="outline" onClick={onNewRoute}>
          <Plus className="w-4 h-4 mr-1" />
          New
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-4 text-xs text-destructive">
            Failed to load routes. Check your API key and backend connection.
          </div>
        ) : (
          <ul className="p-2 space-y-0.5">
            {customRoutes.map((route) => {
              const bg = route.color ?? "#009B77";
              const isActive = savedRouteId === route.id;
              return (
                <li key={`custom-${route.id}`}>
                  <button
                    onClick={() => handleCustomRouteOpen(route)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
                      isActive ? "bg-accent font-medium" : "hover:bg-accent/50"
                    }`}
                  >
                    <Badge
                      className="min-w-[2.5rem] justify-center text-xs font-bold shrink-0"
                      style={{ backgroundColor: bg, color: "#fff", borderColor: bg }}
                    >
                      <Pencil className="w-2.5 h-2.5" />
                    </Badge>
                    <span className="flex-1 text-sm leading-tight line-clamp-1">
                      {route.name}
                    </span>
                  </button>
                </li>
              );
            })}
            {routeGroups.map((group) => {
              const bg = `#${group.color ?? "009B77"}`;
              const fg = `#${group.textColor ?? "ffffff"}`;
              const routeNum = group.routes?.[0]?.number ?? "–";
              const isExpanded = expandedGroupId === group.id;
              const isActiveGroup = selectedRouteGroup?.id === group.id;
              const isModified = isActiveGroup && isDirty;
              const dirs = directionsByGroup.get(group.id ?? "") ?? [];

              return (
                <li key={group.id}>
                  {/* Route group row */}
                  <button
                    onClick={() => toggleGroup(group)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
                      isActiveGroup && !isExpanded
                        ? "bg-accent font-medium"
                        : "hover:bg-accent/50"
                    }`}
                  >
                    <Badge
                      className="min-w-[2.5rem] justify-center text-xs font-bold shrink-0"
                      style={{ backgroundColor: bg, color: fg, borderColor: bg }}
                    >
                      {routeNum}
                    </Badge>
                    <span className="flex-1 text-sm leading-tight line-clamp-1">
                      {group.routeGroupName}
                    </span>
                    {isModified && (
                      <span className="text-[10px] font-semibold text-amber-500 shrink-0">
                        Modified
                      </span>
                    )}
                    <ChevronRight
                      className={`w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                    />
                  </button>

                  {/* Direction sub-items */}
                  {isExpanded && (
                    <ul className="mt-0.5 mb-1 ml-4 space-y-0.5">
                      {isTripsLoading ? (
                        // Trips are being fetched for the first time
                        [0, 1].map((i) => (
                          <li key={i} className="px-3 py-1.5">
                            <Skeleton className="h-5 w-28" />
                          </li>
                        ))
                      ) : dirs.length === 0 ? (
                        <li className="px-3 py-1.5 text-xs text-muted-foreground">
                          No directions available
                        </li>
                      ) : (
                        dirs.map(({ name: dirName }) => {
                          const key = `${group.id}:${dirName}`;
                          const isActive =
                            isActiveGroup && selectedDirection === dirName;
                          const isLoading = loadingKey === key;
                          const hasError = errorKey === key;
                          return (
                            <li key={dirName}>
                              <button
                                onClick={() => handleDirectionSelect(group, dirName)}
                                disabled={isLoading}
                                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left text-sm transition-colors ${
                                  hasError
                                    ? "text-destructive hover:bg-destructive/10"
                                    : isActive
                                    ? "bg-accent font-medium"
                                    : "hover:bg-accent/50"
                                } disabled:opacity-50`}
                                title={hasError ? "Failed to load stops — tap to retry" : undefined}
                              >
                                <span
                                  className="w-1.5 h-1.5 rounded-full shrink-0"
                                  style={{ backgroundColor: hasError ? "#ef4444" : bg }}
                                />
                                {isLoading ? "Loading…" : hasError ? `${dirName} — retry` : dirName}
                              </button>
                            </li>
                          );
                        })
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
