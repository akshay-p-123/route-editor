# Phase 2: GTFS Export - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-06
**Phase:** 2-gtfs-export
**Areas discussed:** Export trigger location, Stop times realism, Calendar window

---

## Export trigger location

| Option | Description | Selected |
|--------|-------------|----------|
| RerouteDashboard only | Per-reroute-package action; backend receives reroute_id | ✓ |
| SavedRoutesDashboard + RerouteDashboard | Per-route + per-package; touches two components | |
| EditorToolbar only | Current route only; simplest single-component approach | |

**Follow-up — backend receives:**

| Option | Description | Selected |
|--------|-------------|----------|
| reroute_id only | Backend fetches routes from Supabase | ✓ |
| List of route_ids | Frontend resolves membership first | |
| Full route payload inline | No Supabase lookup; large payload | |

**Follow-up — button layout:**

| Option | Description | Selected |
|--------|-------------|----------|
| Separate "Download GTFS" button | Alongside PNG export button per reroute row | |
| Export dropdown | Collapses PNG + GTFS into one dropdown | |
| You decide | Claude picks consistent with existing patterns | ✓ |

**User's choice:** RerouteDashboard only; reroute_id sent to backend; button layout at Claude's discretion
**Notes:** Mirrors existing PNG export pattern in RerouteDashboard exactly.

---

## Stop times realism

| Option | Description | Selected |
|--------|-------------|----------|
| Dummy placeholders only | 1 min/stop evenly spaced, timepoint=0 | |
| OSRM-derived travel times | OSRM road travel time per segment; same as PNG export path | ✓ |
| Real MTD schedule from gtfs_feed | Look up actual departure times from stop_times DataFrame | |

**Follow-up — trip anchor time:**

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-coded 08:00:00 | First stop always at 08:00 | ✓ |
| User-specified start time | Frontend sends start_time with export request | |
| You decide | Claude picks pragmatic default | |

**Follow-up — OSRM failure handling:**

| Option | Description | Selected |
|--------|-------------|----------|
| Fall back to 1 min/stop even spacing | Warn-don't-crash; export completes | ✓ |
| Fail with 502 | Loud failure if OSRM required | |
| You decide | Claude picks consistent with project patterns | |

**User's choice:** OSRM-derived times, anchored at 08:00:00, fallback to 1 min/stop if OSRM fails
**Notes:** Consistent with existing OSRM warn-don't-crash pattern from Phase 1 and export.py.

---

## Calendar window

| Option | Description | Selected |
|--------|-------------|----------|
| Today + 90 days | Every day in range, exception_type=1. Matches VALID-02 default | ✓ |
| Today only | Single row; minimal but may confuse downstream consumers | |
| Today + 365 days | Full year; slightly larger file | |

**User's choice:** Today + 90 days hard-coded default
**Notes:** VALID-02 (v2) will add configurability; Phase 2 hard-codes this as the default.

---

## Claude's Discretion

- Frontend button layout in RerouteDashboard (separate vs dropdown)
- REST verb and URL path for export endpoint
- ZIP construction library (Python stdlib zipfile)
- Agency metadata fallback values if gtfs_feed not loaded
- route_type (3 = bus), direction_id (0), service_id naming
- Whether to extend existing gtfs.py router or create new gtfs_export.py module

## Deferred Ideas

- User-configurable trip start time (hard-coded 08:00:00 for Phase 2)
- User-configurable calendar window (VALID-02, v2)
- Per-route export from SavedRoutesDashboard (Phase 2 is reroute-package-level only)
- Real MTD schedule lookup from gtfs_feed.stop_times (deferred in favor of OSRM times)
