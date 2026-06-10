---
phase: 04-trip-modifications-round-trip
plan: 04
subsystem: api
tags: [gtfs-kit, fastapi, multipart-upload, supabase, react-query, formdata]

# Dependency graph
requires:
  - phase: 04-trip-modifications-round-trip
    provides: "GTFS export endpoints (04-01) and RerouteDashboard export UI (04-03) — shared file/component, sequencing only"
provides:
  - "POST /api/gtfs/import — multipart GTFS zip upload, parses with gtfs_kit.read_feed off the event loop, creates one reroutes record + one saved_routes row per route + route_stops rows"
  - "Stop matching: exact stop_id match against feed.stops, else synthetic custom_{route_pk}_{stop_sequence} fallback"
  - "importGtfs() FormData client in frontend/lib/api.ts"
  - "Import GTFS footer button in RerouteDashboard with loading/error states and reroute-list refresh"
affects: [gtfs-export-roundtrip, reroute-ingestion]

# Tech tracking
tech-stack:
  added: [python-multipart>=0.0.9]
  patterns:
    - "FastAPI Depends(_user_id) tested via app.dependency_overrides, not unittest.mock.patch"
    - "Blocking gtfs_kit.read_feed() run via loop.run_in_executor with tempfile staging + os.unlink in finally"
    - "50MB upload size guard (413) before any parsing"
    - "Filename sanitization re.sub(r'[^\\w\\-]', '_', filename) for reroute name"

key-files:
  created:
    - backend/tests/test_gtfs_import.py
  modified:
    - backend/app/routers/gtfs.py
    - backend/requirements.txt
    - frontend/lib/api.ts
    - frontend/components/RerouteDashboard.tsx

key-decisions:
  - "python-multipart added as direct dependency — required by FastAPI for UploadFile/Form parsing, verified canonical PyPI package named in FastAPI's own error message"
  - "_resolve_route_stops takes the first trip_id per route as the representative stop sequence (consistent with existing export-side conventions)"
  - "Test filename-sanitization expectation corrected to 'My_Feed_zip' (regex strips '.' too) — implementation matches PATTERNS.md spec, test was wrong"

patterns-established:
  - "Multipart upload TDD tests use app.dependency_overrides[module._user_id] = lambda: 'user-123', not patch() — required for Depends()-injected auth"

requirements-completed: [TRIPMOD-01]

# Metrics
duration: 22min
completed: 2026-06-10
---

# Phase 4 Plan 4: GTFS Zip Import Summary

**POST /api/gtfs/import endpoint parses uploaded GTFS zips with gtfs_kit and creates a full reroute package (routes + stops) in Supabase, with an Import GTFS button in RerouteDashboard wired to refresh the reroute list.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-06-10T01:34:31Z (RED commit)
- **Completed:** 2026-06-10T01:48:42Z (frontend commit)
- **Tasks:** 3 of 3
- **Files modified:** 5 (1 created)

## Accomplishments
- New `POST /api/gtfs/import` endpoint: 50MB upload guard (413), tempfile + `run_in_executor` staging for `gtfs_kit.read_feed()`, 422 on unparseable zips, creates `reroutes` + `saved_routes` (one per route) + `route_stops` rows under the authenticated user
- Stop matching implemented: exact `stop_id` lookup against `feed.stops`, falling back to synthetic `custom_{route_pk}_{stop_sequence}` ids when a stop_id isn't present in the static feed (e.g. flex/on-demand stops)
- `importGtfs()` FormData client added to `frontend/lib/api.ts` (15s AbortController timeout, no Content-Type override so the browser sets the multipart boundary)
- RerouteDashboard footer converted to a two-button row: outline "Import GTFS" button (hidden file input, `.zip` accept) + primary "New Reroute" button; shows `Loader2` spinner during import, refreshes `["reroutes"]` query on success, shows inline auto-dismissing error on failure
- Full backend test suite (35 tests, including 4 new) green; `tsc --noEmit` and `eslint` clean on modified frontend files

## Task Commits

Each task was committed atomically:

1. **Task 1: GTFS zip import endpoint (TDD)** —
   - RED: `329b46c` — `test(04-04): add failing tests for GTFS zip import endpoint`
   - GREEN: `ae1c848` — `feat(04-04): GTFS zip import endpoint creates reroute package from upload`
2. **Task 2: Frontend importGtfs client + Import GTFS button** - `602be40` — `feat(04-04): importGtfs FormData client + Import GTFS button in RerouteDashboard`

**Plan metadata:** (this commit)

