"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useEditorStore } from "@/store/editorStore";
import type { EditorStop } from "@/store/editorStore";
import { mtd, type RouteGroup, type Trip } from "@/lib/api";
import { buildStopMap, nearestStop } from "@/lib/stopUtils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronRight, Plus } from "lucide-react";

interface RoutePickerProps {
  onNewRoute: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Pick a representative trip for a direction without making any extra API
 * calls. Prefers weekday daytime trips (most complete service) using the
 * Route dayType metadata already in the RouteGroup, then falls back to the
 * first available trip.
 */
function pickBestTrip(trips: Trip[], routeGroup: RouteGroup): Trip | null {
  if (trips.length === 0) return null;
  if (trips.length === 1) return trips[0];

  // Build a set of route UUIDs that represent weekday daytime service.
  const weekdayDayIds = new Set(
    (routeGroup.routes ?? [])
      .filter(
        (r) => r.dayType?.dayPart === "Weekday" && r.dayType?.timePart === "Day"
      )
      .map((r) => r.id)
  );

  // Prefer a weekday day trip with a valid shape.
  const preferred = trips.find(
    (t) => t.shapeId && t.route?.id && weekdayDayIds.has(t.route.id)
  );
  if (preferred) return preferred;

  // Fall back to any trip that has a shape.
  return trips.find((t) => t.shapeId) ?? trips[0];
}

/** Build the EditorStop list from a shape + the stop lookup map. */
async function stopsFromShape(
  shapeId: string,
  stopMap: Map<string, { name: string; lat: number; lon: number }>
): Promise<EditorStop[]> {
  const shapeData = await mtd.shape(shapeId);
  const shapePoints = shapeData.result?.shapePoints ?? [];

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

  // Snap the first/last shape point to the nearest unclaimed stop (terminal fix).
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

  // Don't snap the last point for circular routes (first ≈ last).
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
  return result;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RoutePicker({ onNewRoute }: RoutePickerProps) {
  const { selectedRouteGroup, selectedDirection, loadRoute } = useEditorStore();
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const { data: rgData, isLoading } = useQuery({
    queryKey: ["mtd-route-groups"],
    queryFn: () => mtd.routeGroups(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: stopsData } = useQuery({
    queryKey: ["mtd-stops"],
    queryFn: () => mtd.stops(),
    staleTime: 10 * 60 * 1000,
  });

  const { data: tripsData } = useQuery({
    queryKey: ["mtd-trips"],
    queryFn: () => mtd.trips(),
    staleTime: 10 * 60 * 1000,
  });

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
    try {
      const allTrips = tripsData?.result ?? [];
      const allStops = stopsData?.result ?? [];
      const stopMap = buildStopMap(allStops);

      // All trips for this group + direction
      const candidates = allTrips.filter(
        (t) =>
          t.route?.routeGroupId === group.id &&
          (t.direction?.name ?? "Loop") === dirName &&
          !!t.shapeId
      );

      const trip = pickBestTrip(candidates, group);
      if (!trip?.shapeId) return;

      const stops = await stopsFromShape(trip.shapeId, stopMap);
      loadRoute(group, dirName, stops, trip.shapeId);
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
        ) : (
          <ul className="p-2 space-y-0.5">
            {routeGroups.map((group) => {
              const bg = `#${group.color ?? "009B77"}`;
              const fg = `#${group.textColor ?? "ffffff"}`;
              const routeNum = group.routes?.[0]?.number ?? "–";
              const isExpanded = expandedGroupId === group.id;
              const isActiveGroup = selectedRouteGroup?.id === group.id;
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
                    <ChevronRight
                      className={`w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                    />
                  </button>

                  {/* Direction sub-items */}
                  {isExpanded && (
                    <ul className="mt-0.5 mb-1 ml-4 space-y-0.5">
                      {dirs.length === 0 ? (
                        <li className="px-3 py-1.5 text-xs text-muted-foreground">
                          No directions available
                        </li>
                      ) : (
                        dirs.map(({ name: dirName }) => {
                          const key = `${group.id}:${dirName}`;
                          const isActive =
                            isActiveGroup && selectedDirection === dirName;
                          const isLoading = loadingKey === key;
                          return (
                            <li key={dirName}>
                              <button
                                onClick={() =>
                                  handleDirectionSelect(group, dirName)
                                }
                                disabled={isLoading}
                                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left text-sm transition-colors ${
                                  isActive
                                    ? "bg-accent font-medium"
                                    : "hover:bg-accent/50"
                                } disabled:opacity-50`}
                              >
                                <span
                                  className="w-1.5 h-1.5 rounded-full shrink-0"
                                  style={{ backgroundColor: bg }}
                                />
                                {isLoading ? "Loading…" : dirName}
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
