# Roadmap: MTD Route Editor — GTFS Milestone

## Overview

This milestone adds GTFS capabilities to the existing FastAPI backend: ingest MTD's public GTFS static feed, export saved routes as a valid GTFS zip, fetch GTFS-RT trip update delay data, support round-trip import/export of GTFS-RT TripModifications, and surface per-stop travel-time impact estimates for proposed reroutes. Phases execute in dependency order — ingestion first (de-risks Docker/GDAL), export second (highest-value user deliverable), trip updates third (provides data Phases 4 and 5 need), TripModifications fourth (round-trip reroute exchange), estimation last (composes everything).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3, 4, 5): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: GTFS Static Ingestion** - Backend loads and refreshes MTD's GTFS feed; Docker image builds with GDAL (completed 2026-06-06)
- [x] **Phase 2: GTFS Export** - User can download a spec-compliant GTFS zip for saved routes from the editor (completed 2026-06-08)
- [x] **Phase 3: Trip Update Integration** - Backend fetches, caches, and exposes GTFS-RT delay data for stops (completed 2026-06-08)
- [ ] **Phase 4: Trip Modifications Round-Trip** - User can import a TripModifications feed into the editor and export a saved reroute as a TripModifications protobuf
- [ ] **Phase 5: Reroute Travel-Time Estimation** - Editor displays per-stop arrival delta for proposed stop sequence changes

## Phase Details

### Phase 1: GTFS Static Ingestion
**Goal**: Backend reliably loads MTD's GTFS static feed on startup and refreshes it in the background, with the Docker image building successfully and a safe 503 guard while loading
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: INGEST-01, INGEST-02, INGEST-03, INGEST-04
**Success Criteria** (what must be TRUE):
  1. Docker image builds without error using a base image that satisfies the GDAL dependency required by gtfs-kit
  2. On backend startup, route/stop/shape/schedule DataFrames are available in memory and accessible to other services
  3. Any API call made while the GTFS feed is still loading returns HTTP 503 with a descriptive error message
  4. GTFS feed refreshes automatically in the background every 6-12 hours without restarting the process or causing downtime
**Plans**: 1 plan
  - [x] 01-01-PLAN.md — GTFS ingestion walking skeleton: Docker+GDAL, startup load, in-memory feed, background refresh, 503 guard, /api/gtfs/status

### Phase 2: GTFS Export
**Goal**: User can trigger a GTFS static zip download from the editor for one or more saved routes, and the exported zip passes MobilityData gtfs-validator without errors
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: EXPORT-01, EXPORT-02, EXPORT-03, EXPORT-04, EXPORT-05, EXPORT-06, EXPORT-07, EXPORT-08, EXPORT-09, EXPORT-10
**Success Criteria** (what must be TRUE):
  1. User can click an export action in the editor and receive a downloadable GTFS zip file for selected saved routes
  2. The downloaded zip contains all 6 mandatory GTFS files plus shapes.txt and feed_info.txt, with files at the zip root (no subdirectories)
  3. Stops shared across multiple exported routes appear exactly once in stops.txt; editor-added stops with no MTD stop_id receive a synthetic ID
  4. Exported route_color values have no # prefix; shape coordinates are in lat/lon order (not swapped from OSRM GeoJSON); stop_times include arrival/departure for all stops with timepoint=0 placeholders
  5. The exported zip passes MobilityData gtfs-validator with no ERROR-level violations (warnings acceptable)
**Plans**: 3 plans
  - [x] 02-01-PLAN.md — Backend GTFS export endpoint: 8-DataFrame builders, OSRM timing+geometry, ownership-guarded GET /api/gtfs/export/{reroute_id}, pytest scaffold
  - [x] 02-02-PLAN.md — Frontend slice: exportGtfs api helper + FileArchive download button in RerouteDashboard
  - [x] 02-03-PLAN.md — gtfs-validator compliance pass (0 ERRORs) + regression tests + end-to-end browser human-verify

