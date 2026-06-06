# Phase 2: GTFS Export - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Backend endpoint that accepts a `reroute_id`, fetches all associated saved routes from Supabase, and generates a spec-compliant GTFS static zip (6 mandatory files + shapes.txt + feed_info.txt). Stop geometry comes from OSRM (same path as PNG export). Stop times are OSRM-derived, anchored at 08:00:00, with graceful fallback to 1 min/stop even spacing if OSRM is unavailable. Calendar covers today + 90 days. Frontend adds a "Download GTFS" action to `RerouteDashboard` per reroute package.

This phase covers only GTFS static export — no GTFS-RT, no trip modifications.

</domain>

<decisions>
## Implementation Decisions

### Export Trigger (Frontend)
- **D-01:** GTFS export lives in `RerouteDashboard` only. It is a per-reroute-package action, mirroring the existing "Export PNG" button. No per-route export in `SavedRoutesDashboard`, no toolbar action.
- **D-02:** Frontend passes `reroute_id` only. The backend fetches all associated saved routes from Supabase using the user's JWT (same auth pattern as existing `/api/reroutes/:id` endpoints).

### Backend Endpoint
- **D-03:** New endpoint: `POST /api/gtfs/export` (or `GET /api/gtfs/export/{reroute_id}` — planner picks the most idiomatic REST verb for a download). Accepts `reroute_id`, returns a zip file stream with `Content-Type: application/zip` and `Content-Disposition: attachment; filename="{reroute_name}-gtfs.zip"`.
- **D-04:** The endpoint must verify the reroute belongs to the requesting user (same ownership check as `reroutes.py`).