## Files Created/Modified
- `backend/tests/test_gtfs_import.py` - 4 tests: creates reroute from valid feed, 422 on invalid zip, synthetic stop_id fallback, 413 on oversized upload
- `backend/app/routers/gtfs.py` - `_resolve_route_stops()` helper + `POST /import` endpoint (50MB guard, tempfile/executor parsing, reroute+saved_routes+route_stops inserts)
- `backend/requirements.txt` - added `python-multipart>=0.0.9`
- `frontend/lib/api.ts` - added `importGtfs(file, token)` FormData client
- `frontend/components/RerouteDashboard.tsx` - Import GTFS footer button, hidden file input, `handleGtfsFileChange`, loading/error state

## Decisions Made
- `python-multipart` is a direct, canonical FastAPI dependency (named explicitly in FastAPI's own runtime error for missing multipart support) — installed and pinned in `requirements.txt` rather than treated as a Rule-3-excluded unverified package.
- Representative stop sequence per route is taken from the first `trip_id` matching that `route_id` in `feed.trips`, mirroring the simplification already used on the export side.
- Test expectation for sanitized reroute name corrected to `"My_Feed_zip"` (the `re.sub(r'[^\w\-]', '_', filename)` pattern from PATTERNS.md strips `.` along with spaces) — the implementation was correct per spec; the test was fixed to match.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing python-multipart dependency**
- **Found during:** Task 1 (GREEN) — `RuntimeError: Form data requires "python-multipart" to be installed.`
- **Issue:** FastAPI's `UploadFile`/`File()` multipart parsing requires `python-multipart`, which was not in `requirements.txt`.
- **Fix:** `pip3 install --break-system-packages python-multipart` (PEP 668 externally-managed env required the flag), added `python-multipart>=0.0.9` to `backend/requirements.txt`. Verified as the canonical FastAPI-documented package, not a slopsquat risk.
- **Files modified:** `backend/requirements.txt`
- **Verification:** Endpoint no longer raises on multipart requests; full test suite passes.
- **Committed in:** `ae1c848` (Task 1 GREEN commit)

**2. [TDD test fix] Corrected dependency-injection mocking pattern in tests**
- **Found during:** Task 1 (RED→GREEN) — `patch("app.routers.gtfs._user_id", ...)` had no effect on a `Depends(_user_id)`-injected endpoint.
- **Issue:** `_user_id` is resolved by FastAPI's dependency injection at a different layer than direct calls; `unittest.mock.patch` on the module attribute doesn't affect the already-bound `Depends()` callable.
- **Fix:** Switched all 4 tests to `app.dependency_overrides[gtfs_module._user_id] = lambda: "user-123"` with cleanup in `finally`, matching the pattern already used in `test_trip_updates.py`.
- **Files modified:** `backend/tests/test_gtfs_import.py`
- **Verification:** All 4 tests pass with real auth-dependency wiring exercised correctly.
- **Committed in:** `329b46c` / `ae1c848`

---

**Total deviations:** 2 (1 blocking dependency install, 1 TDD test-infrastructure correction)
**Impact on plan:** Both necessary for the endpoint to function and be correctly tested. No scope creep.

## Issues Encountered
- Live smoke-test via `curl -H "Authorization: Bearer fake"` returned HTTP 500 instead of 401. Root cause: the shared `_user_id()` helper (used identically across `gtfs.py`, `routes.py`, `reroutes.py`) does not catch `supabase_auth.errors.AuthApiError` raised when the token is not a syntactically valid JWT — it only handles the "valid JWT but no user" case. This is **pre-existing behavior**, not introduced by this plan, and is not hit by the real frontend flow (which always supplies a real Supabase JWT). Logged to `deferred-items.md` for a future cross-cutting fix; not modified here per scope boundary.

## Known Stubs
None — both endpoint and UI are fully wired to live Supabase tables and the real reroute query cache.

## User Setup Required
None - no external service configuration required.

## Task 3: Verification

**Task 3 (checkpoint:human-verify, gate=blocking) — APPROVED by user.**

User confirmed Import GTFS button in RerouteDashboard works end-to-end (upload,
loading state, reroute list refresh). Phase 04 (trip-modifications-round-trip)
is complete (4/4 plans).

- Deferred: `_user_id()` malformed-JWT 500 — see `deferred-items.md` for a future fix recommendation.

---
*Phase: 04-trip-modifications-round-trip*
*Completed: 2026-06-10*

## Self-Check: PASSED

All created/modified files found on disk; all 3 task commits (329b46c, ae1c848, 602be40) found in git log.
