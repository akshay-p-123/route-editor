"""GTFS feed status and metadata endpoints, plus GTFS static export."""

import asyncio
import logging
import os
import pathlib
import re
import tempfile
import time
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from uuid import UUID

import gtfs_kit
import httpx
import pandas as pd
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import Response
from supabase import create_client

from app.config import settings
from app.services import gtfs as gtfs_svc
from app.services.mtd import get_stop_departures

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/gtfs", tags=["gtfs"])

# ── Input validation ─────────────────────────────────────────────────────────
_STOP_ID_RE = re.compile(r'^[A-Za-z0-9_\-]{1,64}$')


# ── GTFS feed guard (Phase 1 status endpoint) ────────────────────────────────

def get_gtfs_feed(request: Request) -> gtfs_svc.GtfsFeed:
    """FastAPI Depends() guard — raises 503 if the GTFS feed is not yet loaded.

    Every GTFS-dependent endpoint in Phases 2-5 MUST inject this dependency
    to receive a guaranteed-loaded feed, or a 503 is returned to the caller.
    """
    if request.app.state.gtfs_feed is None:
        raise HTTPException(status_code=503, detail="GTFS feed not yet loaded")
    return request.app.state.gtfs_feed


@router.get("/status")
async def get_status(feed: gtfs_svc.GtfsFeed = Depends(get_gtfs_feed)):
    """Return feed metadata: load timestamp and route/stop/trip counts."""
    routes_count = 0 if feed.feed.routes is None else len(feed.feed.routes)
    stops_count = 0 if feed.feed.stops is None else len(feed.feed.stops)
    trips_count = 0 if feed.feed.trips is None else len(feed.feed.trips)
    return {
        "loaded_at": feed.loaded_at.isoformat(),
        "routes": routes_count,
        "stops": stops_count,
        "trips": trips_count,
    }


# ── Auth helpers (copied verbatim from reroutes.py — project convention) ─────

def _client():
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def _user_id(authorization: str = Header(...)) -> str:
    """Extract user_id from Supabase JWT passed as Bearer token."""
    token = authorization.removeprefix("Bearer ").strip()
    sb = _client()
    resp = sb.auth.get_user(token)
    if not resp.user:
        raise HTTPException(status_code=401, detail="Invalid token")
    return resp.user.id


# ── Utility helpers ──────────────────────────────────────────────────────────

def _seconds_to_gtfs_time(total_seconds: int) -> str:
    """Convert seconds-since-midnight to HH:MM:SS.

    Hours may exceed 24 for overnight trips. Uses integer division only —
    datetime.time caps at 24h and must NOT be used here.
    """
    h = total_seconds // 3600
    m = (total_seconds % 3600) // 60
    s = total_seconds % 60
    return f"{h:02d}:{m:02d}:{s:02d}"


def _sample_stops(stops: list[dict], max_points: int) -> list[dict]:
    """Return up to max_points evenly-spaced stops, always keeping first and last.

    Operates on dicts with stop_lat/stop_lon keys (adapted from export.py).
    """
    if len(stops) <= max_points:
        return stops
    indices = [round(i * (len(stops) - 1) / (max_points - 1)) for i in range(max_points)]
    return [stops[i] for i in indices]


# ── OSRM helper ──────────────────────────────────────────────────────────────

async def _osrm_route(stops: list[dict]) -> dict | None:
    """Call OSRM route service for a list of stops; return routes[0] or None on failure.

    Never raises — warn-don't-crash per D-06.
    """
    sampled = _sample_stops(stops, 12)
    coord_str = ";".join(f"{s['stop_lon']},{s['stop_lat']}" for s in sampled)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"https://router.project-osrm.org/route/v1/driving/{coord_str}",
                params={"overview": "full", "geometries": "geojson"},
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("code") != "Ok":
                return None
            return data["routes"][0]
    except Exception:
        logger.warning("OSRM request failed for GTFS export, using fallback timing")
        return None


# ── Pure DataFrame builder functions ────────────────────────────────────────

def _build_routes_df(saved_routes: list[dict]) -> pd.DataFrame:
    """Build GTFS routes.txt DataFrame from saved_routes records.

    route_color: strip leading '#'; default '0070F3' when None/empty.
    route_id: str(route['id'])
    """
    rows = []
    for route in saved_routes:
        color = route.get("color") or ""
        color_clean = color.lstrip("#") if color else "0070F3"
        rows.append({
            "route_id": str(route["id"]),
            "agency_id": "MTD",
            "route_short_name": route.get("short_name") or route.get("name", ""),
            "route_long_name": route.get("name", ""),
            "route_type": 3,
            "route_color": color_clean,
        })
    return pd.DataFrame(rows)


