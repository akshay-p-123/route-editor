"""Tests for GTFS-RT TripModifications — TRIPMOD-01..05, RT-01.

Plan 01 (Wave 0 scaffold):
  - test_proto_round_trip: PASSES after Plan 01 (proto module committed)
  - test_rt_refresh_retains_on_failure: PASSES after Plan 01 Task 2 (RT-01 loop)
  - test_import_503_when_rt_feed_none: PASSES after Plan 01 Task 2 (get_gtfs_rt_feed guard)
  - All other tests: SKIPPED until plans 02-03 implement _resolve_stop, _build_trip_mod_feed,
    _parse_trip_mod_feed (controlled by _requires flag).

Plan 02 (this plan):
  - test_parse_resolves_known_stop: PASSES after _resolve_stop implemented
  - test_parse_skips_unknown_stop: PASSES after _resolve_stop implemented
  - test_import_endpoint_200: PASSES after import_trip_modifications endpoint implemented
  - test_import_bad_url_error: PASSES after 502 error handling implemented
  - test_import_ssrf_blocked: PASSES after _validate_feed_url SSRF guard implemented
"""

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app import gtfs_realtime_pb2 as pb2

# ── Conditional import guard for not-yet-implemented functions ────────────────

# Plan 02 imports: _resolve_stop, _parse_trip_mod_feed, _validate_feed_url
try:
    from app.routers.gtfs import (
        _resolve_stop,
        _parse_trip_mod_feed,
        _validate_feed_url,
    )
    _IMPORT_AVAILABLE = True
except ImportError:
    _resolve_stop = _parse_trip_mod_feed = _validate_feed_url = None  # type: ignore[assignment]
    _IMPORT_AVAILABLE = False

# Plan 03 imports: _build_trip_mod_feed (export function, not yet implemented)
try:
    from app.routers.gtfs import _build_trip_mod_feed  # noqa: F401
    _EXPORT_AVAILABLE = True
except ImportError:
    _build_trip_mod_feed = None  # type: ignore[assignment]
    _EXPORT_AVAILABLE = False

# _requires: skip Plan 02+03 tests when neither is available
_AVAILABLE = _IMPORT_AVAILABLE or _EXPORT_AVAILABLE

_requires = pytest.mark.skipif(
    not _AVAILABLE,
    reason="TRIPMOD-02/05 functions not yet implemented (Plans 02-03)",
)
# Plan-specific skip guards
_requires_import = pytest.mark.skipif(
    not _IMPORT_AVAILABLE,
    reason="TRIPMOD-02 import functions not yet implemented (Plan 02)",
)
_requires_export = pytest.mark.skipif(
    not _EXPORT_AVAILABLE,
    reason="TRIPMOD-05 export functions not yet implemented (Plan 03)",
)


# ── Plan 01 Task 1: proto round-trip (always runs) ───────────────────────────

def test_proto_round_trip():
    """Build a FeedMessage with one TripModifications entity, serialize then
    parse it back, and assert the trip_ids survive the round trip.

    This test has no dependency on Plans 02-03 and MUST pass after Plan 01.
    """
    # Build
    out = pb2.FeedMessage()
    out.header.gtfs_realtime_version = "2.0"
    out.header.timestamp = 1_700_000_000
    entity = out.entity.add()
    entity.id = "reroute-test-1"
    sel = entity.trip_modifications.selected_trips.add()
    sel.trip_ids.append("MTD_trip_42")
    sel.trip_ids.append("MTD_trip_43")

    # Serialize
    raw = out.SerializeToString()
    assert len(raw) > 0

    # Parse
    parsed = pb2.FeedMessage()
    parsed.ParseFromString(raw)

    assert len(parsed.entity) == 1
    assert parsed.entity[0].id == "reroute-test-1"
    tm = parsed.entity[0].trip_modifications
    assert len(tm.selected_trips) == 1
    assert "MTD_trip_42" in tm.selected_trips[0].trip_ids
    assert "MTD_trip_43" in tm.selected_trips[0].trip_ids


# ── Plan 01 Task 2: RT-01 refresh loop ────────────────────────────────────────

