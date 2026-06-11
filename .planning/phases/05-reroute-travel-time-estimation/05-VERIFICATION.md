---
phase: 05-reroute-travel-time-estimation
verified: 2026-06-11T00:00:00Z
status: passed
score: 10/10 must-haves verified
overrides_applied: 0
---

# Phase 5: Reroute Travel-Time Estimation Verification Report

**Phase Goal:** User can request travel-time impact for a modified stop sequence and see per-stop arrival delta displayed alongside the route preview in the editor
**Verified:** 2026-06-11
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | POST /api/gtfs/estimate-travel-time returns one estimate per proposed stop, ordered by stop_sequence | VERIFIED | `backend/app/routers/gtfs.py:1065-1159` — endpoint sorts proposed/original by `stop_sequence`, iterates `proposed_sorted`, returns `list[_StopEstimate]` 1:1; `test_returns_estimate_per_stop` asserts `len(result) == len(proposed)` and `seqs == sorted(seqs)`. Passing. |
| 2 | Existing stops (stop_id in both original and proposed) receive `upstream_delay_seconds` from MTD departures | VERIFIED | `gtfs.py:1132-1134` — `upstream_delay = delays.get(stop["stop_id"])` only when `is_existing`; `test_existing_stop_gets_delay` confirms `MTD_1001` gets `upstream_delay_seconds == 240` and `basis` includes "delay". Passing. |
| 3 | New/moved stops receive `osrm_delta_seconds` from cumulative OSRM travel time vs baseline | VERIFIED | `gtfs.py:1124-1130` computes `osrm_delta = cumulative - baseline_total`; `test_new_stop_gets_osrm_delta` confirms `MTD_1003.osrm_delta_seconds is not None` and `basis` includes "osrm". Passing. |
| 4 | OSRM total failure falls back to 60s/stop without crashing; endpoint still returns 200 | VERIFIED | `FALLBACK_LEG_SECONDS = 60.0` (line 1016) added per leg when `osrm_result is None`; CR-01 fix (commit `0c5c901`) corrected basis assignment so stop 0 → `basis="none"` and stop 1+ → `basis="fallback"`. `test_osrm_failure_fallback` passes with these exact assertions. `test_estimate_endpoint_returns_200` confirms HTTP 200 via TestClient. |
| 5 | Synthetic `custom_*` stop_ids are never forwarded to MTD delay lookup | VERIFIED | `_diff_stop_sequences` (lines 1042-1062) excludes `stop_id.startswith("custom_")` from "existing"; `existing_stop_ids` (lines 1104-1110) additionally re-checks `_STOP_ID_RE.match` (T-05-01 defense-in-depth). `test_synthetic_ids_excluded_from_delay` confirms `custom_5_2` not in `mock_delays.call_args`. |
| 6 | Fully custom route (empty `original_stops`) returns OSRM-only estimates without error | VERIFIED | `baseline_total = 0.0` when `len(original_sorted) < 2` (lines 1097-1101); `test_all_new_stops_no_original` confirms all results have `upstream_delay_seconds is None`, no exception. |
| 7 | User can click an "Estimate Travel Time" button in the editor toolbar without leaving the editing workflow (EST-01) | VERIFIED | `frontend/components/EditorToolbar.tsx:399-431` — button placed immediately after Preview, with `handleEstimateTravelTime` (lines 260-277) calling `estimateTravelTime(originalStops, stops, token)`. Five UI states implemented (default/loading/re-estimate/stale-pulse/disabled). Task 3 human-verify approved. |
| 8 | After a successful estimate, each StopList row shows a per-stop arrival delta badge alongside the existing route preview (EST-03) | VERIFIED | `frontend/components/StopList.tsx:160-200` (lookup + classification) and `:306-322` (badge rendered as last `<li>` element with `ArrowUp`/`ArrowDown`/`Minus` icon, `formatDelta()` text, basis tooltip, `—` placeholder for `basis === "none"`). `estimated_arrival_delta_seconds` consumed directly from live `travelTimeEstimates` store state — not mocked/static. |
| 9 | Editing the route after an estimate marks the estimate stale (badges dim, button becomes "Update Estimate") | VERIFIED | `editorStore.ts` — `travelTimeEstimatesStale: true` set in all 6 stop-mutating actions (`setStops` 150, `addStop` 174, `removeStop` 183, `replaceStop` 209, `moveStop` 223, `undo` 263); `loadRoute`/`startCustomRoute` reset `travelTimeEstimates: null`. `EditorToolbar.tsx:403,419-425` — `isStale` triggers orange pulse + "Update Estimate"; `StopList.tsx:310` applies `opacity-50` to badge when stale. |
| 10 | Estimate failure shows a destructive error strip and does not clear the editor | VERIFIED | `EditorToolbar.tsx:271-273` catch sets `estimateError` (does not call `reset()`/`clearTravelTimeEstimates`/mutate stops); error strip rendered at `:512-520` reusing `bg-destructive/10` pattern. |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `backend/app/routers/gtfs.py` | POST /estimate-travel-time + `_diff_stop_sequences` + 3 Pydantic models | VERIFIED | All present (lines 1014-1159); `_diff_stop_sequences` invoked once and drives `existing_stop_ids` + `is_existing` (no duplicated inline classification, confirmed by reading lines 1090-1147). |
| `backend/tests/test_travel_time_estimate.py` | 6 EST-02 contract tests | VERIFIED | 8 tests total (6 contract + `_diff_stop_sequences` unit test + TestClient 200 test); all pass (`pytest -q` → 43 passed full suite, 8 from this file). |
| `frontend/lib/api.ts` | `estimateTravelTime()` + `TravelTimeEstimate` type | VERIFIED | Lines 269-309; no `trip_id`/`tripId` param (WR-03 fixed — confirmed absent from both client function and request body). |
| `frontend/store/editorStore.ts` | `travelTimeEstimates`/`travelTimeEstimatesStale` state + actions + stale wiring | VERIFIED | State (39-40), actions `setTravelTimeEstimates`/`clearTravelTimeEstimates` (282-288), 6 stale-wired mutations + 2 reset sites confirmed by direct read. |
| `frontend/components/EditorToolbar.tsx` | "Estimate Travel Time"/"Update Estimate" button + Info tooltip + WR-01 fix | VERIFIED | Button (399-431), Info tooltip (433-438) explaining methodology, `handleEstimateTravelTime` includes WR-01 staleness guard: `if (useEditorStore.getState().stops === requestStops) { setTravelTimeEstimates(result); }` (line 268) — discards stale results if the route was edited mid-request. |
| `frontend/components/StopList.tsx` | Per-stop delta badges, stop_id match w/ stop_sequence fallback (WR-02) | VERIFIED | Lines 160-162: matches by `stop_id` when present, falls back to `stop_id === null && stop_sequence` match for editor-added stops (no `stop_id`). Badge rendered last in `<li>` (306-322). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `estimate_travel_time` | `_osrm_route` | cumulative leg durations for proposed + original | WIRED | Called at lines 1093 (proposed) and 1099 (original baseline); `leg_durations`/`baseline_total` consumed in the per-stop loop. |
| `estimate_travel_time` | `_get_delays_for_stops` | MTD delay lookup for existing real stop_ids | WIRED | Called at line 1111 with `existing_stop_ids` derived from `_diff_stop_sequences` + `_STOP_ID_RE` guard. |
| `estimate_travel_time` | `_diff_stop_sequences` | per-stop existing/new classification | WIRED | Called once (line 1090); `existing_stop_ids` and `is_existing` (line 1122) both derive from `classifications`, no inline re-derivation. |
| `frontend/components/EditorToolbar.tsx` | `/api/gtfs/estimate-travel-time` | `estimateTravelTime()` in `handleEstimateTravelTime` | WIRED | Line 267 calls `estimateTravelTime(originalStops, requestStops, token)`; result stored via `setTravelTimeEstimates` only if stops unchanged (race guard). |
| `frontend/components/StopList.tsx` | `editorStore.travelTimeEstimates` | per-stop find by stop_id (w/ stop_sequence fallback) | WIRED | Lines 160-162. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `StopList.tsx` badge | `travelTimeEstimates` (Zustand store) | `EditorToolbar.handleEstimateTravelTime` → `estimateTravelTime()` → `POST /api/gtfs/estimate-travel-time` → backend computes from `_osrm_route` + `_get_delays_for_stops` | Yes | FLOWING — backend computation verified by passing unit tests with non-trivial assertions on `osrm_delta_seconds`/`upstream_delay_seconds`/`basis`; frontend stores the raw response array, no static fallback. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Backend EST-02 contract tests pass | `cd backend && python -m pytest tests/test_travel_time_estimate.py -v` (env vars set) | 8 passed | PASS |
| Full backend suite green (no regressions) | `cd backend && python -m pytest -q` | 43 passed | PASS |
| Frontend strict type-check | `cd frontend && npx tsc --noEmit` | No errors found | PASS |
| Frontend lint (estimate-related files) | `npx eslint components/EditorToolbar.tsx components/StopList.tsx lib/api.ts store/editorStore.ts` | 0 errors, 1 pre-existing unrelated warning (`StopReplaceDropdown` set-state-in-effect, downgraded to warn project-wide) | PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes declared or found for this phase. SKIPPED (no probes applicable — phase verification relies on pytest/tsc/eslint, all executed above).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| EST-01 | 05-02 | User can request travel-time impact estimation for a modified stop sequence from within the editor | SATISFIED | "Estimate Travel Time" button in `EditorToolbar.tsx`, wired to `handleEstimateTravelTime`; Task 3 human-verify approved. |
| EST-02 | 05-01 | Backend computes per-stop estimated arrival delta using OSRM road travel time (new/moved stops) plus upstream MTD departure delay (existing stops) | SATISFIED | `POST /api/gtfs/estimate-travel-time` endpoint composes `_osrm_route` + `_get_delays_for_stops` via `_diff_stop_sequences`; 8 passing tests including CR-01 fallback-basis fix. |
| EST-03 | 05-02 | Frontend displays per-stop estimated arrival delta for the proposed route modification alongside the existing route preview | SATISFIED | `StopList.tsx` renders per-stop delta badge as last element of each row, using live `travelTimeEstimates` data with stale dimming and basis tooltips. |

