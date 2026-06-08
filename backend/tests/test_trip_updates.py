"""Tests for per-stop real-time delay endpoint — RT-02, RT-03, D-07.

Task 1: Stubs only — trip-update functions not yet implemented (RED state via skip-guard).
        Collection succeeds; running tests skips until Tasks 2-3 add the functions.
Task 2: get_stop_departures + endpoint implemented — happy-path tests turn GREEN.
Task 3: Edge cases hardened — all 11 tests GREEN.
"""

import asyncio
import time
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import Header

# Try to import trip-update functions. ImportError is expected (RED) until Tasks 2-3 are done.
try:
    from app.routers.gtfs import (
        _compute_delay,
        _get_delays_for_stops,
        get_trip_updates,
    )
    from app.services.mtd import get_stop_departures
    _IMPL_AVAILABLE = True
except ImportError:
    _IMPL_AVAILABLE = False
    _compute_delay = _get_delays_for_stops = get_trip_updates = None
    get_stop_departures = None

import app.routers.gtfs as gtfs_module

_requires_impl = pytest.mark.skipif(
    not _IMPL_AVAILABLE,
    reason="trip update functions not yet implemented (Tasks 2-3)"
)


# ── _compute_delay pure-function tests ───────────────────────────────────────

@_requires_impl
def test_compute_delay():
    """isRealTime=True, estimated 2 minutes after scheduled → 120 seconds."""
    # Late case: +120s
    dep = {
        "scheduledDeparture": "2026-06-08T14:30:00-05:00",
        "estimatedDeparture": "2026-06-08T14:32:00-05:00",
        "isRealTime": True,
    }
    assert _compute_delay(dep) == 120

    # Early case: estimated before scheduled → negative
    dep_early = {
        "scheduledDeparture": "2026-06-08T14:30:00-05:00",
        "estimatedDeparture": "2026-06-08T14:29:00-05:00",
        "isRealTime": True,
    }
    assert _compute_delay(dep_early) == -60

    # Equal times → 0
    dep_equal = {
        "scheduledDeparture": "2026-06-08T14:30:00-05:00",
        "estimatedDeparture": "2026-06-08T14:30:00-05:00",
        "isRealTime": True,
    }
    assert _compute_delay(dep_equal) == 0


@_requires_impl
def test_compute_delay_not_realtime():
    """isRealTime=False → return 0 regardless of timestamps (not computed)."""
    dep = {
        "scheduledDeparture": "2026-06-08T14:30:00-05:00",
        "estimatedDeparture": "2026-06-08T14:35:00-05:00",
        "isRealTime": False,
    }
    assert _compute_delay(dep) == 0

    # estimatedDeparture absent but isRealTime False → still 0
    dep_no_estimated = {
        "scheduledDeparture": "2026-06-08T14:30:00-05:00",
        "estimatedDeparture": None,
        "isRealTime": False,
    }
    assert _compute_delay(dep_no_estimated) == 0


@_requires_impl
def test_compute_delay_no_scheduled():
    """scheduledDeparture=None → return None (cannot compute delay without baseline)."""
    dep = {
        "scheduledDeparture": None,
        "estimatedDeparture": "2026-06-08T14:32:00-05:00",
        "isRealTime": True,
    }
    assert _compute_delay(dep) is None


# ── _get_delays_for_stops fan-out tests ──────────────────────────────────────

@_requires_impl
async def test_soonest_departure_selected():
    """Multiple departures: the delay of the soonest scheduledDeparture is returned.

    Departures given in reverse order — list order must not determine result.
    """
    departures = [
        {
            "scheduledDeparture": "2026-06-08T15:00:00-05:00",  # later — ignore
            "estimatedDeparture": "2026-06-08T15:10:00-05:00",
            "isRealTime": True,
        },
        {
            "scheduledDeparture": "2026-06-08T14:30:00-05:00",  # soonest — use this
            "estimatedDeparture": "2026-06-08T14:33:00-05:00",
            "isRealTime": True,
        },
    ]

    mock_response = {"result": departures, "error": None}

    with patch("app.routers.gtfs.get_stop_departures", new=AsyncMock(return_value=mock_response)):
        result = await _get_delays_for_stops(["stp_A"])

    # Soonest departure is 14:30 scheduled, 14:33 estimated → 180s delay
    assert result == {"stp_A": 180}


