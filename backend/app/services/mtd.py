"""Client for MTD API v3 at api.mtd.dev.

Auth: X-ApiKey header (not query param).
Response envelope: { "result": T | null, "error": {...} | null }
No changeset_id caching — v3 uses standard HTTP caching headers.
"""

import httpx
from app.config import settings


def _headers() -> dict[str, str]:
    return {"X-ApiKey": settings.mtd_api_key}


async def _get(path: str, params: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{settings.mtd_api_base}{path}",
            headers=_headers(),
            params=params or {},
        )
        resp.raise_for_status()
        return resp.json()


def _unwrap(data: dict) -> dict:
    """Return the raw response dict; callers decide how to use result/error."""
    return data


# ── Route groups (what v2 called "routes") ───────────────────────────────────

async def get_route_groups() -> dict:
    return _unwrap(await _get("/routes/groups"))


async def get_route_group(route_group_id: str) -> dict:
    return _unwrap(await _get(f"/routes/groups/{route_group_id}"))


async def get_route(route_id: str) -> dict:
    return _unwrap(await _get(f"/routes/{route_id}"))


# ── Stops ────────────────────────────────────────────────────────────────────

async def get_stops(exclude_boarding_points: bool = False) -> dict:
    params = {"excludeBoardingPoints": "true"} if exclude_boarding_points else {}
    return _unwrap(await _get("/stops", params))


async def get_stop(stop_id: str) -> dict:
    return _unwrap(await _get(f"/stops/{stop_id}"))


async def search_stops(query: str) -> dict:
    return _unwrap(await _get("/stops/search", {"query": query}))


async def get_stop_trips(stop_id: str) -> dict:
    return _unwrap(await _get(f"/stops/{stop_id}/trips"))


async def get_stop_route_groups(stop_id: str) -> dict:
    return _unwrap(await _get(f"/stops/{stop_id}/route-groups"))


# ── Trips ────────────────────────────────────────────────────────────────────

async def get_trips() -> dict:
    """All trips in the system. Used to find a representative trip for a route group."""
    return _unwrap(await _get("/trips"))


async def get_trip(trip_id: str) -> dict:
    return _unwrap(await _get(f"/trips/{trip_id}"))


# ── Shapes ───────────────────────────────────────────────────────────────────

async def get_shape(shape_id: str) -> dict:
    return _unwrap(await _get(f"/shapes/{shape_id}"))


async def get_shape_polyline(shape_id: str) -> dict:
    """Returns an encoded Google polyline string for the shape."""
    return _unwrap(await _get(f"/shape/{shape_id}/polyline"))
