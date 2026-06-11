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
  - "Added an Info icon + native title= tooltip next to the Estimate Travel Time button (deviation, user feedback during Task 3 human-verify) to explain estimate methodology at a glance"

patterns-established:
  - "Toolbar action buttons that depend on a backend round-trip follow: local estimating/error state, getToken()+onAuthRequired guard, try/catch/finally, error strip reusing bg-destructive/10 pattern"

requirements-completed: [EST-01, EST-03]

# Metrics
duration: ~30min
completed: 2026-06-11
---

# Phase 5 Plan 2: Reroute Travel-Time Estimation UI Summary

Estimate Travel Time toolbar button (EST-01) wired to the 05-01 backend endpoint, with per-stop arrival-delta badges in StopList (EST-03), stale dimming, and an error strip — all 3 tasks complete; Task 3 human-verify approved with a follow-up info tooltip added per user feedback.

## Performance

- **Duration:** ~30 min (Tasks 1-3)
- **Started:** 2026-06-11T01:20:00Z
- **Completed:** Tasks 1-2 at 2026-06-11T01:45:05Z; Task 3 (human-verify + deviation) completed 2026-06-11
- **Tasks:** 3 of 3 completed
- **Files modified:** 5 (4 from Tasks 1-2 + EditorToolbar.tsx info tooltip deviation)

## Accomplishments
- `estimateTravelTime()` client + `TravelTimeEstimate` type added to `frontend/lib/api.ts`, calling `POST /api/gtfs/estimate-travel-time` via the existing wildcard BFF rewrite (no new route handler)
- `editorStore` gained `travelTimeEstimates` / `travelTimeEstimatesStale` state, `setTravelTimeEstimates`/`clearTravelTimeEstimates` actions, and stale-wiring across all six stop-mutating actions (`setStops`, `addStop`, `removeStop`, `replaceStop`, `moveStop`, `undo`); `loadRoute`/`startCustomRoute` reset estimates on fresh route load
- "Estimate Travel Time" toolbar button added immediately after "Preview", with all five LOCKED UI-SPEC states (default/loading/re-estimate/stale-pulse/disabled-too-few-stops), an error strip, and an indeterminate progress bar
- StopList renders per-stop delta badges as the last element in each row — `ArrowUp`/`ArrowDown`/`Minus` + `text-orange-600`/`text-emerald-600`/`text-muted-foreground`, `formatDelta()` compact duration strings, basis-specific tooltips, `opacity-50` stale dimming, and a muted `—` placeholder for `basis: "none"`

## Task Commits

Each task was committed atomically:

1. **Task 1: API client + store state, actions, and stale-flag wiring** - `4d220c9` (feat)
2. **Task 2: Toolbar trigger + StopList delta badges (LOCKED UI-SPEC)** - `93a021b` (feat)
3. **Task 3: Browser human-verify — estimate trigger + per-stop delta badges** - approved (no code change required for the checkpoint itself)
   - **Deviation: estimate methodology info tooltip** - `74dab51` (feat)

**Plan metadata:** (this commit)

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

Tasks 1-2 executed exactly as written.

Note: `frontend/node_modules` did not exist in this worktree at start of execution; ran `npm ci` to install dependencies so `tsc`/`eslint` verification commands could run. This is a pre-existing environment gap (not a plan deviation) and `node_modules` remains gitignored — no commit required.

### Task 3 — In-scope deviation: estimate methodology info tooltip

**1. [User feedback during Task 3 human-verify] Add an info affordance explaining how estimates are computed**
- **Found during:** Task 3 human-verify checkpoint
- **Issue:** The checkpoint was approved (badges, stale dimming, and trigger states all match the LOCKED 05-UI-SPEC as built), but the user noted that while per-stop badges have basis tooltips, there is nothing explaining the *overall* estimation methodology near the "Estimate Travel Time" button itself.
- **Fix:** Added a small `Info` icon (lucide-react, already imported elsewhere in this file) immediately after the Estimate/Update button in `EditorToolbar.tsx`, only rendered when `hasRoute`. Followed the existing codebase convention of native `title=` tooltips (no Tooltip/Popover component exists in this project — see `StopList.tsx` basis tooltips). Tooltip text: "Estimates combine road-network travel time changes (via OSRM) with live MTD departure delay data for each stop. Hover a stop's badge for per-stop details." Styled minimally (`w-3.5 h-3.5 text-muted-foreground shrink-0`) to match other small toolbar icons.
- **Files modified:** `frontend/components/EditorToolbar.tsx`
- **Commit:** `74dab51`
- **Verification:** `cd frontend && npx tsc --noEmit` (clean) and `npx eslint components/EditorToolbar.tsx` (clean, 0 errors/warnings on this file).

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

## Verification (Task 3)

- **Browser human-verify checkpoint: APPROVED.** The user ran the `how-to-verify` steps in `05-02-PLAN.md` (load a route, modify stops, click "Estimate Travel Time", confirm spinner/progress bar, per-stop delta badges with correct colors/icons/tooltips, stale dimming + "Update Estimate" pulse on further edits) and confirmed all behavior matches the LOCKED 05-UI-SPEC.
- User feedback: "approved, but how the delays are estimated are unclear. i think there should be an i card or something" — addressed via the in-scope info-tooltip deviation above.
- `cd frontend && npx tsc --noEmit` — no errors (post-deviation).
- `cd frontend && npx eslint components/EditorToolbar.tsx` — 0 errors, 0 warnings (post-deviation).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

All 3 tasks complete. Phase 05 (reroute-travel-time-estimation) is now complete — both 05-01 (backend estimate endpoint) and 05-02 (frontend trigger + badges + methodology tooltip) are done and the EST-01/EST-03 requirements are closed.

---
*Phase: 05-reroute-travel-time-estimation*
*Completed: 2026-06-11 — all 3 tasks done, Task 3 human-verify approved with follow-up info tooltip*

## Self-Check: PASSED

- FOUND: commit 74dab51 (feat(05-02): add estimate methodology info tooltip)
- FOUND: frontend/components/EditorToolbar.tsx
- FOUND: .planning/phases/05-reroute-travel-time-estimation/05-02-SUMMARY.md
