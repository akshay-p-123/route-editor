/**
 * Typed API client for the FastAPI backend (which proxies MTD API v3).
 * MTD v3 base: https://api.mtd.dev — auth via X-ApiKey header (kept server-side).
 * All responses use the envelope: { result: T | null, error?: {...} | null }
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
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
  stops: Omit<RouteStop, "id" | "route_id">[];
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
