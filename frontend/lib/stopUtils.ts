import type { StopGroup, ShapePoint } from "@/lib/api";
import type { EditorStop } from "@/store/editorStore";

export type StopInfo = { name: string; lat: number; lon: number };
export type StopMap = Map<string, StopInfo>;

/** Strip the boarding-point suffix: "Green & Wright (NE Corner)" → "Green & Wright" */
export function stopGroupName(name: string): string {
  const idx = name.indexOf(" (");
  return idx >= 0 ? name.substring(0, idx) : name;
}

/** Flatten stop groups + boarding points into a fast id → info lookup. */
export function buildStopMap(stopGroups: StopGroup[]): StopMap {
  const map: StopMap = new Map();
  for (const group of stopGroups) {
    const lat = Number(group.location?.latitude ?? 0);
    const lon = Number(group.location?.longitude ?? 0);
    const groupName = group.name ?? group.id;
    if (group.id) map.set(group.id, { name: groupName, lat, lon });
    for (const bp of group.boardingPoints ?? []) {
      if (!bp.id) continue;
      const bpLat = Number(bp.location?.latitude ?? lat);
      const bpLon = Number(bp.location?.longitude ?? lon);
      const displayName = bp.subName ? `${groupName} (${bp.subName})` : groupName;
      map.set(bp.id, { name: displayName, lat: bpLat, lon: bpLon });
    }
  }
  return map;
}

/**
 * Return the nearest stop in the map to (lat, lon), excluding excludeIds.
 * maxDistDeg controls the cutoff (squared degrees).
 *   0.000004 ≈ 200 m  — for terminal snapping
 *   0.0001   ≈ 1 km   — for map drag snapping
 */
export function nearestStop(
  lat: number,
  lon: number,
  stopMap: StopMap,
  excludeIds: Set<string>,
  maxDistDeg = 0.000004
): (StopInfo & { id: string }) | null {
  let best: (StopInfo & { id: string }) | null = null;
  let bestDist = Infinity;
  for (const [id, info] of stopMap) {
    if (excludeIds.has(id)) continue;
    const d = (info.lat - lat) ** 2 + (info.lon - lon) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = { id, ...info };
    }
  }
  return bestDist <= maxDistDeg ? best : null;
}

export interface OSRMResult {
  coords: [number, number][];
  /**
   * True when the OSRM route is suspiciously long relative to the straight-line
   * distance between stops — indicating OSRM had to detour wildly (impossible
   * direct path, one-way streets, etc.). Callers should fall back to
   * buildModifiedGeometry and warn the user.
   *
   * Threshold: osrmDist > 3× direct dist AND osrmDist > 2 km absolute.
   */
  suspicious: boolean;
}

/** Straight-line distance in metres between consecutive stops (Euclidean approx). */
function directDistMeters(stops: Array<{ lat: number; lon: number }>): number {
  let total = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const dlat = (stops[i + 1].lat - stops[i].lat) * 111_000;
    const dlon = (stops[i + 1].lon - stops[i].lon) * 85_000; // cos(40°) × 111k
    total += Math.sqrt(dlat ** 2 + dlon ** 2);
  }
  return total;
}

/**
 * Route through a list of stops using the public OSRM driving API.
 * Returns road-following coordinates plus a `suspicious` flag, or null on failure.
 */
export async function routeWithOSRM(
  stops: Array<{ lat: number; lon: number }>
): Promise<OSRMResult | null> {
  if (stops.length < 2) return null;
  const coords = stops.map((s) => `${s.lon},${s.lat}`).join(";");
  try {
    const resp = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.code !== "Ok" || !data.routes?.[0]) return null;

    const route = data.routes[0];
    const osrmDist: number = route.distance ?? Infinity; // metres
    const directDist = directDistMeters(stops);
    const suspicious = osrmDist > 2000 && osrmDist > 3 * directDist;

    return {
      coords: route.geometry.coordinates as [number, number][],
      suspicious,
    };
  } catch {
    return null;
  }
}

/**
 * Build [lon, lat] coordinates for the modified route line.
 *
 * For each consecutive stop pair, we try to reuse the original shape segment
 * so the line keeps following roads. Strategy per pair (A → B):
 *
 *  1. Both stops have a shape-point index AND A comes before B in the original:
 *     → slice the original shape between those indices (road-accurate).
 *  2. One or both stops are new (not in the original shape):
 *     → find the nearest shape point to each stop's coordinates and use that
 *       as a proxy index, then slice as above (close approximation).
 *  3. The pair is reversed vs the original (unusual reorder):
 *     → straight line fallback.
 */
