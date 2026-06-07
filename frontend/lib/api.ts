/**
 * Typed API client for the FastAPI backend (which proxies MTD API v3).
 * MTD v3 base: https://api.mtd.dev — auth via X-ApiKey header (kept server-side).
 * All responses use the envelope: { result: T | null, error?: {...} | null }
 *
 * All requests use relative URLs (/api/*). Next.js rewrites forward them to
 * the backend server-side using the BACKEND_URL env var. The browser never
 * contacts the backend directly, so no CORS headers are needed.
 */

const BASE = "";
const DEFAULT_TIMEOUT_MS = 15_000;

async function fetchJSON<T>(
  path: string,
  options?: RequestInit,
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      headers,
      signal: options?.signal ?? controller.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      throw new Error(`Request timed out after ${DEFAULT_TIMEOUT_MS / 1000}s: ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Try to extract a structured message from the FastAPI error body
    try {
      const parsed = JSON.parse(body);
      const detail = parsed?.detail ?? parsed?.message;
      if (detail) throw new Error(`${res.status}: ${detail}`);
    } catch {
      // not JSON — fall through
    }
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }

  const data = (await res.json()) as T;

  // Validate the MTD ApiResponse envelope: if result is null but error is set, throw
  const envelope = data as unknown as Record<string, unknown>;
  if (
    envelope !== null &&
    typeof envelope === "object" &&
    "result" in envelope &&
    envelope["result"] === null &&
    "error" in envelope &&
    envelope["error"]
  ) {
    const err = envelope["error"] as { message?: string; code?: string };
    throw new Error(err?.message ?? err?.code ?? "MTD API error");
  }

  return data;
}

// ── MTD proxy ─────────────────────────────────────────────────────────────────

export const mtd = {
  /** All route groups (Teal, Silver, Gold, etc.). Use as the route picker list. */
  routeGroups: () =>
    fetchJSON<ApiResponse<RouteGroup[]>>("/api/mtd/route-groups"),

  /** Single route group by UUID. */
  routeGroup: (id: string) =>
    fetchJSON<ApiResponse<RouteGroup>>(`/api/mtd/route-groups/${encodeURIComponent(id)}`),

  /** All stops (StopGroup[], each with nested boardingPoints). Cache client-side. */
  stops: (excludeBoardingPoints = false) =>
    fetchJSON<ApiResponse<StopGroup[]>>(
      `/api/mtd/stops${excludeBoardingPoints ? "?exclude_boarding_points=true" : ""}`
    ),

  /** Server-side stop search — replaces loading all stops + client-side filter. */
  searchStops: (query: string) =>
    fetchJSON<ApiResponse<StopSearchResult[]>>(
      `/api/mtd/stops/search?query=${encodeURIComponent(query)}`
    ),

  /** All trips in the system. Used to find a representative trip for a route group. */
  trips: () =>
    fetchJSON<ApiResponse<Trip[]>>("/api/mtd/trips"),

  /** Single trip by ID. */
  trip: (tripId: string) =>
    fetchJSON<ApiResponse<Trip>>(`/api/mtd/trips/${encodeURIComponent(tripId)}`),

  /**
   * Shape with all shape points in sequence order.
   * Points with a non-null stopId are actual bus stops (in route order).
   */
  shape: (shapeId: string) =>
    fetchJSON<ApiResponse<Shape>>(`/api/mtd/shapes/${encodeURIComponent(shapeId)}`),

  /** Encoded Google polyline for a shape (more compact than shape points). */
  shapePolyline: (shapeId: string) =>
    fetchJSON<ApiResponse<ShapePolyline>>(
      `/api/mtd/shapes/${encodeURIComponent(shapeId)}/polyline`
    ),
};

// ── Saved routes ──────────────────────────────────────────────────────────────

export const savedRoutes = {
  list: (token: string) =>
    fetchJSON<SavedRoute[]>("/api/routes/", undefined, token),
  get: (id: string, token: string) =>
    fetchJSON<SavedRoute>(`/api/routes/${id}`, undefined, token),
  create: (body: RoutePayload, token: string) =>
    fetchJSON<{ id: string }>(
      "/api/routes/",
      { method: "POST", body: JSON.stringify(body) },
      token
    ),
  update: (id: string, body: RoutePayload, token: string) =>
    fetchJSON<{ id: string }>(
      `/api/routes/${id}`,
      { method: "PUT", body: JSON.stringify(body) },
      token
    ),
  delete: (id: string, token: string) =>
    fetch(`${BASE}/api/routes/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }),
};

// ── Reroutes ─────────────────────────────────────────────────────────────────

