---
phase: 02-gtfs-export
plan: 01
subsystem: api
tags: [gtfs, fastapi, pytest, pandas, gtfs-kit, osrm, supabase]

# Dependency graph
requires:
  - phase: 01-gtfs-static-ingestion
    provides: "app.state.gtfs_feed (GtfsFeed dataclass) for optional agency enrichment; gtfs-kit installed"
provides:
  - "GET /api/gtfs/export/{reroute_id} FastAPI endpoint returning application/zip"
  - "_build_routes_df, _build_stops_df, _build_trips_df, _build_shapes_df, _build_stop_times_df, _build_calendar_dates_df, _build_feed_info_df, _build_agency_df pure DataFrame builder functions"
  - "_write_feed async zip writer via run_in_executor + feed.to_file()"
  - "pytest test suite with 9 passing tests covering EXPORT-01,02,04,05,06,07,08,10"
affects: [02-gtfs-export-frontend, 02-gtfs-validator, 03-gtfs-realtime]

# Tech tracking
tech-stack:
  added: [pytest>=8.0.0, pytest-asyncio>=0.23.0, pyproject.toml with asyncio_mode=auto]
  patterns:
    - "TDD RED/GREEN: stubs (skip on ImportError) → builders → GREEN"
    - "Pure builder functions (no I/O) for easy unit testing"
    - "warn-don't-crash: OSRM failure returns None, export still completes with 60s/stop fallback"
    - "_client()/_user_id() duplicated from reroutes.py (project convention)"
    - "feed.to_file(pathlib.Path) via run_in_executor; NamedTemporaryFile for zip path"

key-files:
  created:
    - backend/pyproject.toml
    - backend/tests/__init__.py
    - backend/tests/conftest.py
    - backend/tests/test_gtfs_export.py
  modified:
    - backend/requirements.txt
    - backend/app/routers/gtfs.py

key-decisions:
  - "GET /api/gtfs/export/{reroute_id} chosen over POST — pure download, no request body needed"
  - "Empty reroute (no saved routes) returns 404 not 200+empty-zip — no value in an empty GTFS feed"
  - "Test stubs use try/except ImportError + skipif marker so --collect-only works before Task 2 builders exist"
  - "_osrm_route uses async httpx not blocking requests (consistent with services/mtd.py)"

requirements-completed: [EXPORT-01, EXPORT-02, EXPORT-03, EXPORT-04, EXPORT-05, EXPORT-06, EXPORT-07, EXPORT-08, EXPORT-10]

# Metrics
duration: 10min
completed: 2026-06-07
---

# Phase 2 Plan 01: GTFS Static Export Backend Summary

**`GET /api/gtfs/export/{reroute_id}` endpoint using gtfs-kit Feed + 8 pure DataFrame builders; pytest suite with 9 passing tests covering stop dedup, synthetic IDs, color stripping, lat/lon swap, and zip structure**

## Performance

- **Duration:** 10 min
- **Started:** 2026-06-07T01:40:22Z
- **Completed:** 2026-06-07T01:51:12Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Bootstrapped pytest test suite (pytest 9.0.3, pytest-asyncio 1.4.0, asyncio_mode=auto) with fixtures for shared stops and editor-added (None stop_id) stops
- Implemented all 8 GTFS DataFrame builders as pure functions: routes, stops (dedup + synthetic IDs), trips, shapes (lon/lat swap), stop_times (cumulative OSRM timing + 60s fallback), calendar_dates (today+90 days), feed_info, agency (live feed or hardcoded MTD values)
- Wired `GET /api/gtfs/export/{reroute_id}` endpoint with Supabase ownership check, OSRM road geometry (warn-don't-crash), gtfs-kit Feed assembly, and `application/zip` Response
- 9 tests passing: 7 unit tests (EXPORT-02,04,05,06,07,08,10) + 2 endpoint tests (EXPORT-01, T-02-01 ownership 404)

## Task Commits

Each task was committed atomically:

1. **Task 1: Bootstrap pytest suite and export fixtures** - `6ac6406` (test)
2. **Task 2: GTFS DataFrame builder functions** - `347dbd9` (feat)
3. **Task 3: Wire export_gtfs endpoint + endpoint tests** - `9d3e488` (feat)

## Files Created/Modified

- `backend/requirements.txt` - Added pytest>=8.0.0, pytest-asyncio>=0.23.0
- `backend/pyproject.toml` - Created: [tool.pytest.ini_options] asyncio_mode=auto
- `backend/tests/__init__.py` - Created: empty package marker
- `backend/tests/conftest.py` - Created: sample_reroute, sample_saved_routes (shared stop + None stop_id), mock_supabase fixtures
- `backend/tests/test_gtfs_export.py` - Created: 9 tests (7 builder unit tests + 2 endpoint tests)
- `backend/app/routers/gtfs.py` - Extended: all builder functions, _write_feed, _osrm_route, export_gtfs endpoint

## Decisions Made

- **GET over POST:** `GET /api/gtfs/export/{reroute_id}` is idiomatic REST for a resource download; no request body needed; auth via Authorization header
- **Empty reroute returns 404:** No value in returning an empty GTFS feed; client must add routes to a reroute before exporting
- **Test stubs use try/except + skipif:** Allows `--collect-only` to list all 7 test functions before Task 2 builders exist, satisfying the acceptance criteria while tests remain RED (skipped) rather than causing a collection error
- **Endpoint tests monkeypatch _osrm_route to None:** Forces fallback geometry path, eliminating network dependency in CI

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing s2sphere and py-staticmaps prevented TestClient from importing app.main**
- **Found during:** Task 3 (endpoint test execution)
- **Issue:** `app.main` imports `app.routers.export` which requires `s2sphere` and `py-staticmaps`; these are listed in `requirements.txt` but were not installed in the system Python environment used by pytest
- **Fix:** Installed s2sphere, py-staticmaps, and Pillow with pip3 (dev environment setup, no code change)
- **Files modified:** None (runtime environment only)
- **Verification:** Both endpoint tests pass after install
- **Committed in:** Included in 9d3e488 (tests already commit-ready)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking environment issue)
**Impact on plan:** No code changes needed; dev environment missing packages resolved. No scope creep.

## Issues Encountered

- RTK proxy (token optimizer) filters pytest output to "Pytest: No tests collected" even when tests pass. Used `rtk proxy python3 -m pytest ...` to bypass filtering and see full output.

## Known Stubs

None — all GTFS builder functions produce real DataFrames; endpoint returns real zip bytes.

## Threat Flags

No new threat surface beyond what the plan's `<threat_model>` covered. Mitigations implemented:
- T-02-01 (IDOR): `eq("user_id", user_id)` ownership check + 404 on miss; covered by test_export_ownership
- T-02-03 (OSRM disclosure): OSRM failure caught, logged as warning, fallback geometry used; exercised by test_export_endpoint with _osrm_route=None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Backend export endpoint ready at `/api/gtfs/export/{reroute_id}` — all 9 tests GREEN
- Phase 02-02 (frontend slice) can wire the `FileArchive` button in `RerouteDashboard` using the `exportGtfs(rerouteId, token)` pattern from RESEARCH Pattern 4
- Phase 02-03 (validator compliance) can test the endpoint manually via `gtfs-validator.mobilitydata.org` web UI

---
*Phase: 02-gtfs-export*
*Completed: 2026-06-07*
