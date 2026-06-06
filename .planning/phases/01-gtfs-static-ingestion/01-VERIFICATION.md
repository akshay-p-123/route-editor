---
phase: 01-gtfs-static-ingestion
verified: 2026-06-06T04:00:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 3/4
  gaps_closed:
    - "Docker image builds without error — playwright block and Chromium system libraries removed from Dockerfile; only libgdal-dev remains"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Run a full clean Docker build from scratch and confirm it succeeds end-to-end"
    expected: "docker build --no-cache -t route-editor-backend ./backend completes with exit 0; no apt or pip error; image builds with libgdal-dev and gtfs-kit installed"
    why_human: "Docker daemon not available in verifier environment; build correctness requires executing the Dockerfile, not just reading it"
  - test: "Start the container and confirm /api/gtfs/status returns real MTD counts after startup"
    expected: "curl http://localhost:8000/api/gtfs/status returns 200 JSON with non-zero routes/stops/trips and a loaded_at ISO timestamp; startup logs show GTFS load info line"
    why_human: "Requires network access to mtd.dev/gtfs.zip and a running container; cannot be tested by code inspection alone"
---

# Phase 1: GTFS Static Ingestion Verification Report

**Phase Goal:** Deliver the GTFS Static Ingestion walking skeleton — backend downloads MTD GTFS static feed on startup, parses with gtfs-kit, holds in memory on app.state.gtfs_feed, refreshes in background, guards in-flight requests with HTTP 503, exposes /api/gtfs/status reachable through Next.js BFF proxy. Docker image must build with GDAL.
**Verified:** 2026-06-06T04:00:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (playwright Dockerfile block removed)

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Docker image builds successfully with GDAL available — python:3.12-slim base, libgdal-dev added | VERIFIED | `backend/Dockerfile` line 1: `FROM python:3.12-slim`. Lines 5-7: single `apt-get install -y \ libgdal-dev \ && rm -rf /var/lib/apt/lists/*`. Only 2 RUN instructions total. Playwright block and all Chromium system libraries (libglib2.0-0, libasound2, etc.) are absent. `grep -n playwright Dockerfile` returns 0 matches. |
| 2 | On backend startup, GtfsFeed dataclass is stored on app.state.gtfs_feed; app.state.gtfs_feed=None initialized first | VERIFIED | `backend/app/main.py:16`: `app.state.gtfs_feed = None` is the first statement in the lifespan context manager before any await. `backend/app/services/gtfs.py:65`: `app.state.gtfs_feed = gtfs_feed` assigned only on successful load. `GtfsFeed` dataclass defined at lines 22-25 with `feed: gtfs_kit.Feed` and `loaded_at: datetime` fields. |
| 3 | A GTFS-dependent endpoint returns HTTP 503 with detail='GTFS feed not yet loaded' while app.state.gtfs_feed is None | VERIFIED | `backend/app/routers/gtfs.py:20-21`: `if request.app.state.gtfs_feed is None: raise HTTPException(status_code=503, detail="GTFS feed not yet loaded")`. `get_gtfs_feed` is injected via `Depends(get_gtfs_feed)` in the `/status` endpoint (line 26). The `None` initialization at main.py:16 guarantees the guard fires during startup load. |
| 4 | GTFS feed refreshes in background via asyncio.create_task + while-True sleep loop, interval from gtfs_refresh_interval_hours (default 6h), failed refresh logs warning and retains prior feed | VERIFIED | `backend/app/services/gtfs.py:77-85`: `interval = settings.gtfs_refresh_interval_hours * 3600`, `while True: await asyncio.sleep(interval)`, except branch calls `logger.warning("GTFS background refresh failed: %s", exc)` and does NOT set `app.state.gtfs_feed = None`. `main.py:26`: `task = asyncio.create_task(gtfs_svc._refresh_loop(app))`; `main.py:28`: `task.cancel()` on shutdown. `config.py:11`: `gtfs_refresh_interval_hours: int = 6`. |