### Phase 3: Trip Update Integration
**Goal**: Backend fetches the MTD GTFS-RT protobuf feed at most once per hour, caches the result in memory, and exposes an endpoint returning current per-stop delay values
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: RT-01, RT-02, RT-03
**Planning note (2026-06-08):** Per CONTEXT.md D-01/D-02, RT-01 (GTFS-RT protobuf feed via gtfs-realtime-bindings + hourly background refresh) is DEFERRED to Phase 4, where TripModifications requires the same protobuf infrastructure. Phase 3 delivers RT-02 + RT-03 using the MTD API v3 departures endpoint as the data source — same `/api/gtfs/trip-updates` response contract, demand-filled 60s cache instead of hourly polling. Success Criterion 1 below moves to Phase 4.
**Success Criteria** (what must be TRUE):
  1. (DEFERRED to Phase 4) Backend fetches the GTFS-RT feed from https://gtfs-rt.mtd.org/ using gtfs-realtime-bindings and never exceeds one fetch per hour regardless of request volume
  2. GET /api/gtfs/trip-updates?stop_ids=... returns current delay values (seconds early/late) for requested stops, served from the in-memory cache between refreshes
  3. Backend queries MTD API v3 departure data for a given stop set and returns per-stop delay values in a GTFS-RT-shaped response
**Plans**: 1 plan
  - [x] 03-01-PLAN.md — Trip-update vertical slice: get_stop_departures() (MTD v3, bypasses static cache) + authenticated GET /api/gtfs/trip-updates with 60s cache, soonest-departure delay computation, warn-don't-crash fan-out, full pytest suite

### Phase 4: Trip Modifications Round-Trip
**Goal**: User can import a GTFS-RT TripModifications protobuf feed into the editor (replacement stops rendered on map, editable), and export an edited reroute as a TripModifications protobuf
**Mode:** mvp
**Depends on**: Phase 1 (static feed for stop coordinate resolution), Phase 3 (delay data for timing augmentation)
**Requirements**: TRIPMOD-01, TRIPMOD-02, TRIPMOD-03, TRIPMOD-04, TRIPMOD-05, TRIPMOD-06 (also completes RT-01, deferred from Phase 3)
**Success Criteria** (what must be TRUE):
  1. User enters a TripModifications feed URL in the editor and sees replacement stops rendered on the map for the affected trip
  2. Imported replacement stops can be edited with standard stop-editing gestures (reorder, add, remove, drag-snap)
  3. User can export a saved reroute as a GTFS-RT TripModifications protobuf download
  4. Imported modification correctly resolves stop coordinates from the in-memory GTFS static feed (Phase 1 dependency)
**Plans**: 4 plans
  - [x] 04-01-PLAN.md — Protobuf + RT-01 foundation: generate/commit gtfs_realtime_pb2.py, gtfs_rt_feed_url setting, hourly RT-01 background refresh (warn-don't-crash, once/hour cap), Wave 0 test scaffold
  - [ ] 04-02-PLAN.md — TripMod import slice: POST /trip-modifications/import (parse + stop resolution + SSRF guard) + TripModImportModal + EditorToolbar button → editable custom route
  - [ ] 04-03-PLAN.md — TripMod export slice: GET /export/{reroute_id}/trip-modifications (.pb/.json, one entity per route) + exportTripMod client + RerouteDashboard export section
  - [ ] 04-04-PLAN.md — GTFS zip import slice (folded todo): POST /import (gtfs_kit.read_feed → reroute package, synthetic-id fallback, 422/413 guards) + Import GTFS footer button
**UI hint**: yes

### Phase 5: Reroute Travel-Time Estimation
**Goal**: User can request travel-time impact for a modified stop sequence and see per-stop arrival delta displayed alongside the route preview in the editor
**Mode:** mvp
**Depends on**: Phase 3 (delay data), Phase 4 (optional travel_time_to_stop from imported TripMod when present)
**Requirements**: EST-01, EST-02, EST-03
**Success Criteria** (what must be TRUE):
  1. User can trigger a travel-time estimate for a proposed stop sequence change from within the editor without leaving the route editing workflow
  2. Backend computes per-stop estimated arrival delta by combining OSRM road travel time for new/moved stops with upstream MTD departure delay for existing stops
  3. Editor displays per-stop estimated arrival delta values alongside the existing route preview for the proposed modification
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. GTFS Static Ingestion | 1/1 | Complete   | 2026-06-06 |
| 2. GTFS Export | 3/3 | Complete   | 2026-06-08 |
| 3. Trip Update Integration | 1/1 | Complete   | 2026-06-08 |
| 4. Trip Modifications Round-Trip | 1/4 | In Progress|  |
| 5. Reroute Travel-Time Estimation | 0/TBD | Not started | - |
