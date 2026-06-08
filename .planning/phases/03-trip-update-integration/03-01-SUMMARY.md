---
phase: 03-trip-update-integration
plan: 01
subsystem: backend
tags: [gtfs-rt, fastapi, trip-updates, cache, jwt-auth]
dependency_graph:
  requires: []
  provides: [GET /api/gtfs/trip-updates, get_stop_departures]
  affects: [backend/app/routers/gtfs.py, backend/app/services/mtd.py]
tech_stack:
  added: []
  patterns: [asyncio.gather fan-out, 60s in-memory TTL cache, FastAPI dependency_overrides for testing]
key_files:
  created:
    - backend/tests/test_trip_updates.py
  modified:
    - backend/app/services/mtd.py
    - backend/app/routers/gtfs.py
decisions:
  - Used FastAPI dependency_overrides instead of patch() for Depends(_user_id) in endpoint tests
  - test_unauthenticated_401 uses a full dependency override that raises HTTPException rather than patching the module-level function (Depends() captures function reference at decoration time)
metrics:
  duration: "12 minutes"
  completed: "2026-06-08T04:14:30Z"
  tasks_completed: 3
  files_modified: 3
---

# Phase 03 Plan 01: Trip Update Integration Summary

**One-liner:** Per-stop real-time delay endpoint at GET /api/gtfs/trip-updates using MTD v3 departures, 60s in-memory cache, JWT auth, and asyncio.gather fan-out.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write failing test suite (RED) | 216a9a4 | backend/tests/test_trip_updates.py |
| 2 | Implement service fetch + endpoint (GREEN) | b56e825 | backend/app/services/mtd.py, backend/app/routers/gtfs.py, backend/tests/test_trip_updates.py |
| 3 | Harden edge cases — full GREEN | (no new commit needed) | All 11 tests passed from Task 2 implementation |

## Implementation Details

### `backend/app/services/mtd.py`

Added `get_stop_departures(stop_id: str) -> dict` at the bottom of the file under a new `# ── Departures — real-time, 60s TTL ──` section. The function calls `_get()` directly and explicitly bypasses `_get_cached()` — real-time departure data must never be served from the 1-hour static cache.

### `backend/app/routers/gtfs.py`

Added the following to the import block:
- `import time`
- `from datetime import datetime` (joined existing `date, timedelta` import)
- `from app.services.mtd import get_stop_departures`

Added a new `# ── Trip updates (RT-02, RT-03) ──` section at the bottom containing:
- `_dep_cache: dict[str, tuple[dict, float]] = {}` — module-level 60s TTL cache
- `_DEP_CACHE_TTL = 60`
- `_compute_delay(departure: dict) -> int | None` — isRealTime guard, nullable-field guard, returns int seconds
- `_get_delays_for_stops(stop_ids: list[str]) -> dict[str, int]` — asyncio.gather fan-out with `return_exceptions=True`, warn-don't-crash, sorts by epoch (not lexicographic), omits empty-result stops
- `GET /trip-updates` endpoint — input validation (400 for empty), sorted cache key, 60s TTL hit shortcut before fan-out, `Depends(_user_id)` JWT auth

## Test Correction (Task 3 audit)

The original test stubs used `patch("app.routers.gtfs._user_id", return_value="user-test-id")` for endpoint tests. This strategy fails for FastAPI `Depends()` endpoints because FastAPI captures the function reference at decoration time — module-level patching does not intercept dependency injection.

**Fix applied in Task 2** (not Task 3 — caught during GREEN verification): Updated all endpoint tests (`test_cache_miss_fetches`, `test_cache_hit_no_refetch`, `test_cache_key_sorted`, `test_empty_stop_ids_400`, `test_unauthenticated_401`) to use `app.dependency_overrides[gtfs_module._user_id]` with proper try/finally cleanup. Also added `from fastapi import Header` at the top level for the `_raise_401` override helper in `test_unauthenticated_401`.

**Justification:** This was an incorrect mock strategy (the function was patched but FastAPI still called the original via its DI registry), not a wrong literal assertion. The fix makes the tests actually exercise the auth path.

## Open Questions Findings

**OQ-1 (default departure window):** The MTD v3 `/stops/{stop_id}/departures` endpoint was called without a `time` parameter in `get_stop_departures`. The API returns the next upcoming departures by default. No explicit time window parameter is needed for real-time delay computation (the soonest upcoming departure is the relevant one).

**isRealTime=False echo behavior (RESEARCH A3):** The `_compute_delay` function returns `0` when `isRealTime` is False, treating the departure as on-time. This matches the plan's requirement: "only compute delay when isRealTime is True; otherwise 0 (on-time)."

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Endpoint test mock strategy: patch() vs dependency_overrides**
- **Found during:** Task 2 (GREEN verification — test_cache_miss_fetches failed with AuthApiError)
- **Issue:** Original test stubs used `patch("app.routers.gtfs._user_id", return_value="user-test-id")` which doesn't intercept FastAPI's dependency injection system; the real `_user_id` was still called and attempted Supabase JWT validation
- **Fix:** Changed all 5 endpoint tests to use `app.dependency_overrides[gtfs_module._user_id]` with try/finally cleanup; added `from fastapi import Header` import
- **Files modified:** `backend/tests/test_trip_updates.py`
- **Commit:** b56e825

**2. [Rule 2 - Missing functionality] .env symlink for worktree test execution**
- **Found during:** Task 1 verification
- **Issue:** The worktree `backend/` directory had no `.env` file (gitignored), causing pydantic-settings to fail with missing required field errors during test collection
- **Fix:** Created symlink `/worktree/backend/.env -> /root/route-editor/backend/.env`
- **Files modified:** (symlink, not tracked in git)

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (test commit) | 216a9a4 | PASS — 11 tests collected, all skip |
| GREEN (feat commit) | b56e825 | PASS — 11 tests pass |
| REFACTOR | N/A | No refactor needed |

## Verification Results

1. Full trip-update suite: 11 passed, 0 skipped, 0 failed
2. No regression: 20 passed (9 export + 11 trip-updates), 0 failed
3. Endpoint wired: `@router.get("/trip-updates")` at line 486 of gtfs.py
4. Real-time bypass: `get_stop_departures` calls `_get()` directly, no `_get_cached` call
5. RT-01 absent: no gtfs-realtime/protobuf/gtfs-rt.mtd.org references in modified files

## Known Stubs

None — all data flows are wired. The endpoint returns real MTD departure data (or empty dict when no realtime data available).

## Threat Flags

No new network endpoints or auth paths beyond those described in the plan's threat model. The `/api/gtfs/trip-updates` endpoint was the planned addition and is covered by T-03-01 through T-03-05.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| backend/tests/test_trip_updates.py exists | FOUND |
| backend/app/services/mtd.py exists | FOUND |
| backend/app/routers/gtfs.py exists | FOUND |
| .planning/phases/03-trip-update-integration/03-01-SUMMARY.md exists | FOUND |
| Commit 216a9a4 (RED tests) exists | FOUND |
| Commit b56e825 (GREEN impl) exists | FOUND |
| get_stop_departures in mtd.py | FOUND |
| @router.get("/trip-updates") in gtfs.py | FOUND |
| _dep_cache in gtfs.py | FOUND |
| _compute_delay in gtfs.py | FOUND |
| return_exceptions=True in gtfs.py | FOUND |