**Score:** 4/4 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `backend/app/services/gtfs.py` | GtfsFeed dataclass, load_gtfs_feed(), load_and_store(app), _refresh_loop(app) | VERIFIED | 85 lines. `@dataclass class GtfsFeed` with `feed` and `loaded_at` fields. All four symbols confirmed via AST parse. `run_in_executor` for sync gtfs-kit parse (line 47). `asyncio.sleep(interval)` in refresh loop (line 79). |
| `backend/app/routers/gtfs.py` | GTFS router with get_gtfs_feed 503 guard dependency and GET /gtfs/status endpoint | VERIFIED | 36 lines. `APIRouter(prefix="/gtfs", tags=["gtfs"])`. `status_code=503` present at line 21. `@router.get("/status")` with `Depends(get_gtfs_feed)`. None-guarded counts for routes, stops, trips. |
| `backend/app/config.py` | gtfs_feed_url and gtfs_refresh_interval_hours settings | VERIFIED | `gtfs_feed_url: str = "https://mtd.dev/gtfs.zip"` at line 10. `gtfs_refresh_interval_hours: int = 6` at line 11. Existing fields untouched. |
| `backend/requirements.txt` | gtfs-kit dependency | VERIFIED | Line 11: `gtfs-kit>=7.0.0`. Unpinned minor-version format consistent with other deps. |
| `backend/Dockerfile` | libgdal-dev system dependency for GDAL; playwright block removed | VERIFIED | `FROM python:3.12-slim` at line 1 (base unchanged). `libgdal-dev` in single apt block at line 6. Playwright block absent — 0 grep matches for "playwright". Chromium system library block absent. Exactly 2 RUN instructions (apt-get + pip install). |
| `backend/app/main.py` | lifespan initializes app.state.gtfs_feed=None, loads feed in gather, starts+cancels background refresh task, registers gtfs router | VERIFIED | Line 16: `app.state.gtfs_feed = None` (first statement). Line 21: `gtfs_svc.load_and_store(app)` in asyncio.gather. Line 26: `asyncio.create_task(gtfs_svc._refresh_loop(app))`. Line 28: `task.cancel()`. Line 45: `app.include_router(gtfs.router, prefix="/api")`. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `backend/app/main.py` | `backend/app/services/gtfs.py` | lifespan calls `gtfs_svc.load_and_store(app)` and `asyncio.create_task(gtfs_svc._refresh_loop(app))` | WIRED | main.py lines 21 and 26 — both calls confirmed. |
| `backend/app/routers/gtfs.py` | `app.state.gtfs_feed` | `get_gtfs_feed` reads `request.app.state.gtfs_feed` and raises 503 if None | WIRED | routers/gtfs.py lines 20-22 — direct attribute read with None check and HTTPException. |
| `backend/app/main.py` | `backend/app/routers/gtfs.py` | `app.include_router(gtfs.router, prefix="/api")` | WIRED | main.py line 45 — endpoint reachable at `/api/gtfs/status`. |
| `frontend/next.config.ts` | `backend /api/gtfs/status` | `/api/:path*` rewrite to `${BACKEND_URL}/api/:path*` | WIRED | next.config.ts lines 13-14 — wildcard rewrite covers `/api/gtfs/status` with no frontend change needed. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `routers/gtfs.py:get_status` | `feed.feed.routes`, `feed.feed.stops`, `feed.feed.trips` | `Depends(get_gtfs_feed)` → `app.state.gtfs_feed` → populated by `gtfs_kit.read_feed()` on MTD GTFS zip download | Yes — pandas DataFrames from parsed zip, len() of actual rows; None-guarded counts | FLOWING (code path verified; runtime confirmation requires human test) |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Python syntax: services/gtfs.py | `python3 -c "import ast; ast.parse(open(...).read())"` | exit 0 | PASS |
| Python syntax: routers/gtfs.py | `python3 -c "import ast; ast.parse(open(...).read())"` | exit 0 | PASS |
| Python syntax: main.py | `python3 -c "import ast; ast.parse(open(...).read())"` | exit 0 | PASS |
| Python syntax: config.py | `python3 -c "import ast; ast.parse(open(...).read())"` | exit 0 | PASS |
| Dockerfile playwright-free | `grep -n playwright backend/Dockerfile` | 0 matches | PASS |
| Dockerfile base image | `grep FROM backend/Dockerfile` | `FROM python:3.12-slim` | PASS |
| Docker build (clean) | `docker build --no-cache -t route-editor-backend ./backend` | SKIP — Docker daemon not available in verifier | SKIP (human required) |

---

### Probe Execution