### Stop Times
- **D-05:** Use OSRM to compute travel time per segment (identical approach to `export.py` OSRM calls). Anchor the trip at 08:00:00. Compute cumulative arrival/departure times from OSRM segment durations.
- **D-06:** If OSRM is unavailable or fails for any segment, fall back to 1 minute per stop evenly spaced. Log a warning. Export still completes (warn-don't-crash, matching Phase 1 pattern). Never fail the entire export due to OSRM unavailability.
- **D-07:** All stops in stop_times.txt use `timepoint=0` (times are estimates, not timepoints).

### Calendar
- **D-08:** `calendar_dates.txt` covers today through today + 90 days. Every day in the range gets `exception_type=1` (service runs). A single `service_id` shared by all trips in the export (e.g. `"mtd_route_editor_service"`).

### Agency / Feed Metadata
- **D-09 (Claude's Discretion):** Pull agency metadata from `app.state.gtfs_feed.feed.agency` (MTD's real values from the parsed GTFS feed) if available. If the gtfs_feed is not loaded, hard-code MTD's known values: `agency_id="MTD"`, `agency_name="Champaign-Urbana Mass Transit District"`, `agency_url="https://mtd.org"`, `agency_timezone="America/Chicago"`, `agency_lang="en"`.
- **D-10 (Claude's Discretion):** `feed_info.txt` (EXPORT-10): `feed_publisher_name="MTD Route Editor"`, `feed_publisher_url="https://mtd.org"`, `feed_lang="en"`, `feed_start_date`/`feed_end_date` matching the calendar window. `feed_version` = ISO date of export.

### ID / Naming Conventions
- **D-11 (Claude's Discretion):** Use the saved route's `id` as `route_id` in GTFS files. Use `"route_editor_{route_id}_trip"` as `trip_id`. Custom stops get synthetic `stop_id` per EXPORT-05: `"custom_{route_id}_{stop_sequence}"`. MTD stops use their existing `stop_id` from the saved route record.

### Claude's Discretion
- Frontend button layout (separate "Download GTFS" button vs dropdown with PNG) — choose the approach most consistent with existing `RerouteDashboard` button patterns.
- REST verb and exact URL path for the export endpoint.
- ZIP file construction library — use Python stdlib `zipfile` (no new dependency).
- `route_type` in routes.txt — use `3` (bus) for all exported routes.
- `direction_id` in trips.txt — use `0` for all (single direction per saved route).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Export Pattern (replicate for GTFS)
- `backend/app/routers/export.py` — PNG export: OSRM call pattern, `Response(content=..., media_type=...)`, route data handling
- `backend/app/routers/reroutes.py` — reroute fetch + ownership verification pattern (`_user_id`, `_client`, Supabase queries)
- `backend/app/routers/routes.py` — saved route fetch pattern

### GTFS Feed (Phase 1 output — enrichment source)
- `backend/app/services/gtfs.py` — `GtfsFeed` dataclass, `app.state.gtfs_feed` access pattern
- `backend/app/routers/gtfs.py` — `get_gtfs_feed` Depends() guard (inject for enrichment, handle None gracefully)

### Frontend Export Pattern
- `frontend/components/RerouteDashboard.tsx` — existing `handleExportAll` PNG export function (GTFS export mirrors this structure)
- `frontend/lib/api.ts` — `exportPng`, `reroutes.*`, `SavedRoute`, `Reroute` types

### BFF Proxy
- `frontend/next.config.ts` — `/api/:path*` rewrites to backend; no frontend API route needed for GTFS export

### Requirements
- `.planning/REQUIREMENTS.md` §GTFS Export — EXPORT-01..10 (authoritative)

### GTFS Spec (no external doc — knowledge in agents)
- GTFS mandatory files: agency.txt, routes.txt, trips.txt, stops.txt, stop_times.txt, calendar_dates.txt
- Optional but required by plan: shapes.txt, feed_info.txt

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `backend/app/routers/export.py` `_osrm_coords()` — async OSRM call, returns None on failure. Adapt for per-segment travel time (not just geometry).
- `backend/app/routers/reroutes.py` `_client()` / `_user_id()` — Supabase client and JWT extraction helpers. Copy (not import) per project convention.
- `backend/app/services/gtfs.py` `GtfsFeed` — `feed.agency`, `feed.stops`, `feed.routes` DataFrames available for metadata enrichment.
- `frontend/components/RerouteDashboard.tsx` `handleExportAll` — blob download pattern: `URL.createObjectURL` + anchor click. GTFS export reuses this exactly.

### Established Patterns
- Warn-don't-crash on external service failure (OSRM, MTD API) — GTFS export must follow same pattern for OSRM failure.
- `zipfile` (Python stdlib) for zip construction — no new dependency.
- `Content-Disposition: attachment` for file downloads.
- BFF rewrite handles routing — no new Next.js API route needed if the endpoint is under `/api/`.

### Integration Points
- `backend/app/main.py` — register new `gtfs` router additions (or new router module `backend/app/routers/gtfs_export.py` — planner decides whether to extend existing `gtfs.py` router or create a new module).
- `frontend/components/RerouteDashboard.tsx` — add "Download GTFS" button per reroute row.
- `frontend/lib/api.ts` — add `exportGtfs(rerouteId: string, token: string): Promise<Blob>` function.

</code_context>

<specifics>
## Specific Ideas

- Existing `SavedRoute.route_stops` already contains `stop_id`, `stop_name`, `stop_lat`, `stop_lon`, `stop_sequence` — sufficient for stops.txt without needing `app.state.gtfs_feed` lookup for basic stop data.
- OSRM geometry for shapes.txt: same OSRM endpoint used by PNG export (`router.project-osrm.org`). Each route gets a `shape_id = route_id`. `shape_pt_sequence` is 0-indexed.
- `route_color` in routes.txt: strip `#` from `SavedRoute.color` per EXPORT-06. Default to `"0070F3"` if color is null.
- Zip structure: all files at zip root (no subdirectory) per EXPORT-02.

</specifics>

<deferred>
## Deferred Ideas

- **User-configurable start time** for stop_times — mentioned as an option but deferred; hard-coded 08:00:00 is the Phase 2 default.
- **User-configurable calendar window** — VALID-02 (v2) defers this; Phase 2 uses 90-day hard-coded window.
- **Per-route export from SavedRoutesDashboard** — deferred; Phase 2 only exports at the reroute-package level.
- **Actual MTD schedule lookup** from gtfs_feed.stop_times — deferred in favor of OSRM-derived times.

</deferred>

---

*Phase: 2-gtfs-export*
*Context gathered: 2026-06-06*
