---
phase: 05-reroute-travel-time-estimation
plan: 01
subsystem: backend
tags: [fastapi, gtfs, osrm, mtd, travel-time-estimation]
dependency_graph:
  requires: []
  provides:
    - "POST /api/gtfs/estimate-travel-time"
    - "_diff_stop_sequences"
    - "_EstimateTravelTimeRequest / _EstimateStopIn / _StopEstimate models"
  affects:
    - backend/app/routers/gtfs.py
tech_stack:
  added: []
  patterns:
    - "Composes existing _osrm_route + _get_delays_for_stops helpers; no new dependencies"
    - "Single source of existing/new classification via _diff_stop_sequences"
    - "60s/stop OSRM fallback mirrors _build_stop_times_df convention"
key_files:
  created:
    - backend/tests/test_travel_time_estimate.py
  modified:
    - backend/app/routers/gtfs.py
decisions:
  - "_diff_stop_sequences is the single source of existing/new classification; existing_stop_ids and is_existing both derive from its output, never re-derived inline"
  - "_STOP_ID_RE.match applied as defense-in-depth on top of _diff_stop_sequences custom_* exclusion (T-05-01)"
  - "basis values: osrm+delay, delay, osrm, fallback, none — communicate estimate provenance to the frontend"
metrics:
  duration: "~25min"
  completed: 2026-06-11
---

# Phase 5 Plan 1: Travel-Time Estimation Endpoint Summary

POST /api/gtfs/estimate-travel-time composes existing OSRM routing and MTD delay helpers into per-proposed-stop arrival deltas, with a 60s/stop OSRM fallback and custom_* stop_id exclusion from MTD lookups.

## What Was Built

- **`backend/tests/test_travel_time_estimate.py`** — 8 tests (6 EST-02 contract tests + `_diff_stop_sequences` unit test + TestClient 200 test). All `_requires_impl`-skipped until Task 2 landed (verified RED in Task 1, GREEN after Task 2).
- **`backend/app/routers/gtfs.py`**:
  - `_EstimateStopIn`, `_EstimateTravelTimeRequest`, `_StopEstimate` Pydantic models (`_`-prefixed convention matching `_TripModImportBody`).
  - `_diff_stop_sequences(original, proposed) -> list[str]` — classifies each proposed stop as `"existing"` (stop_id truthy, in original set, not `custom_*`) or `"new"`. Single source of truth consumed by the endpoint.
  - `FALLBACK_LEG_SECONDS = 60.0` module constant mirroring `_build_stop_times_df`'s fallback.
  - `POST /estimate-travel-time` endpoint:
    1. Sorts proposed/original by `stop_sequence`.
    2. Classifies via `_diff_stop_sequences` once.
    3. Calls `_osrm_route` on the proposed sequence (>= 2 stops) for cumulative leg durations.
    4. Calls `_osrm_route` on the original sequence for `baseline_total`.
    5. Builds `existing_stop_ids` from classifications + `_STOP_ID_RE.match` defense-in-depth (T-05-01), then `_get_delays_for_stops`.
    6. Iterates proposed stops accumulating cumulative travel time (60s fallback per leg when OSRM data is short/absent), computing `osrm_delta_seconds`, `upstream_delay_seconds`, `estimated_arrival_delta_seconds`, and a `basis` string (`osrm+delay` / `delay` / `osrm` / `fallback` / `none`).
    7. Returns ordered `list[_StopEstimate]`.

No new dependencies, no new BFF route handler (existing `/api/:path*` rewrite proxies it), no endpoint-level try/except (matches `/trip-updates` precedent — both composed helpers are warn-don't-crash).

## Verification

- `cd backend && python -m pytest tests/test_travel_time_estimate.py -v` → 8 passed.
- `cd backend && python -m pytest -q` → 43 passed (35 pre-existing + 8 new), no regressions.
- `grep -c "estimate-travel-time" backend/app/routers/gtfs.py` → 1.
- `grep -c "def _diff_stop_sequences" backend/app/routers/gtfs.py` → 1.
- `grep -c "_diff_stop_sequences("` → 2 (definition + invocation inside `estimate_travel_time`).
- `grep -c "_STOP_ID_RE.match"` → 2 (`/trip-updates` precedent + new estimate endpoint).
- Endpoint signature uses `Depends(_user_id)`; no try/except wraps the endpoint body.

Note: backend tests require `MTD_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` env vars to be set (pydantic-settings validation) — this is a pre-existing requirement of `app/config.py`, not introduced by this plan. All commands above were run with dummy values for these vars.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: backend/tests/test_travel_time_estimate.py
- FOUND: backend/app/routers/gtfs.py (modified, estimate-travel-time endpoint present)
- FOUND commit c179af3 (test scaffold)
- FOUND commit ef42d72 (endpoint implementation)
