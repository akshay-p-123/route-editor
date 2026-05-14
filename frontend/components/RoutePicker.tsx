"use client";

import { useQuery } from "@tanstack/react-query";
import { useEditorStore } from "@/store/editorStore";
import type { EditorStop } from "@/store/editorStore";
import { mtd, type RouteGroup, type StopGroup } from "@/lib/api";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface RoutePickerProps {
  onNewRoute: () => void;
}

/** Flatten all stop groups + boarding points into a fast lookup map by ID. */
function buildStopMap(
  stopGroups: StopGroup[]
): Map<string, { name: string; lat: number; lon: number }> {
  const map = new Map<string, { name: string; lat: number; lon: number }>();

  for (const group of stopGroups) {
    const lat = Number(group.location?.latitude ?? 0);
    const lon = Number(group.location?.longitude ?? 0);
    const groupName = group.name ?? group.id;

    if (group.id) {
      map.set(group.id, { name: groupName, lat, lon });
    }

    for (const bp of group.boardingPoints ?? []) {
      if (!bp.id) continue;
      const bpLat = Number(bp.location?.latitude ?? lat);
      const bpLon = Number(bp.location?.longitude ?? lon);
      const displayName = bp.subName
        ? `${groupName} (${bp.subName})`
        : groupName;
      map.set(bp.id, { name: displayName, lat: bpLat, lon: bpLon });
    }
  }
  return map;
}

export default function RoutePicker({ onNewRoute }: RoutePickerProps) {
  const { selectedRouteGroup, loadRoute } = useEditorStore();

  const { data: rgData, isLoading } = useQuery({
    queryKey: ["mtd-route-groups"],
    queryFn: () => mtd.routeGroups(),
    staleTime: 5 * 60 * 1000,
  });

  // Pre-fetch all stops so we can resolve stop IDs from shape points.
  const { data: stopsData } = useQuery({
    queryKey: ["mtd-stops"],
    queryFn: () => mtd.stops(),
    staleTime: 10 * 60 * 1000,
  });

  // Pre-fetch all trips so we can find a representative trip per route group.
  const { data: tripsData } = useQuery({
    queryKey: ["mtd-trips"],
    queryFn: () => mtd.trips(),
    staleTime: 10 * 60 * 1000,
  });

  const routeGroups = (rgData?.result ?? []).slice().sort(
    (a, b) => (a.sortNumber ?? 0) - (b.sortNumber ?? 0)
  );

  async function handleSelect(group: RouteGroup) {
    const allTrips = tripsData?.result ?? [];
    const allStops = stopsData?.result ?? [];

    // Find a representative trip for this route group.
    const trip = allTrips.find((t) => t.route?.routeGroupId === group.id);
    if (!trip?.shapeId) return;

    // Fetch the shape.
    const shapeData = await mtd.shape(trip.shapeId);
    const shapePoints = shapeData.result?.shapePoints ?? [];

    // Build the stop lookup map from all stops.
    const stopMap = buildStopMap(allStops);

    // Stops are shape points with a non-null stopId, already in sequence order.
    const editorStops: EditorStop[] = shapePoints
      .filter((p) => p.stopId != null)
      .flatMap((p, idx) => {
        const info = stopMap.get(p.stopId!);
        if (!info) return [];
        return [{
          stop_sequence: idx,
          stop_id: p.stopId!,
          stop_name: info.name,
          stop_lat: info.lat,
          stop_lon: info.lon,
        }];
      });

    loadRoute(group, editorStops, trip.shapeId);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          Routes
        </h2>
        <Button size="sm" variant="outline" onClick={onNewRoute}>
          <Plus className="w-4 h-4 mr-1" />
          New
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <ul className="p-2 space-y-1">
            {routeGroups.map((group) => {
              const isActive = selectedRouteGroup?.id === group.id;
              const bg = `#${group.color ?? "009B77"}`;
              const fg = `#${group.textColor ?? "ffffff"}`;
              return (
                <li key={group.id}>
                  <button
                    onClick={() => handleSelect(group)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
                      isActive ? "bg-accent font-medium" : "hover:bg-accent/50"
                    }`}
                  >
                    <Badge
                      className="min-w-[2.5rem] justify-center text-xs font-bold shrink-0"
                      style={{ backgroundColor: bg, color: fg, borderColor: bg }}
                    >
                      {group.routes?.[0]?.number ?? "–"}
                    </Badge>
                    <span className="text-sm leading-tight line-clamp-2">
                      {group.routeGroupName}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