@_requires_impl
async def test_per_stop_error_omitted():
    """When get_stop_departures raises for one stop, that stop is omitted; others resolve."""
    good_response = {
        "result": [
            {
                "scheduledDeparture": "2026-06-08T14:30:00-05:00",
                "estimatedDeparture": "2026-06-08T14:32:00-05:00",
                "isRealTime": True,
            }
        ],
        "error": None,
    }

    async def mock_departures(stop_id):
        if stop_id == "stp_bad":
            raise Exception("MTD API error")
        return good_response

    with patch("app.routers.gtfs.get_stop_departures", side_effect=mock_departures):
        result = await _get_delays_for_stops(["stp_A", "stp_bad"])

    assert "stp_bad" not in result, "Error stop should be omitted"
    assert "stp_A" in result, "Good stop should be present"
    assert result["stp_A"] == 120


@_requires_impl
async def test_no_departures_omitted():
    """Stop whose result list is empty/None is omitted from the response (D-07)."""
    empty_response = {"result": [], "error": None}
    null_response = {"result": None, "error": None}

    with patch("app.routers.gtfs.get_stop_departures", new=AsyncMock(return_value=empty_response)):
        result = await _get_delays_for_stops(["stp_empty"])

    assert "stp_empty" not in result, "Stop with empty departures should be omitted"

    with patch("app.routers.gtfs.get_stop_departures", new=AsyncMock(return_value=null_response)):
        result = await _get_delays_for_stops(["stp_null"])

    assert "stp_null" not in result, "Stop with null departures should be omitted"


# ── Endpoint cache tests ──────────────────────────────────────────────────────

@_requires_impl
def test_cache_miss_fetches(monkeypatch):
    """First call for a stop set invokes the fetch path and stores result in _dep_cache."""
    from fastapi.testclient import TestClient
    from app.main import app

    # Clear cache before test
    monkeypatch.setattr(gtfs_module, "_dep_cache", {})

    good_response = {
        "result": [
            {
                "scheduledDeparture": "2026-06-08T14:30:00-05:00",
                "estimatedDeparture": "2026-06-08T14:32:00-05:00",
                "isRealTime": True,
            }
        ],
        "error": None,
    }

    # Use FastAPI dependency_overrides for Depends(_user_id)
    app.dependency_overrides[gtfs_module._user_id] = lambda: "user-test-id"
    try:
        with patch("app.routers.gtfs.get_stop_departures", new=AsyncMock(return_value=good_response)) as mock_fetch:
            client = TestClient(app, raise_server_exceptions=True)
            response = client.get(
                "/api/gtfs/trip-updates",
                params={"stop_ids": "stp_A"},
                headers={"Authorization": "Bearer fake-token"},
            )
    finally:
        app.dependency_overrides.pop(gtfs_module._user_id, None)

    assert response.status_code == 200
    assert mock_fetch.called, "get_stop_departures should have been called on cache miss"
    # Cache should now contain the result
    cache_key = "stp_A"
    assert cache_key in gtfs_module._dep_cache, "Result should be stored in _dep_cache"