def _build_stops_df(saved_routes: list[dict]) -> pd.DataFrame:
    """Build GTFS stops.txt DataFrame from saved_routes records.

    Deduplicate by effective_id across all routes.
    Editor-added stops (stop_id is None/empty): synthetic id = custom_{route_id}_{stop_sequence}.
    """
    seen: set[str] = set()
    rows = []
    for route in saved_routes:
        for stop in sorted(route["route_stops"], key=lambda s: s["stop_sequence"]):
            raw_id = stop.get("stop_id") or None
            effective_id = (
                raw_id if raw_id
                else f"custom_{route['id']}_{stop['stop_sequence']}"
            )
            if effective_id not in seen:
                seen.add(effective_id)
                rows.append({
                    "stop_id": effective_id,
                    "stop_name": stop["stop_name"],
                    "stop_lat": stop["stop_lat"],
                    "stop_lon": stop["stop_lon"],
                })
    return pd.DataFrame(rows)


def _build_trips_df(saved_routes: list[dict], service_id: str) -> pd.DataFrame:
    """Build GTFS trips.txt DataFrame — one trip per saved route."""
    rows = []
    for route in saved_routes:
        route_id = str(route["id"])
        rows.append({
            "route_id": route_id,
            "service_id": service_id,
            "trip_id": f"route_editor_{route_id}_trip",
            "shape_id": route_id,
            "direction_id": 0,
        })
    return pd.DataFrame(rows)


def _build_shapes_df(route_id: str, geometry_coords: list) -> pd.DataFrame:
    """Build GTFS shapes.txt DataFrame from OSRM GeoJSON coordinates.

    geometry_coords: list of [lon, lat] from OSRM — SWAP to (lat, lon) for GTFS.
    shape_pt_sequence: 0-indexed.
    """
    rows = []
    for seq, coord in enumerate(geometry_coords):
        lon, lat = coord[0], coord[1]
        rows.append({
            "shape_id": route_id,
            "shape_pt_lat": lat,
            "shape_pt_lon": lon,
            "shape_pt_sequence": seq,
        })
    return pd.DataFrame(rows)


def _build_stop_times_df(route: dict, leg_durations: list[float]) -> pd.DataFrame:
    """Build GTFS stop_times.txt DataFrame for a single route.

    - Anchor: 08:00:00 (28800 seconds from midnight).
    - arrival_time == departure_time for every stop (estimated times, timepoint=0).
    - Between stops: use leg_durations[i] seconds when available, else 60s fallback.
    - Synthetic stop_id computation must match _build_stops_df exactly.
    """
    route_id = str(route["id"])
    trip_id = f"route_editor_{route_id}_trip"
    sorted_stops = sorted(route["route_stops"], key=lambda s: s["stop_sequence"])

    cumulative = 8 * 3600  # anchor at 08:00:00 in seconds
    rows = []
    for i, stop in enumerate(sorted_stops):
        raw_id = stop.get("stop_id") or None
        effective_id = (
            raw_id if raw_id
            else f"custom_{route_id}_{stop['stop_sequence']}"
        )
        t_str = _seconds_to_gtfs_time(int(cumulative))
        rows.append({
            "trip_id": trip_id,
            "arrival_time": t_str,
            "departure_time": t_str,
            "stop_id": effective_id,
            "stop_sequence": i,
            "timepoint": 0,
        })
        if i < len(sorted_stops) - 1:
            # Advance to next stop: use OSRM leg duration or 60s fallback
            if i < len(leg_durations):
                cumulative += leg_durations[i]
            else:
                cumulative += 60.0

    return pd.DataFrame(rows)


def _build_calendar_dates_df(service_id: str) -> pd.DataFrame:
    """Build GTFS calendar_dates.txt DataFrame covering today through today+90 days.

    91 rows total (D-08). exception_type=1 means service runs on that date.
    """
    dates = pd.date_range(start=date.today(), periods=91, freq="D")
    return pd.DataFrame({
        "service_id": service_id,
        "date": dates.strftime("%Y%m%d"),
        "exception_type": 1,
    })


def _build_feed_info_df(start_date: str, end_date: str) -> pd.DataFrame:
    """Build GTFS feed_info.txt DataFrame with MTD Route Editor metadata (D-10)."""
    return pd.DataFrame([{
        "feed_publisher_name": "MTD Route Editor",
        "feed_publisher_url": "https://mtd.org",
        "feed_lang": "en",
        "feed_start_date": start_date,
        "feed_end_date": end_date,
        "feed_version": date.today().isoformat(),
    }])


