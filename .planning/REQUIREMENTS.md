# Requirements: MTD Route Editor — GTFS Milestone

**Defined:** 2026-06-05
**Core Value:** Route modifications are exportable as valid GTFS and informed by real-world trip time data from MTD departure feeds — shareable in a standard format and grounded in actual delay/travel-time reality.

## v1 Requirements

### GTFS Static Ingestion

- [ ] **INGEST-01**: System downloads and parses MTD's GTFS static feed from `https://mtd.dev/gtfs.zip` on startup, making route/stop/shape/schedule data available to all backend services
- [ ] **INGEST-02**: System refreshes the GTFS static feed in the background every 6–12 hours without service interruption or downtime
- [ ] **INGEST-03**: System returns HTTP 503 with a clear error message when the GTFS feed has not yet finished loading
- [ ] **INGEST-04**: Docker image builds successfully with the GDAL dependency required by gtfs-kit (currently blocked on `python:3.12-slim` base)

### GTFS Export

- [x] **EXPORT-01**: User can trigger a GTFS static zip download for one or more saved routes via the editor
- [x] **EXPORT-02**: Exported GTFS zip contains all 6 mandatory files: `agency.txt`, `routes.txt`, `trips.txt`, `stops.txt`, `stop_times.txt`, `calendar_dates.txt`
- [x] **EXPORT-03**: Exported GTFS contains `shapes.txt` with road-following geometry sourced from OSRM (same geometry used in PNG export)
- [x] **EXPORT-04**: Exported `stops.txt` contains exactly one row per unique stop — stops shared across multiple exported routes are deduplicated
- [x] **EXPORT-05**: Custom/editor-added stops with no MTD stop_id are assigned synthetic stop_ids (`custom_{route_id}_{stop_sequence}`) in the export
- [x] **EXPORT-06**: Exported `routes.txt` `route_color` field is formatted as `RRGGBB` (no `#` prefix)
- [x] **EXPORT-07**: Exported `shapes.txt` `shape_pt_lat`/`shape_pt_lon` are in correct order (not swapped from OSRM GeoJSON `[lon, lat]`)
- [x] **EXPORT-08**: Exported `stop_times.txt` includes arrival/departure times for all stops; placeholder evenly-spaced times are used with `timepoint=0` when actual schedule data is unavailable
- [ ] **EXPORT-09**: Exported GTFS zip passes MobilityData `gtfs-validator` without ERRORS (warnings acceptable)
- [x] **EXPORT-10**: `feed_info.txt` is included in export, documenting that this is a route geometry export produced by the MTD Route Editor

### Trip Update Integration

- [ ] **RT-01**: System fetches MTD's GTFS-RT protobuf feed from `https://gtfs-rt.mtd.org/` using `gtfs-realtime-bindings`; feed is rate-limited to **once per hour maximum** — polling interval must not exceed this limit under any circumstances; parsed feed must be cached in-memory and served from cache between refreshes
- [ ] **RT-02**: Backend queries MTD API v3 departure data for a given set of stops and returns per-stop delay values (seconds early/late) in a GTFS-RT-shaped response
- [ ] **RT-03**: Backend exposes `GET /api/gtfs/trip-updates?stop_ids=...` endpoint returning current delay for requested stops

### GTFS-RT Trip Modifications Round-Trip

- [ ] **TRIPMOD-01**: Backend fetches and parses a GTFS-RT TripModifications protobuf from a user-provided URL, returning affected trip IDs and replacement stop sequences with lat/lon coordinates resolved from the static GTFS feed
- [ ] **TRIPMOD-02**: Backend exposes `POST /api/gtfs/trip-modifications/import` accepting a feed URL; response includes affected trip IDs, replacement stops (stop_id, name, lat, lon, travel_time_to_stop if present), and the modification's stop range
- [ ] **TRIPMOD-03**: Frontend renders imported TripModifications replacement stops on the map canvas in the route editor, replacing the affected portion of the original trip's stop sequence
- [ ] **TRIPMOD-04**: Imported replacement stops are fully editable using the same gestures as native stop editing (reorder, add, remove, drag-snap)
- [ ] **TRIPMOD-05**: Backend generates a valid GTFS-RT TripModifications protobuf for a saved reroute, identifying the affected trip, removed stops, and replacement stops
- [ ] **TRIPMOD-06**: Frontend provides an "Export as TripMod Feed" action for reroute packages that triggers TRIPMOD-05 and downloads the protobuf

