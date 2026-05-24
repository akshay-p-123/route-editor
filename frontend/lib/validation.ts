import type { EditorStop } from "@/store/editorStore";

export interface ValidationError {
  code: string;
  message: string;
  stopId?: string;
  severity: "error" | "warning";
}

// MTD service area bounding box
const BOUNDS = { latMin: 40.02, latMax: 40.28, lonMin: -88.42, lonMax: -88.10 };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract the stop group base name (strips " (subName)" suffix). */
function groupName(stopName: string): string {
  const idx = stopName.indexOf(" (");
  return idx >= 0 ? stopName.substring(0, idx) : stopName;
}

/** Extract the subName from a stop name, e.g. "NE Corner" from "Green & Wright (NE Corner)". */
function subName(stopName: string): string {
  const match = stopName.match(/\(([^)]+)\)$/);
  return match ? match[1] : "";
}

/**
 * Primary compass direction of travel between two stops.
 * Returns null when the two points are too close to determine a direction.
 */
function localBearing(
  from: EditorStop,
  to: EditorStop
): "N" | "S" | "E" | "W" | null {
  const dlat = to.stop_lat - from.stop_lat;
  const dlon = to.stop_lon - from.stop_lon;
  if (Math.abs(dlat) < 0.0002 && Math.abs(dlon) < 0.0002) return null;
  return Math.abs(dlat) >= Math.abs(dlon)
    ? dlat > 0 ? "N" : "S"
    : dlon > 0 ? "E" : "W";
}

/**
 * Returns true when the compass corner of a boarding point contradicts the
 * expected side of the road for the given primary direction of travel.
 *
 * US right-hand traffic convention:
 *   Traveling N → right side is East  (NE/SE corner is correct)
 *   Traveling S → right side is West  (NW/SW corner is correct)
 *   Traveling E → right side is South (SE/SW corner is correct)
 *   Traveling W → right side is North (NE/NW corner is correct)
 */
function isWrongSide(corner: string, bearing: "N" | "S" | "E" | "W"): boolean {
  const c = corner.toUpperCase();
  switch (bearing) {
    case "N": return /\b(NW|SW|WEST)\b/.test(c) && !/\b(NE|SE|EAST)\b/.test(c);
    case "S": return /\b(NE|SE|EAST)\b/.test(c) && !/\b(NW|SW|WEST)\b/.test(c);
    case "E": return /\b(NE|NW|NORTH)\b/.test(c) && !/\b(SE|SW|SOUTH)\b/.test(c);
    case "W": return /\b(SE|SW|SOUTH)\b/.test(c) && !/\b(NE|NW|NORTH)\b/.test(c);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Validate a single stop's coordinates. Returns errors (not warnings). */
export function validateStop(stop: EditorStop): ValidationError[] {
  const errors: ValidationError[] = [];
  const id = stop.stop_id ?? undefined;

  if (stop.stop_lat === 0 && stop.stop_lon === 0) {
    errors.push({
      code: "NULL_ISLAND",
      message: `"${stop.stop_name}" has invalid coordinates (0, 0)`,
      stopId: id,
      severity: "error",
    });
  } else if (
    stop.stop_lat < BOUNDS.latMin || stop.stop_lat > BOUNDS.latMax ||
    stop.stop_lon < BOUNDS.lonMin || stop.stop_lon > BOUNDS.lonMax
  ) {
    errors.push({
      code: "OUT_OF_AREA",
      message: `"${stop.stop_name}" is outside the MTD service area`,
      stopId: id,
      severity: "error",
    });
  }

  return errors;
}

/** Validate the full stop list. Pass `dismissed` to suppress acknowledged warnings. */
export function validateRoute(stops: EditorStop[], dismissed: Set<string> = new Set()): ValidationError[] {
  const errors: ValidationError[] = [];

  // ── Count checks (errors) ──────────────────────────────────────────────────
  if (stops.length === 0) {
    errors.push({ code: "NO_STOPS", message: "Route has no stops", severity: "error" });
    return errors;
  }
  if (stops.length === 1) {
    errors.push({ code: "ONE_STOP", message: "Route needs at least 2 stops", severity: "error" });
  }

  // ── Per-stop coordinate checks (errors) ───────────────────────────────────
  for (const stop of stops) {
    errors.push(...validateStop(stop));
  }

  // ── Same stop group, consecutive stops (warning) ───────────────────────────
  for (let i = 0; i < stops.length - 1; i++) {
    const a = groupName(stops[i].stop_name);
    const b = groupName(stops[i + 1].stop_name);
    if (a && a === b) {
      errors.push({
        code: "SAME_GROUP_CONSECUTIVE",
        message: `Two consecutive stops at the same intersection: "${a}"`,
        stopId: stops[i + 1].stop_id ?? undefined,
        severity: "warning",
      });
    }
  }

  // ── Wrong side of road (warning) ───────────────────────────────────────────
  // Only check user-added stops — original MTD stops are correct by definition.
  // Use the local bearing between neighbors rather than the global route direction,
  // since a route changes direction many times (turns, loops, etc.).
  for (let i = 0; i < stops.length; i++) {
    if (!stops[i].isAdded) continue;
    const corner = subName(stops[i].stop_name);
    if (!corner) continue;

    // Determine local direction of travel at this stop from its neighbors.
    const prev = stops[i - 1];
    const next = stops[i + 1];
    const bearing =
      prev && next
        ? localBearing(prev, next)         // direction across this stop
        : prev
        ? localBearing(prev, stops[i])     // last stop — use approach bearing
        : next
        ? localBearing(stops[i], next)     // first stop — use departure bearing
        : null;

    if (!bearing) continue;
    if (isWrongSide(corner, bearing)) {
      const sid = stops[i].stop_id ?? undefined;
      if (sid && dismissed.has(`${sid}:WRONG_SIDE`)) continue;
      errors.push({
        code: "WRONG_SIDE",
        message: `"${stops[i].stop_name}" may be on the wrong side of the road — check stop ordering`,
        stopId: sid,
        severity: "warning",
      });
    }
  }

  return errors;
}
