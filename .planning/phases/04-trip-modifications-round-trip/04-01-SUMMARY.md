---
phase: 04-trip-modifications-round-trip
plan: "01"
subsystem: backend
tags: [gtfs-rt, protobuf, rt-01, wave-0, tdd]
dependency_graph:
  requires: []
  provides:
    - gtfs_realtime_pb2.FeedMessage with TripModifications (field 8 on FeedEntity)
    - RT-01 hourly GTFS-RT feed refresh loop (_gtfs_rt_refresh_loop)
    - get_gtfs_rt_feed Depends guard (503 when RT feed not yet fetched, D-07)
    - gtfs_rt_feed_url setting (default https://gtfs-rt.mtd.org/)
    - Wave 0 test scaffold (test_tripmod.py) with 3 passing + 8 skipped tests
  affects:
    - backend/app/main.py (lifespan adds gtfs_rt_feed init + rt_task)
    - backend/app/routers/gtfs.py (get_gtfs_rt_feed guard added)
    - backend/app/services/gtfs.py (load_gtfs_rt_feed + _gtfs_rt_refresh_loop)
tech_stack:
  added:
    - protobuf>=4.25.0 (runtime, for generated FeedMessage classes)
    - grpcio-tools>=1.50.0 (dev-only, for proto regeneration via Makefile)
  patterns:
    - Generated pb2.py committed to repo (not installed at runtime via grpcio-tools)
    - RT refresh loop mirrors Phase 1 _refresh_loop: asyncio.sleep first, warn-don't-crash
    - Depends guard mirrors get_gtfs_feed 503 pattern for RT feed
key_files:
  created:
    - backend/app/gtfs_realtime_pb2.py (generated from google/transit gtfs-realtime.proto)
    - backend/requirements-dev.txt (grpcio-tools dev dependency)
    - backend/Makefile (proto target for regeneration documentation)
    - backend/tests/test_tripmod.py (Wave 0 scaffold: 11 tests, 3 passing, 8 skipped)
  modified:
    - backend/requirements.txt (added protobuf>=4.25.0)
    - backend/app/config.py (added gtfs_rt_feed_url setting)
    - backend/app/services/gtfs.py (added load_gtfs_rt_feed + _gtfs_rt_refresh_loop)
    - backend/app/routers/gtfs.py (added get_gtfs_rt_feed guard, pb2 import)
    - backend/app/main.py (added gtfs_rt_feed init, initial fetch attempt, rt_task lifecycle)
    - backend/tests/conftest.py (added mock_gtfs_feed fixture)
decisions:
  - "Generated pb2.py from google/transit proto rather than using gtfs-realtime-bindings 2.0.0 (confirmed lacks TripModifications)"
  - "grpcio-tools dev-only in requirements-dev.txt — not in runtime image (avoids large native wheel)"
  - "Hard-coded asyncio.sleep(3600) in RT refresh loop (D-06 once-per-hour hard cap, not settings-derived)"
  - "Initial RT feed fetch in lifespan is warn-don't-crash (leaves None on failure, triggering 503 until first success)"
metrics:
  duration: "27 minutes"
  completed: "2026-06-09"
  tasks_completed: 3
  files_created: 4
  files_modified: 6
---

# Phase 4 Plan 01: Protobuf Foundation + RT-01 Infrastructure Summary

**One-liner:** Generated gtfs_realtime_pb2.py from google/transit proto (includes TripModifications), implemented RT-01 hourly GTFS-RT background fetch with warn-don't-crash, and added get_gtfs_rt_feed 503 guard — establishing the foundation all Phase 4 plans depend on.

## Tasks Completed

| Task | Description | Commit | Type |
|------|-------------|--------|------|
| 1 | Generate gtfs_realtime_pb2.py + dev tooling (Makefile, requirements-dev.txt) | 83b544f | feat |
| 2 (RED) | Failing tests for RT-01 loop and 503 guard | c552859 | test |
| 2 (GREEN) | RT-01 refresh loop + get_gtfs_rt_feed guard + gtfs_rt_feed_url setting | 928265e | feat |
| 3 | Wave 0 test scaffold — mock_gtfs_feed fixture in conftest.py | ed1b1ac | feat |

## Key Changes

### backend/app/gtfs_realtime_pb2.py (new)
Generated from `https://raw.githubusercontent.com/google/transit/master/gtfs-realtime/proto/gtfs-realtime.proto` using grpcio-tools 1.81.0. Provides `FeedMessage`, `FeedEntity.trip_modifications` (field 8), `TripModifications`, `Modification`, `SelectedTrips`, `ReplacementStop`, `StopSelector`. Committed to repo — only `protobuf>=4.25.0` needed at runtime.

### backend/app/services/gtfs.py
Added `load_gtfs_rt_feed()` — async function using `httpx.AsyncClient(timeout=30)`, parses binary protobuf via `pb2.FeedMessage().ParseFromString()`. Added `_gtfs_rt_refresh_loop()` mirroring existing `_refresh_loop`: sleeps 3600s first, retains prior feed on failure (warn-don't-crash, never sets to None after first success).

### backend/app/routers/gtfs.py
Added `get_gtfs_rt_feed(request: Request) -> pb2.FeedMessage` guard: returns `request.app.state.gtfs_rt_feed` or raises `HTTPException(503, "GTFS-RT feed not yet available")`. Plans 02-03 consume this via `Depends(get_gtfs_rt_feed)`.

### backend/app/main.py
Lifespan now: initializes `app.state.gtfs_rt_feed = None`, attempts initial `load_gtfs_rt_feed()` in try/except (warn-don't-crash), spawns `rt_task = asyncio.create_task(gtfs_svc._gtfs_rt_refresh_loop(app))`, cancels `rt_task` on shutdown.

### backend/tests/test_tripmod.py (new)
Wave 0 scaffold with 11 named tests:
- **3 PASSING:** `test_proto_round_trip`, `test_rt_refresh_retains_on_failure`, `test_import_503_when_rt_feed_none`
- **8 SKIPPED** (skip-guarded for Plans 02-03): `test_parse_resolves_known_stop`, `test_parse_skips_unknown_stop`, `test_import_endpoint_200`, `test_import_bad_url_error`, `test_import_ssrf_blocked`, `test_export_round_trip_pb`, `test_export_json_format`, `test_travel_time_monotonic`

## TDD Gate Compliance

- RED gate: commit `c552859` — `test(04-01): add failing tests for RT-01 refresh loop and get_gtfs_rt_feed guard`
- GREEN gate: commit `928265e` — `feat(04-01): RT-01 hourly refresh loop, get_gtfs_rt_feed guard, gtfs_rt_feed_url setting`

Both gates present in correct order.

## Verification Results

```
cd backend && python -c "from app.gtfs_realtime_pb2 import FeedMessage; m=FeedMessage(); e=m.entity.add(); e.trip_modifications.SetInParent(); print('ok')"
# → ok

cd backend && python -m pytest tests/ -q
# → 23 passed, 8 skipped, 3 warnings
```

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

One minor adjustment: the generated docstring for `load_gtfs_rt_feed()` initially contained the string `httpx.get()` which would have caused acceptance criterion 4 (grep check) to fail. Fixed by rewriting the docstring to avoid the literal function-call syntax.

## Known Stubs

None. All created/modified files implement complete functionality. The 8 skipped tests in `test_tripmod.py` are intentional Wave 0 scaffolding — the functions they test (`_resolve_stop`, `_build_trip_mod_feed`, `_parse_trip_mod_feed`) are implemented in Plans 02 and 03 respectively.

## Threat Flags

No new threat surfaces introduced beyond those in the plan's threat model:
- T-4-01 (generated pb2.py from upstream proto) — mitigated: generated from official google/transit proto, committed for review, Makefile documents regeneration
- T-4-DoS (RT-01 external fetch) — mitigated: httpx timeout=30, warn-don't-crash retains prior feed, hard-coded 3600s prevents request-driven amplification

## Self-Check: PASSED

Files verified:
- backend/app/gtfs_realtime_pb2.py: FOUND
- backend/requirements-dev.txt: FOUND
- backend/Makefile: FOUND
- backend/tests/test_tripmod.py: FOUND
- backend/tests/conftest.py (mock_gtfs_feed): FOUND

Commits verified:
- 83b544f (Task 1: proto generation): FOUND
- c552859 (Task 2 RED): FOUND
- 928265e (Task 2 GREEN): FOUND
- ed1b1ac (Task 3: scaffold): FOUND
