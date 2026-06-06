---
phase: 01-gtfs-static-ingestion
plan: "01"
subsystem: api
tags: [gtfs, gtfs-kit, fastapi, gdal, background-refresh, 503-guard]

# Dependency graph
requires: []
provides:
  - "GtfsFeed dataclass and load_gtfs_feed() in backend/app/services/gtfs.py"
  - "app.state.gtfs_feed in-memory singleton populated on startup"
  - "GET /api/gtfs/status endpoint returning feed metadata (loaded_at, routes, stops, trips)"
  - "get_gtfs_feed Depends() guard raising 503 while feed not loaded"
  - "Background _refresh_loop running every gtfs_refresh_interval_hours (default 6h)"
  - "Docker image with libgdal-dev system dependency for gtfs-kit/geopandas"
affects: [02-gtfs-export, 03-gtfs-rt-trip-updates, 04-trip-modifications, 05-estimation]

# Tech tracking
tech-stack:
  added:
    - "gtfs-kit>=7.0.0 (PyPI — GTFS static feed parsing)"
    - "libgdal-dev (Debian apt — GDAL system lib required by geopandas/gtfs-kit)"
  patterns:
    - "app.state.gtfs_feed singleton — canonical in-memory GTFS store for all downstream phases"
    - "get_gtfs_feed Depends() guard — all GTFS-dependent endpoints inject this to get a 503 before load"
    - "run_in_executor for sync CPU-bound parse — gtfs_kit.read_feed never blocks the asyncio event loop"
    - "warn-don't-crash refresh — background refresh failure retains prior feed, logs warning, continues loop"
    - "app.state.gtfs_feed = None as first lifespan statement — 503 guard active during startup load"

key-files:
  created:
    - backend/app/services/gtfs.py
    - backend/app/routers/gtfs.py
  modified:
    - backend/requirements.txt
    - backend/Dockerfile
    - backend/app/config.py
    - backend/app/main.py

key-decisions:
  - "app.state.gtfs_feed = None is set as first lifespan statement so 503 guard fires during startup load (D-07)"
  - "gtfs_kit.read_feed runs in run_in_executor to avoid blocking asyncio event loop (D-06)"
  - "Background refresh via plain asyncio.create_task(_refresh_loop) — no APScheduler (D-02)"
  - "Failed refresh logs warning and retains prior feed — feed never set to None after first success (D-04)"
  - "get_gtfs_feed Depends() is the single integration point for all downstream GTFS endpoints (D-05)"

patterns-established:
  - "503 guard pattern: def get_gtfs_feed(request: Request) -> GtfsFeed — inject via Depends() in all GTFS routers"
  - "GTFS service pattern: mirrors services/mtd.py structure with module logger and async httpx download"
  - "Lifespan task pattern: create_task before yield, task.cancel() after yield"

requirements-completed: [INGEST-01, INGEST-02, INGEST-03, INGEST-04]

# Metrics
duration: 2min
completed: "2026-06-06"
---

# Phase 1 Plan 1: GTFS Static Ingestion Walking Skeleton Summary

**GTFS static feed ingestion stack: gtfs-kit parses MTD feed on startup into app.state.gtfs_feed, 503 guard protects callers, background refresh runs every 6h, GET /api/gtfs/status exposes metadata via Next.js BFF**

## Performance

- **Duration:** 2 min
- **Started:** 2026-06-06T00:20:36Z
- **Completed:** 2026-06-06T00:22:42Z
- **Tasks:** 3 automated (Task 4 is checkpoint:human-verify, awaiting user)
- **Files modified:** 6

## Accomplishments
- Docker image extended with libgdal-dev for gtfs-kit/geopandas compatibility (INGEST-04)
- GtfsFeed dataclass and async load pipeline established: httpx download -> tempfile -> gtfs-kit parse off event loop (INGEST-01)
- 503 guard Depends() established as the integration contract for all downstream GTFS endpoints (INGEST-03)
- Background _refresh_loop with warn-don't-crash semantics, cancellable on shutdown (INGEST-02)
- GET /api/gtfs/status endpoint reachable through existing Next.js /api/:path* BFF rewrite with no frontend changes

## Task Commits

Each task was committed atomically:

1. **Task 1: Add gtfs-kit dependency, GDAL system lib, and GTFS settings** - `e826502` (feat)
2. **Task 2: Create GTFS service — load function, GtfsFeed dataclass, background refresh loop** - `3178694` (feat)
3. **Task 3: Create GTFS router with 503 guard + status endpoint, wire lifespan + router into main.py** - `2e9d986` (feat)

Task 4 (human-verify) is paused pending user verification.

## Files Created/Modified
- `backend/app/services/gtfs.py` - GtfsFeed dataclass, load_gtfs_feed(), load_and_store(app), _refresh_loop(app)
- `backend/app/routers/gtfs.py` - get_gtfs_feed 503 guard Depends(), GET /gtfs/status endpoint
- `backend/app/main.py` - lifespan extended with app.state.gtfs_feed init, gather, refresh task, gtfs router
- `backend/app/config.py` - gtfs_feed_url and gtfs_refresh_interval_hours settings added
- `backend/requirements.txt` - gtfs-kit>=7.0.0 added
- `backend/Dockerfile` - libgdal-dev added to existing apt-get install block

## Decisions Made
- Set `app.state.gtfs_feed = None` as the first statement in lifespan so the 503 guard is active immediately during startup
- Used `run_in_executor` for `gtfs_kit.read_feed` since it is synchronous and CPU-bound (pandas/geopandas)
- Background refresh uses plain `asyncio.create_task` + `while True: await asyncio.sleep(interval)` — no APScheduler needed per D-02
- Failed refresh logs warning via `logger.warning` and continues the loop — the prior feed is retained, feed never set to None after first success

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## Known Stubs
None — no placeholder data or hardcoded empty values in the new files.

## Threat Flags
No new threat surface beyond what is documented in the plan's threat model (T-01-01 through T-01-SC). The 60s httpx timeout (T-01-01), 503-while-loading guard (T-01-02), warn-on-corrupt-feed (T-01-03), and graceful refresh failure (T-01-05) are all implemented as specified.

## User Setup Required
The `GTFS_FEED_URL` and `GTFS_REFRESH_INTERVAL_HOURS` env vars have defaults in config.py and do not require manual configuration for the standard MTD setup. No new secrets required.

## Next Phase Readiness
- `app.state.gtfs_feed` singleton is established — all downstream phases (02-gtfs-export, 03-gtfs-rt, 04-trip-modifications, 05-estimation) can inject `feed: GtfsFeed = Depends(get_gtfs_feed)` and receive a guaranteed-loaded feed or a 503
- Task 4 (human-verify) must be completed by the user before this plan is marked fully done: Docker build must succeed, 503 guard must fire during startup, /api/gtfs/status must return non-zero counts, and the endpoint must be reachable via the frontend BFF

---
*Phase: 01-gtfs-static-ingestion*
*Completed: 2026-06-06*
