---
phase: 04-trip-modifications-round-trip
plan: "03"
subsystem: full-stack
tags: [gtfs-rt, protobuf, tripmod-export, tdd, ownership-guard, content-disposition]
dependency_graph:
  requires:
    - gtfs_realtime_pb2.FeedMessage (Plan 01)
    - get_gtfs_rt_feed guard (Plan 01)
    - _client/_user_id/ownership check patterns (Plan 01/02)
  provides:
    - _build_trip_mod_feed helper function
    - GET /export/{reroute_id}/trip-modifications endpoint (pb + json)
    - exportTripMod() TypeScript blob client
    - RerouteDashboard "Export as TripMod Feed" section with trip_id input + .pb/.json buttons
  affects:
    - backend/app/routers/gtfs.py (_build_trip_mod_feed + export_trip_modifications endpoint)
    - backend/tests/test_tripmod.py (3 Plan 03 export tests now passing)
    - frontend/lib/api.ts (exportTripMod function)
    - frontend/components/RerouteDashboard.tsx (TripMod export UI section)
tech_stack:
  added: []
  patterns:
    - _build_trip_mod_feed: one-entity-per-route FeedMessage with cumulative 60s travel_time_to_stop
    - TDD Red/Green with skip-guarded tests (same pattern as Plans 01-02)
    - exportTripMod blob download mirrors exportGtfs pattern exactly
key_files:
  created: []
  modified:
    - backend/app/routers/gtfs.py
    - backend/tests/test_tripmod.py
    - frontend/lib/api.ts
    - frontend/components/RerouteDashboard.tsx
decisions:
  - "One Modification per entity with replacement_stops list — covers all stops in one modification block"
  - "cumulative travel_time_to_stop starts at 0 and increments 60s per stop (ensures monotonic invariant, Pitfall 3)"
  - "service_dates defaults to date.today().strftime('%Y%m%d') when not supplied (Pitfall 6)"
  - "entity.id = route_id (UUID string) — unique non-empty per Pitfall 4"
  - "Ownership guard uses same reroutes.user_id check as existing export_gtfs endpoint (T-4-06)"
metrics:
  duration: "10 minutes"
  completed: "2026-06-09"
  tasks_completed: 2
  files_created: 0
  files_modified: 4
---

# Phase 4 Plan 03: TripMod Export Vertical Slice Summary

**One-liner:** Backend _build_trip_mod_feed + GET /export/{reroute_id}/trip-modifications endpoint (binary pb + canonical JSON) with ownership guard and filename sanitization, plus RerouteDashboard trip_id input + .pb/.json download buttons wired through exportTripMod() blob client.

## Tasks Completed

| Task | Description | Commit | Type |
|------|-------------|--------|------|
| 1 (RED) | Failing tests for _build_trip_mod_feed: round-trip pb, JSON camelCase keys, monotonic timing | 8925382 | test |
| 1 (GREEN) | _build_trip_mod_feed + GET /export/{reroute_id}/trip-modifications endpoint | 3135dc5 | feat |
| 2 | exportTripMod() client + RerouteDashboard Export as TripMod Feed section | ad44681 | feat |

## Key Changes

### backend/app/routers/gtfs.py

**`_build_trip_mod_feed(reroute_id, trip_id, routes_with_stops, service_date=None) -> pb2.FeedMessage`**
- One entity per route (D-10) with `entity.id = str(route["id"])` (unique non-empty, Pitfall 4)
- `tm.service_dates.append(today)` where `today = service_date or date.today().strftime("%Y%m%d")` (Pitfall 6)
- `sel.trip_ids.append(trip_id)` in `selected_trips`
- One Modification with `start_stop_selector.stop_id = effective_ids[0]`, `end_stop_selector.stop_id = effective_ids[-1]`
- Replacement stops with cumulative 60s timing (starts at 0, monotonically non-decreasing, Pitfall 3)
- Synthetic stop IDs: `custom_{route_id}_{stop_sequence}` when `stop.get("stop_id")` is None/empty

**`GET /export/{reroute_id}/trip-modifications`**
- Parameters: `reroute_id: UUID`, `trip_id: str`, `format: str = "pb"`
- Ownership check: reroutes.user_id == authenticated user_id → 404 (T-4-06)
- Auth: `Depends(_user_id)` Supabase JWT required (T-4-08)
- Format=pb: `Response(out.SerializeToString(), media_type="application/x-protobuf")`
- Format=json: `Response(json_format.MessageToJson(out), media_type="application/json")`
- Invalid format: `HTTPException(400, "format must be pb or json")`
- Filename sanitized: `re.sub(r'[^\w\-]', '_', reroute['name'])` (T-4-07)

### backend/tests/test_tripmod.py