REQUIREMENTS.md marks all three as `[x]` complete and "Complete" in the coverage table — accurate based on codebase evidence above. No orphaned Phase 5 requirements found.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `backend/tests/test_travel_time_estimate.py` | 4, 28 | "not yet implemented" | Info | Documents the TDD red→green skip-guard mechanism (`_requires_impl`); implementation now exists and all tests pass — not a stub. |
| `frontend/components/StopList.tsx` | 80 | `placeholder="Search stops…"` | Info | HTML input placeholder attribute, pre-existing UI text unrelated to this phase. |

No TBD/FIXME/XXX/HACK markers found in any phase-modified file. No blockers.

### Human Verification Required

None — Task 3 (browser human-verify checkpoint for EST-01/EST-03) was already completed and approved during execution per `05-02-SUMMARY.md`, including a follow-up deviation (Info tooltip) that was implemented and is present in the current codebase (`EditorToolbar.tsx:433-438`).

### Gaps Summary

No gaps found. Both plans (05-01 backend, 05-02 frontend) deliver a complete, wired, tested vertical slice:

- The backend endpoint composes existing OSRM and MTD-delay helpers via a single classification helper (`_diff_stop_sequences`), with the CR-01 basis-precedence fix (osrm+delay > delay > osrm > fallback > none) and WR-03 (`trip_id` removal) both present in the current code, not just claimed in commit messages.
- The frontend trigger, store state/stale-wiring, toolbar button (5 states + methodology tooltip), and StopList per-stop delta badges (with WR-01 race-guard and WR-02 stop_id/stop_sequence matching) are all implemented and wired to live data.
- 43/43 backend tests pass, `tsc --noEmit` is clean, eslint reports 0 errors (1 pre-existing unrelated warning).
- One unrelated, pre-existing uncommitted diff in `frontend/components/EditorToolbar.tsx` (amber→orange color rename on Preview-button/warning-strip styling) exists in the working tree but is out of scope for Phase 5 and does not affect EST-01/02/03.

Phase goal "User can request travel-time impact for a modified stop sequence and see per-stop arrival delta displayed alongside the route preview in the editor" is achieved.

---

_Verified: 2026-06-11_
_Verifier: Claude (gsd-verifier)_