export function buildModifiedGeometry(
  stops: EditorStop[],
  shapePoints: ShapePoint[]
): [number, number][] {
  if (stops.length === 0) return [];
  if (shapePoints.length === 0) {
    // No original shape — straight lines
    return stops.map((s) => [s.stop_lon, s.stop_lat]);
  }

  // Map stopId → index in shapePoints
  const stopIdToIdx = new Map<string, number>();
  shapePoints.forEach((pt, i) => {
    if (pt.stopId) stopIdToIdx.set(pt.stopId, i);
  });

  // For a stop without a known shape index, find the nearest shape point
  function resolveIdx(stop: EditorStop): number {
    if (stop.stop_id) {
      const known = stopIdToIdx.get(stop.stop_id);
      if (known !== undefined) return known;
    }
    // Nearest shape point by coordinates
    let best = 0;
    let bestDist = Infinity;
    shapePoints.forEach((pt, i) => {
      const pLat = Number(pt.coordinates?.latitude ?? 0);
      const pLon = Number(pt.coordinates?.longitude ?? 0);
      const d = (pLat - stop.stop_lat) ** 2 + (pLon - stop.stop_lon) ** 2;
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }

  function ptCoords(pt: ShapePoint): [number, number] {
    return [Number(pt.coordinates?.longitude ?? 0), Number(pt.coordinates?.latitude ?? 0)];
  }

  const coords: [number, number][] = [ptCoords(shapePoints[resolveIdx(stops[0])])];

  for (let i = 0; i < stops.length - 1; i++) {
    const fromIdx = resolveIdx(stops[i]);
    const toIdx   = resolveIdx(stops[i + 1]);

    if (fromIdx < toIdx) {
      // Forward slice along original shape
      for (let j = fromIdx + 1; j <= toIdx; j++) {
        coords.push(ptCoords(shapePoints[j]));
      }
    } else if (fromIdx === toIdx) {
      // Same shape point — straight line to next stop's actual position
      coords.push([stops[i + 1].stop_lon, stops[i + 1].stop_lat]);
    } else {
      // Reversed — straight line
      coords.push([stops[i + 1].stop_lon, stops[i + 1].stop_lat]);
    }
  }

  return coords;
}

/**
 * Build OSRM waypoints for a modified route, injecting intermediate shape
 * points between each consecutive forward stop pair.
 *
 * This guides OSRM along the actual bus road, preventing side-road detours,
 * while still producing real road-following geometry via OSRM. For reversed
 * pairs (reordered stops) only the stop endpoints are used — OSRM finds its
 * own path for those segments.
 *
 * Returns a flat list of {lat, lon} waypoints ready for routeWithOSRM().
 * When shapePoints is empty, returns just the stop coordinates.
 */
export function buildOsrmWaypoints(
  stops: EditorStop[],
  shapePoints: ShapePoint[]
): Array<{ lat: number; lon: number }> {
  if (shapePoints.length === 0) {
    return stops.map((s) => ({ lat: s.stop_lat, lon: s.stop_lon }));
  }

  const stopIdToIdx = new Map<string, number>();
  shapePoints.forEach((pt, i) => { if (pt.stopId) stopIdToIdx.set(pt.stopId, i); });

  function resolveIdx(stop: EditorStop): number {
    if (stop.stop_id) {
      const known = stopIdToIdx.get(stop.stop_id);
      if (known !== undefined) return known;
    }
    let best = 0, bestDist = Infinity;
    shapePoints.forEach((pt, i) => {
      const pLat = Number(pt.coordinates?.latitude ?? 0);
      const pLon = Number(pt.coordinates?.longitude ?? 0);
      const d = (pLat - stop.stop_lat) ** 2 + (pLon - stop.stop_lon) ** 2;
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }

  const waypoints: Array<{ lat: number; lon: number }> = [];

  for (let i = 0; i < stops.length; i++) {
    waypoints.push({ lat: stops[i].stop_lat, lon: stops[i].stop_lon });

    if (i < stops.length - 1) {
      const fromIdx = resolveIdx(stops[i]);
      const toIdx = resolveIdx(stops[i + 1]);

      if (fromIdx < toIdx) {
        // Sample up to 2 intermediate shape points to anchor OSRM to the correct road.
        // Skip points with a stopId — those are stop locations that may have been
        // removed from the route; forcing OSRM through them creates ghost-stop artifacts.
        const count = toIdx - fromIdx;
        const step = Math.max(1, Math.floor(count / 3));
        for (let j = fromIdx + step; j < toIdx; j += step) {
          const pt = shapePoints[j];
          if (pt.stopId) continue; // road-geometry only, never stop positions
          const lat = Number(pt.coordinates?.latitude ?? 0);
          const lon = Number(pt.coordinates?.longitude ?? 0);
          if (lat !== 0 && lon !== 0) waypoints.push({ lat, lon });
        }
      }
      // Reversed pair: no intermediate waypoints — OSRM routes directly A→B
    }
  }

  return waypoints;
}