async def test_rt_refresh_retains_on_failure():
    """When the fetch inside _gtfs_rt_refresh_loop raises, app.state.gtfs_rt_feed
    retains its prior value and is never set to None after a prior success.
    """
    from app.services import gtfs as gtfs_svc

    # Build a minimal prior feed to set as the existing state
    prior_feed = pb2.FeedMessage()
    prior_feed.header.gtfs_realtime_version = "2.0"

    app = MagicMock()
    app.state.gtfs_rt_feed = prior_feed
    prior_identity = id(prior_feed)

    # Patch load_gtfs_rt_feed to raise on the first call (simulating refresh failure)
    with patch.object(gtfs_svc, "load_gtfs_rt_feed", side_effect=Exception("network error")):
        # Patch asyncio.sleep to avoid waiting and to stop the loop after one iteration
        call_count = 0

        async def mock_sleep(seconds):
            nonlocal call_count
            call_count += 1
            if call_count >= 1:
                raise asyncio.CancelledError()

        with patch("asyncio.sleep", side_effect=mock_sleep):
            try:
                await gtfs_svc._gtfs_rt_refresh_loop(app)
            except asyncio.CancelledError:
                pass

    # The prior feed object must be retained — identity unchanged
    assert id(app.state.gtfs_rt_feed) == prior_identity
    assert app.state.gtfs_rt_feed is prior_feed


async def test_import_503_when_rt_feed_none():
    """A request through Depends(get_gtfs_rt_feed) returns 503 when
    app.state.gtfs_rt_feed is None (D-07).
    """
    from fastapi import HTTPException
    from app.routers.gtfs import get_gtfs_rt_feed

    request = MagicMock()
    request.app.state.gtfs_rt_feed = None

    with pytest.raises(HTTPException) as exc_info:
        get_gtfs_rt_feed(request)

    assert exc_info.value.status_code == 503
    assert "not yet" in exc_info.value.detail.lower() or "available" in exc_info.value.detail.lower()


# ── Plan 02: TripMod import tests ────────────────────────────────────────────

@_requires_import
def test_parse_resolves_known_stop(mock_gtfs_feed):
    """_resolve_stop returns stop dict when stop_id exists in the static feed."""
    result = _resolve_stop("MTD_1001", mock_gtfs_feed)
    assert result is not None
    assert result["stop_id"] == "MTD_1001"
    assert "stop_lat" in result
    assert "stop_lon" in result
    assert "stop_name" in result


@_requires_import
def test_parse_skips_unknown_stop(mock_gtfs_feed):
    """_resolve_stop returns None for a stop_id not in the static feed."""
    result = _resolve_stop("UNKNOWN_999", mock_gtfs_feed)
    assert result is None


@_requires_import
async def test_import_endpoint_200(mock_gtfs_feed):
    """POST /api/gtfs/trip-modifications/import returns 200 with a list of
    affected trip descriptors when given a valid feed URL.

    Tests _parse_trip_mod_feed directly to avoid TestClient + httpx mock complexity.
    """
    # Build a minimal TripModifications protobuf payload
    feed = pb2.FeedMessage()
    feed.header.gtfs_realtime_version = "2.0"
    feed.header.timestamp = 1_700_000_000
    entity = feed.entity.add()
    entity.id = "e1"
    sel = entity.trip_modifications.selected_trips.add()
    sel.trip_ids.append("MTD_trip_99")
    mod = entity.trip_modifications.modifications.add()
    rs = mod.replacement_stops.add()
    rs.stop_id = "MTD_1001"
    rs.travel_time_to_stop = 120
    raw = feed.SerializeToString()

    # Mock httpx.AsyncClient to return the protobuf bytes
    mock_response = MagicMock()
    mock_response.content = raw
    mock_response.raise_for_status = MagicMock()

    mock_client_instance = AsyncMock()
    mock_client_instance.get = AsyncMock(return_value=mock_response)

    # Mock the context manager
    mock_context = MagicMock()
    mock_context.__aenter__ = AsyncMock(return_value=mock_client_instance)
    mock_context.__aexit__ = AsyncMock(return_value=False)

    with patch("app.routers.gtfs.httpx.AsyncClient", return_value=mock_context):
        result = await _parse_trip_mod_feed("https://example.com/tripmod.pb", mock_gtfs_feed)

    assert isinstance(result, list)
    assert len(result) >= 1
    trip = result[0]
    assert trip["trip_id"] == "MTD_trip_99"
    assert "stops" in trip
    # The stop MTD_1001 should be resolved from mock_gtfs_feed
    assert len(trip["stops"]) == 1
    assert trip["stops"][0]["stop_id"] == "MTD_1001"
    assert trip["stops"][0]["travel_time_to_stop"] == 120