Step 7c: No probe scripts found in `scripts/*/tests/probe-*.sh`. No probes declared in PLAN frontmatter. SKIPPED.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| INGEST-01 | 01-01-PLAN.md | System downloads and parses MTD's GTFS static feed from `https://mtd.dev/gtfs.zip` on startup, making route/stop/shape/schedule data available to all backend services | SATISFIED (pending human runtime confirm) | `load_gtfs_feed()` downloads via httpx (60s timeout), writes to tempfile, parses via `gtfs_kit.read_feed()` in thread executor. `load_and_store(app)` stores result on `app.state.gtfs_feed` on success. Docker build now unblocked. |
| INGEST-02 | 01-01-PLAN.md | System refreshes the GTFS static feed in the background every 6-12 hours without service interruption | SATISFIED | `_refresh_loop` with configurable interval (default 6h), warn-don't-crash semantics, task cancelled on shutdown. |
| INGEST-03 | 01-01-PLAN.md | System returns HTTP 503 with a clear error message when the GTFS feed has not yet finished loading | SATISFIED | `get_gtfs_feed` Depends() raises `HTTPException(status_code=503, detail="GTFS feed not yet loaded")`; `app.state.gtfs_feed = None` set before first await in lifespan. |
| INGEST-04 | 01-01-PLAN.md | Docker image builds successfully with the GDAL dependency required by gtfs-kit | SATISFIED (pending human build confirm) | `libgdal-dev` present in apt block; playwright block and Chromium system libraries fully removed; base image `python:3.12-slim` unchanged; Dockerfile is syntactically minimal and clean. |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `backend/app/main.py` | 25 | Log message "MTD cache warmup failed" fires even when GTFS fails, not MTD | WARNING (non-blocking) | Misleads operators diagnosing a GTFS-specific outage — does not affect correctness |
| `backend/app/main.py` | 28 | `task.cancel()` not awaited — task may not complete cancellation before event loop closes | WARNING (non-blocking) | Background refresh task may be mid-download on SIGTERM; does not affect normal operation |
| `backend/app/routers/gtfs.py` | 20 | `request.app.state.gtfs_feed is None` — AttributeError if attribute never set (no lifespan) | WARNING (non-blocking) | Returns 500 instead of 503 only in unit tests without lifespan; production always runs lifespan |
| `backend/app/services/gtfs.py` | 79 | `asyncio.sleep(interval)` before first retry in `_refresh_loop` | WARNING (non-blocking) | If startup GTFS load fails, server serves 503 for up to 6 hours before refresh loop retries |

No TBD, FIXME, or XXX debt markers found in any modified file.

---

### Human Verification Required

#### 1. Clean Docker Build

**Test:** Run `docker build --no-cache -t route-editor-backend ./backend`
**Expected:** Build completes with exit 0; `apt-get install -y libgdal-dev` installs cleanly; `pip install -r requirements.txt` installs gtfs-kit and all deps without error; no playwright-related failure; image produced successfully
**Why human:** Docker daemon not available in verifier environment; must be executed on real infrastructure

#### 2. End-to-End Startup Load and Status Endpoint

**Test:** `docker run --rm -p 8000:8000 --env-file backend/.env route-editor-backend`, then after startup: `curl -s http://localhost:8000/api/gtfs/status`
**Expected:** Container logs show GTFS feed load info line ("GTFS feed loaded (N routes, N stops)"); curl returns 200 JSON with non-zero `routes`, `stops`, `trips` counts and a `loaded_at` ISO timestamp
**Why human:** Requires network access to mtd.dev/gtfs.zip and a running container; can't be tested by code inspection alone

---

### Gaps Summary

No blocking gaps remain. The previous blocker (Dockerfile playwright remnant) has been resolved:

- The `RUN playwright install chromium` line is absent from the Dockerfile
- The Chromium system library block (libglib2.0-0, libasound2, etc.) is fully removed
- The Dockerfile contains exactly 2 RUN instructions: `apt-get install -y libgdal-dev` and `pip install -r requirements.txt`
- Base image `python:3.12-slim` is unchanged

All 4 must-haves are verified in the codebase. Status is `human_needed` because Docker build correctness and live endpoint confirmation require container execution, which cannot be tested by static analysis.

**Carry-forward code quality warnings (non-blocking, per user directive):**
- CR-02: `_refresh_loop` sleep-before-retry means up to 6h downtime if startup load fails
- CR-03: direct attribute access on `app.state.gtfs_feed` would raise AttributeError (500) without lifespan (unit test only)
- WR-01: misleading "MTD cache warmup failed" log message when GTFS load fails
- WR-02: `task.cancel()` not awaited on shutdown

These do not block phase goal achievement.

---

_Verified: 2026-06-06T04:00:00Z_
_Verifier: Claude (gsd-verifier)_
