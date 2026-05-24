import type { QueryClient } from "@tanstack/react-query";
import { mtd, type RouteGroup, type ShapePoint, type Trip } from "@/lib/api";
import { nearestStop, type StopMap } from "@/lib/stopUtils";
import type { EditorStop } from "@/store/editorStore";

// ── Helpers (previously private to RoutePicker) ───────────────────────────────

function stopGroupName(name: string): string {
  const idx = name.indexOf(" (");
  return idx >= 0 ? name.substring(0, idx) : name;
}

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

export function buildStopsFromPoints(shapePoints: ShapePoint[], stopMap: StopMap): EditorStop[] {
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
  const lastPt = shapePoints[shapePoints.length - 1];

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
    (Number(firstPt.coordinates.latitude) - Number(lastPt.coordinates.latitude)) ** 2 +
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

/**
 * Build a map of routeGroupId → sorted direction list from a trip array.
 * Sorts so direction id=0 comes first, then 1, then null (Loop).
 */
export function buildDirectionsByGroup(
  trips: Trip[]
): Map<string, Array<{ name: string; dirId: number | null }>> {
  const map = new Map<string, Array<{ name: string; dirId: number | null }>>();
  for (const trip of trips) {
    const gid = trip.route?.routeGroupId;
    if (!gid) continue;
    if (!map.has(gid)) map.set(gid, []);
    const dirs = map.get(gid)!;
    const name = trip.direction?.name ?? "Loop";
    const dirId = trip.direction?.id != null ? Number(trip.direction.id) : null;
    if (!dirs.find((d) => d.name === name)) dirs.push({ name, dirId });
  }
  for (const dirs of map.values()) {
    dirs.sort((a, b) => {
      if (a.dirId === null && b.dirId === null) return 0;
      if (a.dirId === null) return 1;
      if (b.dirId === null) return -1;
      return a.dirId - b.dirId;
    });
  }
  return map;
}

/**
 * Load the best representative stops + shapeId for a given route group + direction.
 * Uses queryClient so shapes are cached under ["mtd-shape", shapeId].
 * Returns null if no suitable shape is found.
 */
export async function loadMTDRoute(
  group: RouteGroup,
  dirName: string,
  allTrips: Trip[],
  queryClient: QueryClient,
  stopMap: StopMap
): Promise<{ stops: EditorStop[]; shapeId: string } | null> {
  const candidates = allTrips.filter(
    (t) =>
      t.route?.routeGroupId === group.id &&
      (t.direction?.name ?? "Loop") === dirName &&
      !!t.shapeId
  );

  if (candidates.length === 0) return null;

  const shapeCount = new Map<string, { trip: Trip; count: number }>();
  for (const trip of candidates) {
    const entry = shapeCount.get(trip.shapeId!);
    if (entry) entry.count++;
    else shapeCount.set(trip.shapeId!, { trip, count: 1 });
  }

  const topShapes = [...shapeCount.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  const shapeResults = await Promise.all(
    topShapes.map(async ({ trip }) => {
      const data = await queryClient.fetchQuery({
        queryKey: ["mtd-shape", trip.shapeId!],
        queryFn: () => mtd.shape(trip.shapeId!),
        staleTime: 60 * 60 * 1000,
      });
      const points = data.result?.shapePoints ?? [];
      return { shapeId: trip.shapeId!, points, stopCount: points.filter((p) => p.stopId != null).length };
    })
  );

  shapeResults.sort((a, b) => b.stopCount - a.stopCount);
  const best = shapeResults[0];
  if (!best || best.stopCount === 0) return null;

  const stops = buildStopsFromPoints(best.points, stopMap);
  if (stops.length === 0) return null;

  return { stops, shapeId: best.shapeId };
}