@_requires_impl
def test_cache_hit_no_refetch(monkeypatch):
    """A second call within 60s with a pre-seeded fresh cache entry does NOT re-fetch."""
    from fastapi.testclient import TestClient
    from app.main import app

    # Pre-seed cache with a fresh entry
    cached_delays = {"stp_A": 120, "stp_B": 60}
    fresh_ts = time.time()
    monkeypatch.setattr(
        gtfs_module,
        "_dep_cache",
        {"stp_A,stp_B": (cached_delays, fresh_ts)},
    )

    # Use FastAPI dependency_overrides for Depends(_user_id)
    app.dependency_overrides[gtfs_module._user_id] = lambda: "user-test-id"
    try:
        with patch("app.routers.gtfs.get_stop_departures", new=AsyncMock()) as mock_fetch:
            client = TestClient(app, raise_server_exceptions=True)
            response = client.get(
                "/api/gtfs/trip-updates",
                params={"stop_ids": "stp_A,stp_B"},
                headers={"Authorization": "Bearer fake-token"},
            )
    finally:
        app.dependency_overrides.pop(gtfs_module._user_id, None)

    assert response.status_code == 200
    assert not mock_fetch.called, "get_stop_departures should NOT be called on cache hit"
    assert response.json() == cached_delays


@_requires_impl
def test_cache_key_sorted(monkeypatch):
    """stop_ids='stp_B,stp_A' hits the same cache entry as 'stp_A,stp_B'."""
    from fastapi.testclient import TestClient
    from app.main import app

    # Pre-seed with sorted key
    cached_delays = {"stp_A": 30, "stp_B": 90}
    fresh_ts = time.time()
    monkeypatch.setattr(
        gtfs_module,
        "_dep_cache",
        {"stp_A,stp_B": (cached_delays, fresh_ts)},
    )

    # Use FastAPI dependency_overrides for Depends(_user_id)
    app.dependency_overrides[gtfs_module._user_id] = lambda: "user-test-id"
    try:
        with patch("app.routers.gtfs.get_stop_departures", new=AsyncMock()) as mock_fetch:
            client = TestClient(app, raise_server_exceptions=True)
            # Request with reversed order
            response = client.get(
                "/api/gtfs/trip-updates",
                params={"stop_ids": "stp_B,stp_A"},
                headers={"Authorization": "Bearer fake-token"},
            )
    finally:
        app.dependency_overrides.pop(gtfs_module._user_id, None)

    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    assert not mock_fetch.called, "Cache key must be order-independent; fetch should not occur"
    assert response.json() == cached_delays


# ── Input validation + auth tests ────────────────────────────────────────────

@_requires_impl
def test_empty_stop_ids_400():
    """GET with empty/whitespace stop_ids returns HTTP 400."""
    from fastapi.testclient import TestClient
    from app.main import app

    # Use FastAPI dependency_overrides for Depends(_user_id)
    app.dependency_overrides[gtfs_module._user_id] = lambda: "user-test-id"
    try:
        client = TestClient(app, raise_server_exceptions=True)

        # Empty string
        response = client.get(
            "/api/gtfs/trip-updates",
            params={"stop_ids": ""},
            headers={"Authorization": "Bearer fake-token"},
        )
        assert response.status_code == 400, f"Expected 400 for empty stop_ids, got {response.status_code}"

        # Whitespace only
        response = client.get(
            "/api/gtfs/trip-updates",
            params={"stop_ids": "   "},
            headers={"Authorization": "Bearer fake-token"},
        )
        assert response.status_code == 400, f"Expected 400 for whitespace stop_ids, got {response.status_code}"
    finally:
        app.dependency_overrides.pop(gtfs_module._user_id, None)


@_requires_impl
def test_unauthenticated_401():
    """GET without a valid token returns HTTP 401."""
    from fastapi.testclient import TestClient
    from fastapi import HTTPException
    from app.main import app

    # Override _user_id to raise 401 — simulates invalid/missing token
    def _raise_401(authorization: str = Header(...)):
        raise HTTPException(status_code=401, detail="Invalid token")

    app.dependency_overrides[gtfs_module._user_id] = _raise_401
    try:
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get(
            "/api/gtfs/trip-updates",
            params={"stop_ids": "stp_A"},
            headers={"Authorization": "Bearer invalid-token"},
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
    finally:
        app.dependency_overrides.pop(gtfs_module._user_id, None)