def _build_agency_df(gtfs_feed) -> pd.DataFrame:
    """Build GTFS agency.txt DataFrame.

    If gtfs_feed is available and has an agency DataFrame, use it (real MTD values)
    but override agency_id to "MTD" so it matches the hardcoded value in routes.txt.
    Single-agency GTFS feeds often omit agency_id — forcing it here prevents the
    routes.txt → agency.txt FK violation caught by the MobilityData validator.
    Otherwise hard-code D-09 MTD values.
    """
    if gtfs_feed is not None and getattr(gtfs_feed.feed, "agency", None) is not None:
        df = gtfs_feed.feed.agency.copy()
        df["agency_id"] = "MTD"
        return df
    return pd.DataFrame([{
        "agency_id": "MTD",
        "agency_name": "Champaign-Urbana Mass Transit District",
        "agency_url": "https://mtd.org",
        "agency_timezone": "America/Chicago",
        "agency_lang": "en",
    }])


# ── Feed writer ──────────────────────────────────────────────────────────────

async def _write_feed(feed: gtfs_kit.Feed) -> bytes:
    """Write a gtfs_kit.Feed to a temporary zip and return raw bytes.

    Uses run_in_executor because feed.to_file() is synchronous and CPU-bound
    (pandas CSV serialization). Never raises — caller handles exceptions.
    """
    loop = asyncio.get_running_loop()

    def _sync_write() -> bytes:
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            tmp_path = pathlib.Path(tmp.name)
        try:
            feed.to_file(tmp_path)
            with open(tmp_path, "rb") as f:
                return f.read()
        finally:
            tmp_path.unlink(missing_ok=True)

    return await loop.run_in_executor(None, _sync_write)


# ── Export endpoint ──────────────────────────────────────────────────────────

@router.get("/export/{reroute_id}")
async def export_gtfs(
    reroute_id: UUID,
    request: Request,
    authorization: str = Header(...),
):
    """Export a reroute package as a GTFS static zip.

    Resolves to /api/gtfs/export/{reroute_id} (router prefix /gtfs, mounted at /api).
    Uses request: Request (NOT Depends(get_gtfs_feed)) so export works when the
    in-memory feed is unavailable — agency falls back to hard-coded MTD values (D-09).
    """
    # ── 1. Auth + ownership ──────────────────────────────────────────────────
    user_id = _user_id(authorization)
    client = _client()

    res = (
        client.from_("reroutes")
        .select("id, name, user_id")
        .eq("id", str(reroute_id))
        .eq("user_id", str(user_id))
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Reroute not found")
    reroute = res.data[0]

    # ── 2. Fetch routes with stops ───────────────────────────────────────────
    routes_res = (
        client.from_("saved_routes")
        .select("*, route_stops(*)")
        .eq("reroute_id", str(reroute_id))
        .execute()
    )
    saved_routes = routes_res.data or []
    if not saved_routes:
        raise HTTPException(status_code=404, detail="No routes in reroute")

    # ── 3. OSRM geometry + timing per route ──────────────────────────────────
    SERVICE_ID = "mtd_route_editor_service"
    stop_times_parts = []
    shapes_parts = []

    for route in saved_routes:
        sorted_stops = sorted(route["route_stops"], key=lambda s: s["stop_sequence"])
        route_id_str = str(route["id"])

        if len(sorted_stops) >= 2:
            osrm_result = await _osrm_route(sorted_stops)
        else:
            osrm_result = None

        if osrm_result:
            legs = osrm_result["legs"]
            leg_durations = [leg["duration"] for leg in legs]
            geometry_coords = osrm_result["geometry"]["coordinates"]
        else:
            # Fallback: 60s per stop; straight-line shape from stop coords
            leg_durations = []
            geometry_coords = [[s["stop_lon"], s["stop_lat"]] for s in sorted_stops]

        stop_times_parts.append(_build_stop_times_df(route, leg_durations))
        shapes_parts.append(_build_shapes_df(route_id_str, geometry_coords))

    # ── 4. Build all 8 DataFrames ────────────────────────────────────────────
    calendar_df = _build_calendar_dates_df(SERVICE_ID)
    start_date = calendar_df["date"].iloc[0]
    end_date = calendar_df["date"].iloc[-1]

    gtfs_feed = getattr(request.app.state, "gtfs_feed", None)
    agency_df = _build_agency_df(gtfs_feed)
    routes_df = _build_routes_df(saved_routes)
    stops_df = _build_stops_df(saved_routes)
    trips_df = _build_trips_df(saved_routes, SERVICE_ID)
    feed_info_df = _build_feed_info_df(start_date, end_date)
    stop_times_df = pd.concat(stop_times_parts, ignore_index=True)
    shapes_df = pd.concat(shapes_parts, ignore_index=True)

    # ── 5. Construct and write gtfs_kit.Feed ─────────────────────────────────
    feed = gtfs_kit.Feed(
        dist_units="km",
        agency=agency_df,
        routes=routes_df,
        trips=trips_df,
        stops=stops_df,
        stop_times=stop_times_df,
        shapes=shapes_df,
        calendar_dates=calendar_df,
        feed_info=feed_info_df,
    )

    zip_bytes = await _write_feed(feed)

    # ── 6. Return zip response ───────────────────────────────────────────────
    filename = f"{reroute['name'].replace(' ', '_')}-gtfs.zip"
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Trip updates (RT-02, RT-03) ───────────────────────────────────────────────

# Per-stop-set delay cache: key = sorted comma-joined stop_ids, value = (delays, timestamp)
_dep_cache: dict[str, tuple[dict, float]] = {}
_DEP_CACHE_TTL = 60  # seconds


def _evict_dep_cache() -> None:
    """Remove all entries from _dep_cache whose TTL has expired.

    Called at the start of each get_trip_updates request to prevent
    unbounded growth of the in-memory cache.
    """
    now = time.time()
    stale = [k for k, (_, ts) in _dep_cache.items() if now - ts >= _DEP_CACHE_TTL]
    for k in stale:
        del _dep_cache[k]


def _parse_iso_ts(s: str) -> float:
    """Parse an ISO-8601 timestamp string and return a UTC epoch float.

    If the string is timezone-naive (as MTD API sometimes returns), treat it
    as America/Chicago so delay computations are not off by the UTC offset.
    """
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("America/Chicago"))
    return dt.timestamp()