@_requires_import
async def test_import_bad_url_error():
    """_parse_trip_mod_feed raises when the URL is unreachable, endpoint returns 502."""
    from fastapi import HTTPException
    from app.routers.gtfs import import_trip_modifications, _TripModImportBody

    # Mock httpx to raise a connection error simulating an unreachable host
    mock_client_instance = AsyncMock()
    mock_client_instance.get = AsyncMock(side_effect=Exception("Connection refused"))

    mock_context = MagicMock()
    mock_context.__aenter__ = AsyncMock(return_value=mock_client_instance)
    mock_context.__aexit__ = AsyncMock(return_value=False)

    mock_request = MagicMock()
    mock_request.app.state.gtfs_feed = None

    # Bypass _validate_feed_url so only the fetch failure is tested
    with patch("app.routers.gtfs._validate_feed_url"):
        with patch("app.routers.gtfs.httpx.AsyncClient", return_value=mock_context):
            with pytest.raises(HTTPException) as exc_info:
                await import_trip_modifications(
                    _TripModImportBody(url="https://unreachable.example.com/tripmod.pb"),
                    mock_request,
                    user_id="test-user-id",
                )
    assert exc_info.value.status_code == 502


@_requires_import
async def test_import_ssrf_blocked():
    """POST /api/gtfs/trip-modifications/import rejects private/loopback IPs to prevent SSRF."""
    from fastapi import HTTPException

    # Test localhost URL — should raise 400
    with pytest.raises(HTTPException) as exc_info:
        _validate_feed_url("http://localhost/feed.pb")
    assert exc_info.value.status_code == 400

    # Test loopback IP
    with pytest.raises(HTTPException) as exc_info:
        _validate_feed_url("http://127.0.0.1/feed.pb")
    assert exc_info.value.status_code == 400

    # Test private IP range
    with pytest.raises(HTTPException) as exc_info:
        _validate_feed_url("http://192.168.1.1/feed.pb")
    assert exc_info.value.status_code == 400

    # Test http:// (non-https)
    with pytest.raises(HTTPException) as exc_info:
        _validate_feed_url("http://example.com/feed.pb")
    assert exc_info.value.status_code == 400

    # Test file:// scheme
    with pytest.raises(HTTPException) as exc_info:
        _validate_feed_url("file:///etc/passwd")
    assert exc_info.value.status_code == 400

    # Valid https URL should NOT raise
    _validate_feed_url("https://example.com/tripmod.pb")  # should not raise


# ── Plan 03 stubs: TripMod export (skip-guarded) ─────────────────────────────

@_requires_export
async def test_export_round_trip_pb(sample_saved_routes, sample_reroute):
    """GET /api/gtfs/export/{reroute_id}/trip-modifications?format=pb returns a
    valid protobuf binary that parses back to a FeedMessage.
    """
    # Implemented in Plan 03
    pass


@_requires_export
async def test_export_json_format(sample_saved_routes, sample_reroute):
    """GET /api/gtfs/export/{reroute_id}/trip-modifications?format=json returns
    valid JSON that deserializes to a FeedMessage via json_format.
    """
    # Implemented in Plan 03
    pass


@_requires_export
async def test_travel_time_monotonic(sample_saved_routes, sample_reroute):
    """TripMod export: travel_time_to_stop values are non-decreasing across
    replacement_stops in each Modification.
    """
    # Implemented in Plan 03
    pass
