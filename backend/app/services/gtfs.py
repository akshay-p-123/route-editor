"""GTFS static and GTFS-RT feed ingestion services.

Static feed: downloads and parses MTD's GTFS static zip on startup, holds it in
memory as a GtfsFeed dataclass on app.state.gtfs_feed, and refreshes in background.

RT feed: downloads and parses the MTD GTFS-RT protobuf feed once per hour (RT-01),
holds the parsed FeedMessage on app.state.gtfs_rt_feed, and retains the prior feed
on any fetch failure (warn-don't-crash).
"""

import asyncio
import logging
import os
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone

import gtfs_kit
import httpx

from app import gtfs_realtime_pb2 as pb2
from app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class GtfsFeed:
    feed: gtfs_kit.Feed
    loaded_at: datetime


async def load_gtfs_feed() -> GtfsFeed:
    """Download and parse the GTFS static zip from settings.gtfs_feed_url.

    The parse step is run in a thread executor since gtfs_kit.read_feed is
    synchronous and CPU-bound (pandas/geopandas), so it must not block the
    asyncio event loop.
    """
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(settings.gtfs_feed_url)
        resp.raise_for_status()
        zip_bytes = resp.content

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            tmp.write(zip_bytes)
            tmp_path = tmp.name

        loop = asyncio.get_running_loop()
        parsed = await loop.run_in_executor(
            None, lambda: gtfs_kit.read_feed(tmp_path, dist_units="km")
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

    return GtfsFeed(feed=parsed, loaded_at=datetime.now(timezone.utc))


async def load_and_store(app) -> None:
    """Load the GTFS feed and store it on app.state.gtfs_feed.

    Called from the lifespan gather alongside MTD cache warmup. Exceptions
    propagate to the lifespan try/except so a failed initial load leaves
    app.state.gtfs_feed as None (which triggers the 503 guard).
    """
    gtfs_feed = await load_gtfs_feed()
    app.state.gtfs_feed = gtfs_feed
    routes_count = 0 if gtfs_feed.feed.routes is None else len(gtfs_feed.feed.routes)
    stops_count = 0 if gtfs_feed.feed.stops is None else len(gtfs_feed.feed.stops)
    logger.info("GTFS feed loaded (%d routes, %d stops)", routes_count, stops_count)


async def _refresh_loop(app) -> None:
    """Background task that refreshes the GTFS feed on a configured interval.

    Warn-don't-crash: a failed refresh logs a warning and retains the prior
    feed. The feed is never set to None after first success.
    """
    interval = settings.gtfs_refresh_interval_hours * 3600
    while True:
        await asyncio.sleep(interval)
        try:
            gtfs_feed = await load_gtfs_feed()
            app.state.gtfs_feed = gtfs_feed
            logger.info("GTFS feed refreshed")
        except Exception as exc:
            logger.warning("GTFS background refresh failed: %s", exc)


# ── RT-01: GTFS-RT feed (hourly background refresh) ──────────────────────────

async def load_gtfs_rt_feed() -> pb2.FeedMessage:
    """Fetch and parse the GTFS-RT protobuf feed from settings.gtfs_rt_feed_url.

    Uses async httpx.AsyncClient — never the synchronous blocking variant.
    Returns a parsed pb2.FeedMessage. Raises on HTTP or parse errors (caller
    decides whether to warn-don't-crash).
    """
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(settings.gtfs_rt_feed_url)
        resp.raise_for_status()

    msg = pb2.FeedMessage()
    msg.ParseFromString(resp.content)
    return msg


async def _gtfs_rt_refresh_loop(app) -> None:
    """Background task that refreshes the GTFS-RT feed once per hour (RT-01).

    Hard-coded 3600s interval per D-06 — never shorter regardless of request
    volume. Warn-don't-crash: a failed refresh logs a warning and retains the
    prior feed. app.state.gtfs_rt_feed is never set to None after first success.
    """
    while True:
        await asyncio.sleep(3600)
        try:
            rt_feed = await load_gtfs_rt_feed()
            app.state.gtfs_rt_feed = rt_feed
            logger.info("GTFS-RT feed refreshed")
        except Exception as exc:
            logger.warning("GTFS-RT background refresh failed: %s", exc)
