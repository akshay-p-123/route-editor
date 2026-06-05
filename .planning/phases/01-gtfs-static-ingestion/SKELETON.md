# Walking Skeleton: GTFS Static Ingestion

**Phase:** 1 — GTFS Static Ingestion
**Established:** 2026-06-05
**Purpose:** Records the architectural decisions for the GTFS in-memory feed singleton that all later phases (Export, Trip Updates, TripModifications, Estimation) build on without renegotiating.

## What the Skeleton Proves

The thinnest end-to-end working slice of the GTFS milestone, exercised on real infrastructure:

1. **Build** — Docker image builds with the GDAL system dependency gtfs-kit requires (`libgdal-dev`, base image unchanged at `python:3.12-slim`).
2. **Startup ingest** — Backend downloads MTD's GTFS static zip and parses it into in-memory pandas DataFrames on app startup.
3. **One real DB-equivalent read** — `GET /api/gtfs/status` reads the loaded feed singleton and returns real route/stop/trip counts.
4. **One real UI/BFF interaction** — The endpoint is reachable from the frontend through the existing Next.js BFF rewrite (`/api/:path*` -> backend) with no frontend code change.
5. **Dev deployment** — `docker build` + `docker run --env-file backend/.env` produces a running, reachable service.

## Architectural Decisions (binding for downstream phases)

### Storage: in-memory singleton, no database
- The parsed GTFS feed lives on `app.state.gtfs_feed` as a `GtfsFeed` dataclass (`feed: gtfs_kit.Feed`, `loaded_at: datetime`).
- No Supabase, SQLite, or on-disk persistence for GTFS data (single-worker deployment; ~26 MB single-agency feed). See REQUIREMENTS.md "Out of Scope".
- `app.state.gtfs_feed is None` is the canonical "not yet loaded" signal — no separate loading flag (D-07).

### GTFS library: gtfs-kit
- `gtfs-kit` selected over `partridge`/`pygtfs` (pre-roadmap decision, STATE.md). Used for both ingestion (this phase) and export (Phase 2).
- Parse is synchronous/CPU-bound; always run via `run_in_executor` so it never blocks the asyncio event loop.

### Loading + refresh: FastAPI lifespan + asyncio task
- Initial load fires inside the existing lifespan `asyncio.gather` alongside the MTD cache warmup (D-02).
- Background refresh is a plain `asyncio.create_task(_refresh_loop(app))` with `while True: await asyncio.sleep(interval)` — no APScheduler (D-02). Interval from `GTFS_REFRESH_INTERVAL_HOURS` (default 6, D-03). Task cancelled on lifespan shutdown.
- Warn-don't-crash on failure: a failed load/refresh logs a warning and retains the prior feed; never sets the feed to None after first success (D-04).

### Access contract for later phases: the 503 guard dependency
- `get_gtfs_feed(request: Request) -> GtfsFeed` in `backend/app/routers/gtfs.py` is the reusable FastAPI `Depends()` guard (D-05).
- Every GTFS-dependent endpoint in Phases 2-5 MUST inject `feed: GtfsFeed = Depends(get_gtfs_feed)` to get a guaranteed-loaded feed (503 otherwise). This is the single integration point downstream phases consume.

### Directory layout (follows existing backend conventions)
- `backend/app/services/gtfs.py` — load function, `GtfsFeed` dataclass, refresh loop (mirrors `services/mtd.py`).
- `backend/app/routers/gtfs.py` — router on `/api/gtfs`, 503 guard, status endpoint (mirrors `routers/mtd.py`).
- `backend/app/config.py` — `gtfs_feed_url`, `gtfs_refresh_interval_hours` settings.
- `backend/app/main.py` — lifespan + router registration.

### Network / BFF
- No direct browser-to-FastAPI calls. The browser reaches GTFS endpoints via the Next.js `/api/:path*` rewrite (`frontend/next.config.ts`). New backend routes under `/api/gtfs/*` are automatically reachable; no `app/api/` route handler needed for read-only GTFS endpoints.

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `GTFS_FEED_URL` | `https://mtd.dev/gtfs.zip` | Source GTFS static zip (overridable for tests/staging) |
| `GTFS_REFRESH_INTERVAL_HOURS` | `6` | Background refresh cadence |

## Open Verification Items (resolved during Task 4)
- MTD stop_id namespace alignment between GTFS `stops.txt` and MTD API v3 `route_stops` — cross-reference one known stop during load (STATE.md Phase 1 entry concern).