### Reroute Travel-Time Estimation

- [ ] **EST-01**: User can request travel-time impact estimation for a modified stop sequence from within the editor
- [ ] **EST-02**: Backend computes per-stop estimated arrival delta using OSRM road travel time (new/moved stops) plus upstream MTD departure delay (existing stops)
- [ ] **EST-03**: Frontend displays per-stop estimated arrival delta for the proposed route modification alongside the existing route preview

## v2 Requirements

### Validation & Quality

- **VALID-01**: GTFS export step in CI pipeline invokes MobilityData `gtfs-validator` JAR and fails on critical errors
- **VALID-02**: User can configure the service date window for `calendar_dates.txt` (default: today + 90 days)

### Extended Export

- **EXT-01**: User can include fare data (`fare_attributes.txt`, `fare_rules.txt`) in GTFS export when MTD fare information is available in the static feed
- **EXT-02**: Exported GTFS includes `transfers.txt` for routes that share stops with other MTD routes

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-agency GTFS support | Only MTD for this milestone; not building for reuse across agencies |
| Vehicle positions (GTFS-RT) | Not a priority; trip updates and delay only |
| Service alerts (GTFS-RT) | Lower priority than trip updates; defer unless natural overlap emerges during Phase 3 |
| GTFS fare data | Not relevant to route editing workflows |
| Real-time bus position overlay on map | Out of scope per user decision |
| Storing GTFS data in Supabase | In-memory singleton sufficient; Supabase not needed for 26 MB single-agency feed |
| Historical delay aggregation | Requires time-series polling infrastructure not in current stack |
| SQLite/on-disk GTFS persistence | Single-worker deployment; in-memory is sufficient and simpler |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INGEST-01 | Phase 1 | Pending |
| INGEST-02 | Phase 1 | Pending |
| INGEST-03 | Phase 1 | Pending |
| INGEST-04 | Phase 1 | Pending |
| EXPORT-01 | Phase 2 | Complete |
| EXPORT-02 | Phase 2 | Complete |
| EXPORT-03 | Phase 2 | Complete |
| EXPORT-04 | Phase 2 | Complete |
| EXPORT-05 | Phase 2 | Complete |
| EXPORT-06 | Phase 2 | Complete |
| EXPORT-07 | Phase 2 | Complete |
| EXPORT-08 | Phase 2 | Complete |
| EXPORT-09 | Phase 2 | Pending |
| EXPORT-10 | Phase 2 | Complete |
| RT-01 | Phase 3 | Pending |
| RT-02 | Phase 3 | Pending |
| RT-03 | Phase 3 | Pending |
| TRIPMOD-01 | Phase 4 | Pending |
| TRIPMOD-02 | Phase 4 | Pending |
| TRIPMOD-03 | Phase 4 | Pending |
| TRIPMOD-04 | Phase 4 | Pending |
| TRIPMOD-05 | Phase 4 | Pending |
| TRIPMOD-06 | Phase 4 | Pending |
| EST-01 | Phase 5 | Pending |
| EST-02 | Phase 5 | Pending |
| EST-03 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 26 total
- Mapped to phases: 26
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-05*
*Last updated: 2026-06-05 — TRIPMOD-01..06 promoted from v2 to v1 (Phase 4); EST-01..03 remapped to Phase 5; requirement count updated to 26*
