---
phase: 05-reroute-travel-time-estimation
plan: 02
subsystem: ui
tags: [nextjs, react, zustand, lucide-react, travel-time-estimation]

# Dependency graph
requires:
  - phase: 05-reroute-travel-time-estimation
    provides: "POST /api/gtfs/estimate-travel-time (05-01)"
provides:
  - "estimateTravelTime() client + TravelTimeEstimate type in frontend/lib/api.ts"
  - "editorStore travelTimeEstimates / travelTimeEstimatesStale state + setter/clear actions + stale wiring"
  - "Estimate Travel Time toolbar trigger (EditorToolbar)"
  - "Per-stop arrival-delta badges in StopList"
affects: [frontend-editor, reroute-travel-time-estimation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "estimateTravelTime() mirrors importTripMod fetchJSON<T> POST pattern"
    - "travelTimeEstimatesStale mirrors the existing routePreviewEnabled/needsRefresh stale-pulse pattern"
    - "Delta badge is a transparent inline <span> with icon+color+text triple-redundant signal (ArrowUp/ArrowDown/Minus)"

key-files:
  created: []
  modified:
    - frontend/lib/api.ts
    - frontend/store/editorStore.ts
    - frontend/components/EditorToolbar.tsx
    - frontend/components/StopList.tsx

key-decisions:
  - "Stale-state tooltip prefixes the basis tooltip rather than replacing it, per UI-SPEC stale copy + basis table"
  - "Inline param typing used for estimateTravelTime() (no EditorStop import) to avoid any risk of circular import between lib/api.ts and store/editorStore.ts"

patterns-established:
  - "Toolbar action buttons that depend on a backend round-trip follow: local estimating/error state, getToken()+onAuthRequired guard, try/catch/finally, error strip reusing bg-destructive/10 pattern"

requirements-completed: [EST-01, EST-03]

# Metrics
duration: ~25min
completed: 2026-06-11
---

# Phase 5 Plan 2: Reroute Travel-Time Estimation UI Summary

Estimate Travel Time toolbar button (EST-01) wired to the 05-01 backend endpoint, with per-stop arrival-delta badges in StopList (EST-03), stale dimming, and an error strip — Tasks 1-2 complete; Task 3 is a human-verify browser checkpoint pending approval.

## Performance

- **Duration:** ~25 min (Tasks 1-2)
- **Started:** 2026-06-11T01:20:00Z
- **Completed:** Tasks 1-2 at 2026-06-11T01:45:05Z; Task 3 pending
- **Tasks:** 2 of 3 completed (Task 3 is checkpoint:human-verify, gate=blocking)
- **Files modified:** 4

## Accomplishments
- `estimateTravelTime()` client + `TravelTimeEstimate` type added to `frontend/lib/api.ts`, calling `POST /api/gtfs/estimate-travel-time` via the existing wildcard BFF rewrite (no new route handler)
- `editorStore` gained `travelTimeEstimates` / `travelTimeEstimatesStale` state, `setTravelTimeEstimates`/`clearTravelTimeEstimates` actions, and stale-wiring across all six stop-mutating actions (`setStops`, `addStop`, `removeStop`, `replaceStop`, `moveStop`, `undo`); `loadRoute`/`startCustomRoute` reset estimates on fresh route load
- "Estimate Travel Time" toolbar button added immediately after "Preview", with all five LOCKED UI-SPEC states (default/loading/re-estimate/stale-pulse/disabled-too-few-stops), an error strip, and an indeterminate progress bar
- StopList renders per-stop delta badges as the last element in each row — `ArrowUp`/`ArrowDown`/`Minus` + `text-orange-600`/`text-emerald-600`/`text-muted-foreground`, `formatDelta()` compact duration strings, basis-specific tooltips, `opacity-50` stale dimming, and a muted `—` placeholder for `basis: "none"`

## Task Commits

Each task was committed atomically:

1. **Task 1: API client + store state, actions, and stale-flag wiring** - `4d220c9` (feat)
2. **Task 2: Toolbar trigger + StopList delta badges (LOCKED UI-SPEC)** - `93a021b` (feat)

**Plan metadata:** (this commit)

Task 3 (checkpoint:human-verify, gate=blocking) is pending — see "Next Phase Readiness" below.

## Files Created/Modified
- `frontend/lib/api.ts` - `TravelTimeEstimate` interface + `estimateTravelTime()` POST client
- `frontend/store/editorStore.ts` - estimate state/actions, stale wiring on 6 mutating actions, reset on `loadRoute`/`startCustomRoute`
- `frontend/components/EditorToolbar.tsx` - Estimate Travel Time button (5 states), `handleEstimateTravelTime`, error strip, progress bar
- `frontend/components/StopList.tsx` - `formatDelta()`, per-stop delta badge + basis tooltips + stale dimming + none-state placeholder

## Decisions Made
- Followed the LOCKED 05-UI-SPEC literally for the stale-pulse button classes (`border-orange-400 bg-orange-50 text-orange-700 hover:bg-orange-100 animate-pulse`), even though the existing Preview button's analogous `needsRefresh` styling uses amber (`border-amber-400 bg-amber-50 ...`). This is an intentional, spec-mandated divergence for this new button only — not a refactor of the Preview button.
- Stale tooltip text is prefixed onto the basis tooltip (per UI-SPEC Copywriting Contract + tooltip table), producing a combined string when both apply.
- `estimateTravelTime()` uses an inline structural type for stop params (not `EditorStop`) since `api.ts` imports nothing from `store/` today — avoids introducing a new circular-import risk while keeping the same field shape.

## Deviations from Plan

None - plan executed exactly as written for Tasks 1-2.

Note: `frontend/node_modules` did not exist in this worktree at start of execution; ran `npm ci` to install dependencies so `tsc`/`eslint` verification commands could run. This is a pre-existing environment gap (not a plan deviation) and `node_modules` remains gitignored — no commit required.

## Known Stubs

None. Both `estimateTravelTime()` and the StopList badge consume the real `travelTimeEstimates` store state populated from the live 05-01 endpoint response — no hardcoded/mock data paths.

## Issues Encountered

None for Tasks 1-2. `npx eslint` reported one pre-existing warning (not error) in `StopList.tsx` at the `StopReplaceDropdown`'s search effect (`react-hooks/set-state-in-effect`, downgraded to "warn" project-wide per `eslint.config.mjs`) — unrelated to this plan's changes, out of scope per the deviation rules' scope boundary.

## Verification (Tasks 1-2)

- `cd frontend && npx tsc --noEmit` — no errors.
- `cd frontend && npx eslint components/EditorToolbar.tsx components/StopList.tsx` — 0 errors, 1 pre-existing warning (unrelated file/region).
- `grep -c "export async function estimateTravelTime\|export interface TravelTimeEstimate" frontend/lib/api.ts` → 2
- `grep -c "travelTimeEstimatesStale: true" frontend/store/editorStore.ts` → 6
- `grep -c "travelTimeEstimates: null" frontend/store/editorStore.ts` → 4 (initial + loadRoute + startCustomRoute + clearTravelTimeEstimates)
- `test ! -e frontend/app/api/gtfs/estimate-travel-time/route.ts` → confirmed absent
- `grep -c "Estimate Travel Time" frontend/components/EditorToolbar.tsx` → 2
- `grep -c "handleEstimateTravelTime\|estimateTravelTime" frontend/components/EditorToolbar.tsx` → 4
- `grep -c "function formatDelta" frontend/components/StopList.tsx` → 1
- `grep -c "estimated_arrival_delta_seconds" frontend/components/StopList.tsx` → 2
- Badge colors restricted to `text-orange-600` / `text-emerald-600` / `text-muted-foreground` — confirmed, no `text-orange-500` introduced
- `frontend/components/RouteMap.tsx` not modified by either task commit

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Tasks 1-2 are complete and committed. **Task 3 (checkpoint:human-verify, gate=blocking) is NOT executable by this agent** — it requires starting the dev stack (backend :8000, frontend :3000), signing in, loading a route in a browser, and visually confirming button states + badge rendering + stale dimming per the LOCKED 05-UI-SPEC.

A fresh agent (or the orchestrator) must resume from Task 3 using the `how-to-verify` steps in `.planning/phases/05-reroute-travel-time-estimation/05-02-PLAN.md`. Once approved, this SUMMARY should be updated/finalized and the plan-completion final commit made.

---
*Phase: 05-reroute-travel-time-estimation*
*Completed: Tasks 1-2 on 2026-06-11; Task 3 pending human-verify*
