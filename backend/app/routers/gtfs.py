"""GTFS feed status and metadata endpoints."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from app.services import gtfs as gtfs_svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/gtfs", tags=["gtfs"])


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
