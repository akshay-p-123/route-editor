"""Client for MTD API v3 at api.mtd.dev.

Auth: X-ApiKey header (not query param).
Response envelope: { "result": T | null, "error": {...} | null }

In-memory TTL cache sits in front of the MTD API.
MTD schedule data changes at most once per day, so a 1-hour TTL is safe for
static data (routes, stops, trips). Shapes are essentially immutable between
schedule releases, so they get a 24-hour TTL. Real-time endpoints (search,
departures) bypass the cache entirely; departures additionally use a 60-second
_dep_cache TTL managed in the router layer.
"""

import time
import httpx
from app.config import settings


def _headers() -> dict[str, str]:
    return {"X-ApiKey": settings.mtd_api_key}


# (response_dict, unix_timestamp_of_fetch)
_cache: dict[str, tuple[dict, float]] = {}


async def _get(path: str, params: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{settings.mtd_api_base}{path}",
            headers=_headers(),
            params=params or {},
        )
        resp.raise_for_status()
        return resp.json()


async def _get_cached(path: str, params: dict | None = None, ttl: int = 3600) -> dict:
    key = path + (str(sorted(params.items())) if params else "")
    if key in _cache:
        data, ts = _cache[key]
        if time.time() - ts < ttl:
            return data
    data = await _get(path, params)
    _cache[key] = (data, time.time())
    return data


def _unwrap(data: dict) -> dict:
    return data


# ── Route groups ─────────────────────────────────────────────────────────────

async def get_route_groups() -> dict:
    return _unwrap(await _get_cached("/routes/groups"))


async def get_route_group(route_group_id: str) -> dict:
    return _unwrap(await _get_cached(f"/routes/groups/{route_group_id}"))


async def get_route(route_id: str) -> dict:
    return _unwrap(await _get_cached(f"/routes/{route_id}"))


# ── Stops ────────────────────────────────────────────────────────────────────

async def get_stops(exclude_boarding_points: bool = False) -> dict:
    params = {"excludeBoardingPoints": "true"} if exclude_boarding_points else None
    return _unwrap(await _get_cached("/stops", params))


async def get_stop(stop_id: str) -> dict:
    return _unwrap(await _get_cached(f"/stops/{stop_id}"))


async def search_stops(query: str) -> dict:
    # Real-time text search — never cache
    return _unwrap(await _get("/stops/search", {"query": query}))


async def get_stop_trips(stop_id: str) -> dict:
    return _unwrap(await _get_cached(f"/stops/{stop_id}/trips"))


async def get_stop_route_groups(stop_id: str) -> dict:
    return _unwrap(await _get_cached(f"/stops/{stop_id}/route-groups"))


# ── Trips ────────────────────────────────────────────────────────────────────

async def get_trips() -> dict:
    return _unwrap(await _get_cached("/trips"))


async def get_trip(trip_id: str) -> dict:
    return _unwrap(await _get_cached(f"/trips/{trip_id}"))


# ── Shapes — 24-hour TTL since shapes are immutable between schedule releases ─

async def get_shape(shape_id: str) -> dict:
    return _unwrap(await _get_cached(f"/shapes/{shape_id}", ttl=86400))


async def get_shape_polyline(shape_id: str) -> dict:
    return _unwrap(await _get_cached(f"/shape/{shape_id}/polyline", ttl=86400))


# ── Departures — real-time, 60s TTL ──────────────────────────────────────────

async def get_stop_departures(stop_id: str) -> dict:
    """Fetch real-time departures for a stop from MTD API v3.

    Bypasses the static 1-hour TTL cache entirely — departure data is real-time
    and must never be served from _get_cached. The router layer applies its own
    60-second _dep_cache on the aggregated result.
    """
    return await _get(f"/stops/{stop_id}/departures")