All 3 Plan 03 export tests now PASS (previously skipped due to `_EXPORT_AVAILABLE=False`):
- `test_export_round_trip_pb` — FeedMessage round-trip, one entity per route, trip_id in selected_trips
- `test_export_json_format` — `tripModifications` + `selectedTrips` camelCase keys in JSON output
- `test_travel_time_monotonic` — `travel_time_to_stop` values are non-decreasing across replacement_stops

Full suite: 31 passed, 0 failed.

### frontend/lib/api.ts

Added `exportTripMod(rerouteId, tripId, format, token): Promise<Blob>` mirroring `exportGtfs` blob fetch pattern. Fetches `/api/gtfs/export/${encodeURIComponent(rerouteId)}/trip-modifications?trip_id=${encodeURIComponent(tripId)}&format=${format}` with `Authorization: Bearer ${token}`. Throws `new Error("TripMod export failed: " + res.statusText)` on non-ok.

### frontend/components/RerouteDashboard.tsx

Added state: `tripModExportingId: string | null`, `tripIdInputs: Record<string,string>`, `tripModExportError: string | null`.

Added `handleExportTripMod(reroute, tripId, format)`: blob download → `createObjectURL` → anchor click, file named `${safeName}-tripmod.${format}`, `tripModExportingId` set to `${reroute.id}-${format}` during call, error state set to `"Export failed. Check the trip ID and try again."` on failure.

Added "Export as TripMod Feed" section inside each expanded reroute card (after "Link a saved edit"):
- Heading `"Export as TripMod Feed"` (text-sm font-semibold)
- Label `"Original trip ID"` + shadcn `Input` placeholder `"e.g. MTD_12345"` bound to `tripIdInputs[reroute.id]`
- Helper text `"Find trip IDs at /api/gtfs/status or the MTD developer API"` (text-xs text-muted-foreground)
- `Button "Download .pb"` (primary, `aria-label="Download TripMod as .pb"`)
- `Button "Download JSON"` (outline, `aria-label="Download TripMod as JSON"`)
- Both disabled when trip_id input is empty or that format is currently exporting
- Each shows `Loader2 + "Exporting…"` while active
- `tripModExportError` shown in `text-destructive` below buttons when set

## TDD Gate Compliance

- RED gate: commit `8925382` — `test(04-03): add failing tests for _build_trip_mod_feed export (RED)`
- GREEN gate: commit `3135dc5` — `feat(04-03): _build_trip_mod_feed + GET /export/{reroute_id}/trip-modifications`

Both gates present in correct order.

## Verification Results

```
cd backend && MTD_API_KEY=test SUPABASE_URL=https://x.supabase.co SUPABASE_SERVICE_ROLE_KEY=test PYTHONPATH=. python -m pytest tests/ -q
# → 31 passed

cd frontend && npx tsc --noEmit
# → No errors found

eslint components/RerouteDashboard.tsx lib/api.ts
# → 1 warning (pre-existing react-hooks/set-state-in-effect in useEffect, unrelated to changes), 0 errors
```

## Deviations from Plan

None — plan executed exactly as written.

The TDD RED phase uses the existing skip-guard pattern (`_requires_export = pytest.mark.skipif(not _EXPORT_AVAILABLE, ...)`) established in Plan 01 scaffold. The tests transition from SKIP → PASS when `_build_trip_mod_feed` becomes importable, which is the intended behavior for this scaffold approach.

## Known Stubs

None. All created/modified files implement complete functionality as specified.

## Threat Flags

All new surfaces are covered by the plan's threat model:

| Flag | File | Description |
|------|------|-------------|
| threat_flag: information_disclosure | backend/app/routers/gtfs.py | GET /export/{reroute_id}/trip-modifications — mitigated by ownership check (reroutes.user_id == authenticated user_id → 404, T-4-06) |
| threat_flag: header_injection | backend/app/routers/gtfs.py | Content-Disposition filename — mitigated by re.sub sanitization (T-4-07) |
| threat_flag: spoofing | backend/app/routers/gtfs.py | Unauthenticated export — mitigated by Depends(_user_id) requiring Supabase JWT (T-4-08) |

No surfaces beyond the plan's threat register.

## Self-Check: PASSED

Files verified:
- backend/app/routers/gtfs.py (contains `_build_trip_mod_feed`, `trip-modifications`, `SerializeToString`, `MessageToJson`): FOUND
- backend/tests/test_tripmod.py (31 passed): FOUND
- frontend/lib/api.ts (exportTripMod): FOUND
- frontend/components/RerouteDashboard.tsx (Export as TripMod Feed, Download .pb, Download JSON, handleExportTripMod): FOUND

Commits verified:
- 8925382 (Task 1 RED): FOUND
- 3135dc5 (Task 1 GREEN): FOUND
- ad44681 (Task 2): FOUND