export const reroutes = {
  list: (token: string) =>
    fetchJSON<Reroute[]>("/api/reroutes", undefined, token),
  get: (id: string, token: string) =>
    fetchJSON<Reroute>(`/api/reroutes/${id}`, undefined, token),
  create: (body: { name: string; description?: string; start_date?: string; end_date?: string }, token: string) =>
    fetchJSON<Reroute>(
      "/api/reroutes",
      { method: "POST", body: JSON.stringify(body) },
      token
    ),
  update: (id: string, body: { name?: string; description?: string; start_date?: string; end_date?: string }, token: string) =>
    fetchJSON<Reroute>(
      `/api/reroutes/${id}`,
      { method: "PUT", body: JSON.stringify(body) },
      token
    ),
  delete: (id: string, token: string) =>
    fetch(`${BASE}/api/reroutes/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }),
  addRoute: (id: string, routeId: string, token: string) =>
    fetch(`${BASE}/api/reroutes/${id}/routes/${routeId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }),
  removeRoute: (id: string, routeId: string, token: string) =>
    fetch(`${BASE}/api/reroutes/${id}/routes/${routeId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }),
};

// ── Export ────────────────────────────────────────────────────────────────────

export async function exportPng(payload: ExportPayload): Promise<Blob> {
  const res = await fetch(`${BASE}/api/export/png`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Export failed: ${res.statusText}`);
  return res.blob();
}

/** Download a GTFS static zip for a reroute package. */
export async function exportGtfs(rerouteId: string, token: string): Promise<Blob> {
  const res = await fetch(`${BASE}/api/gtfs/export/${rerouteId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GTFS export failed: ${res.statusText}`);
  return res.blob();
}

// ── MTD v3 Types ──────────────────────────────────────────────────────────────

/** Standard v3 response envelope. */
export interface ApiResponse<T> {
  result: T | null;
  error?: {
    code: string;
    message: string;
    details: unknown;
  } | null;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * RouteGroup is what MTD v2 called a "route" (e.g., Teal, Silver).
 * It contains multiple Route objects (directional/daytype variants).
 */
export interface RouteGroup {
  id: string;
  sortNumber?: number;
  routeGroupName?: string;
  color?: string;       // hex without #
  textColor?: string;   // hex without #
  routes?: Route[];
}

/** A directional/daytype variant of a RouteGroup. */
export interface Route {
  id: string;
  number?: string;
  firstTrip?: string;
  lastTrip?: string;
  dayType?: {
    dayPart?: string;
    timePart?: string;
    daysOfWeek?: string;
    sortOrder?: number;
  };
  gtfsRoutes?: string[];
  routeGroupId?: string;
}

/** A grouped stop (intersection level, e.g., "Green & Wright"). */
export interface StopGroup {
  id: string;
  name?: string;
  stopCode?: string;
  isStation?: boolean;
  city?: string;
  isAccessible?: boolean;
  url?: string;
  location?: Coordinates;
  boardingPoints?: BoardingPoint[];
}

/** A specific boarding location under a StopGroup. */
export interface BoardingPoint {
  id: string;
  name?: string;          // inherits group name
  subName?: string;       // corner description, e.g. "SE Corner"
  stopCode?: string;
  isAccessible?: boolean;
  url?: string;
  location?: Coordinates;
}

/** Server-side stop search result. */
export interface StopSearchResult {
  stopId: string;
  name: string;
  subName: string | null;
  highlightedName?: string;
  type: number;
  location?: Coordinates;
  city?: string;
  isIStop?: boolean;
  stopCode?: string;
  accessible?: boolean;
}

export interface TripDirection {
  id?: number | null;
  name?: string;
  shortName?: string | null;
}

export interface DepartureRoute {
  id?: string;
  routeGroupId?: string;
  gtfsRouteId?: string;
  longName?: string;
  shortName?: string;
  color?: string;   // hex without #
  textColor?: string;
}

export interface Trip {
  id: string;
  blockId?: string;
  shapeId?: string;
  headsign?: string;
  direction?: TripDirection;
  route?: DepartureRoute;
}

/**
 * A shape point. Points with a non-null stopId are stops along the route.
 * Points are already sorted by sequence from the API.
 */
export interface ShapePoint {
  sequence?: number;
  coordinates?: Coordinates;
  distanceTraveled?: number;
  /** Non-null when this shape point corresponds to a bus stop. */
  stopId?: string | null;
}

export interface Shape {
  id?: string;
  /** Shape points in sequence order. Filter for stopId !== null to get the stop list. */
  shapePoints?: ShapePoint[];
}

export interface ShapePolyline {
  polyline?: string;
}

// ── App-level types ──────────────────────────────────────────────────────────

export interface RouteStop {
  id?: string;
  route_id?: string;
  stop_sequence: number;
  stop_id: string | null;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
}

export interface SavedRoute {
  id: string;
  user_id: string;
  name: string;
  short_name: string | null;
  color: string | null;
  is_custom: boolean;
  base_route_id: string | null;
  reroute_id: string | null;
  created_at: string;
  updated_at: string;
  route_stops: RouteStop[];
}

export interface RoutePayload {
  name: string;
  short_name?: string;
  color?: string;
  is_custom: boolean;
  base_route_id?: string;
  reroute_id?: string;
  stops: Omit<RouteStop, "id" | "route_id">[];
}

export interface Reroute {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  created_at: string;
  updated_at: string;
  saved_routes?: SavedRoute[];
}

export interface ExportStopPoint {
  lat: number;
  lon: number;
  stop_name: string;
  is_added?: boolean;
  is_removed?: boolean;
}

export interface ExportPayload {
  original_stops: ExportStopPoint[];
  modified_stops: ExportStopPoint[];
  route_color: string;
  width?: number;
  height?: number;
}