def _compute_delay(departure: dict) -> int | None:
    """Compute delay_seconds for a single departure dict.

    Returns:
        None  — if scheduledDeparture is falsy (cannot compute baseline)
        0     — if isRealTime is falsy or estimatedDeparture is falsy (on-time assumption)
        int   — signed seconds (positive=late, negative=early) when isRealTime=True
    """
    scheduled = departure.get("scheduledDeparture")
    if not scheduled:
        return None

    if not departure.get("isRealTime"):
        return 0

    estimated = departure.get("estimatedDeparture")
    if not estimated:
        return 0

    return int(
        _parse_iso_ts(estimated)
        - _parse_iso_ts(scheduled)
    )


async def _get_delays_for_stops(stop_ids: list[str]) -> dict[str, int]:
    """Fan out departure fetches for all stop_ids concurrently.

    Uses asyncio.gather with return_exceptions=True so a single stop failure
    does not abort the whole request — it is logged and omitted (warn-don't-crash).

    Returns a partial dict: stops with no departure data or upstream errors are omitted.
    """
    results = await asyncio.gather(
        *[get_stop_departures(sid) for sid in stop_ids],
        return_exceptions=True,
    )

    delays: dict[str, int] = {}
    for stop_id, result in zip(stop_ids, results):
        if isinstance(result, Exception):
            logger.warning("MTD departure fetch failed for %s: %s", stop_id, result)
            continue
        try:
            departures = result.get("result") or []
            if not departures:
                continue  # omit stops with no departure data (D-07)

            # Filter to departures with a non-null scheduledDeparture, then sort by epoch (Pitfall 3)
            valid = [d for d in departures if d.get("scheduledDeparture")]
            if not valid:
                continue

            valid.sort(key=lambda d: _parse_iso_ts(d["scheduledDeparture"]))
            soonest = valid[0]

            delay = _compute_delay(soonest)
            if delay is not None:
                delays[stop_id] = delay
        except (ValueError, TypeError, KeyError) as exc:
            logger.warning("Malformed departure data for %s: %s", stop_id, exc)
            continue

    return delays


@router.get("/trip-updates")
async def get_trip_updates(
    stop_ids: str,
    user_id: str = Depends(_user_id),
) -> dict[str, int]:
    """Return per-stop delay seconds derived from MTD v3 real-time departures.

    Response: flat dict[stop_id, delay_seconds] — positive=late, negative=early, 0=on-time.
    Stops with no data or upstream errors are omitted (partial result).
    Results are cached for 60 seconds keyed by the sorted stop_id set.
    """
    # Evict stale cache entries on every request to prevent unbounded growth
    _evict_dep_cache()

    # Input validation (V5 ASVS)
    ids = [sid.strip() for sid in stop_ids.split(",") if sid.strip()]
    if not ids:
        raise HTTPException(status_code=400, detail="stop_ids must not be empty")
    for sid in ids:
        if not _STOP_ID_RE.match(sid):
            raise HTTPException(status_code=400, detail=f"Invalid stop_id: {sid!r}")

    # Order-independent cache key (Pitfall 1 — sorted to maximize hit rate)
    cache_key = ",".join(sorted(ids))
    if cache_key in _dep_cache:
        cached_data, ts = _dep_cache[cache_key]
        if time.time() - ts < _DEP_CACHE_TTL:
            return cached_data

    delays = await _get_delays_for_stops(ids)
    _dep_cache[cache_key] = (delays, time.time())
    return delays
