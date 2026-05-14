"""Proxy routes for the MTD API v3 — keeps the X-ApiKey header off the client."""

from fastapi import APIRouter, HTTPException, Query
from app.services import mtd as mtd_svc

router = APIRouter(prefix="/mtd", tags=["mtd"])


def _ok(data: dict) -> dict:
    if data.get("error"):
        err = data["error"]
        raise HTTPException(status_code=502, detail=err.get("message", "MTD error"))
    return data


# ── Route groups ──────────────────────────────────────────────────────────────

@router.get("/route-groups")
async def get_route_groups():
    return _ok(await mtd_svc.get_route_groups())


@router.get("/route-groups/{route_group_id}")
async def get_route_group(route_group_id: str):
    return _ok(await mtd_svc.get_route_group(route_group_id))


@router.get("/routes/{route_id}")
async def get_route(route_id: str):
    return _ok(await mtd_svc.get_route(route_id))


# ── Stops ─────────────────────────────────────────────────────────────────────

@router.get("/stops")
async def get_stops(exclude_boarding_points: bool = Query(False)):
    return _ok(await mtd_svc.get_stops(exclude_boarding_points))


@router.get("/stops/search")
async def search_stops(query: str = Query(..., min_length=1, max_length=50)):
    return _ok(await mtd_svc.search_stops(query))


@router.get("/stops/{stop_id}")
async def get_stop(stop_id: str):
    return _ok(await mtd_svc.get_stop(stop_id))


@router.get("/stops/{stop_id}/trips")
async def get_stop_trips(stop_id: str):
    return _ok(await mtd_svc.get_stop_trips(stop_id))


@router.get("/stops/{stop_id}/route-groups")
async def get_stop_route_groups(stop_id: str):
    return _ok(await mtd_svc.get_stop_route_groups(stop_id))


# ── Trips ─────────────────────────────────────────────────────────────────────

@router.get("/trips")
async def get_trips():
    return _ok(await mtd_svc.get_trips())


@router.get("/trips/{trip_id}")
async def get_trip(trip_id: str):
    return _ok(await mtd_svc.get_trip(trip_id))


# ── Shapes ────────────────────────────────────────────────────────────────────

@router.get("/shapes/{shape_id}")
async def get_shape(shape_id: str):
    return _ok(await mtd_svc.get_shape(shape_id))


@router.get("/shapes/{shape_id}/polyline")
async def get_shape_polyline(shape_id: str):
    return _ok(await mtd_svc.get_shape_polyline(shape_id))
