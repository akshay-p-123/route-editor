"""Tests for the EST-02 travel-time estimation endpoint.

Task 1: Stubs only — estimate_travel_time / _diff_stop_sequences / _EstimateTravelTimeRequest
        not yet implemented (RED state via skip-guard). Collection succeeds; running tests
        skips until Task 2 adds the implementation.
Task 2: Endpoint, diff helper, and Pydantic models implemented — all tests GREEN.

Quick fix 260611-6kt: osrm_delta is now computed per-stop (proposed cumulative vs the
SAME stop's cumulative on the original route), not against a single grand-total scalar.
`_osrm_route` is mocked as a single AsyncMock, so both the proposed and original calls
return the SAME legs object — meaning cumulative[i] == baseline_cumulative[i] whenever
proposed and original sequences align at index i, which yields zero deltas for
identical-route tests under the corrected formula.
"""

import pytest
from unittest.mock import AsyncMock, patch

# Try to import the EST-02 implementation. ImportError is expected (RED) until Task 2 is done.
try:
    from app.routers.gtfs import (
        _diff_stop_sequences,
        _EstimateTravelTimeRequest,
        estimate_travel_time,
    )
    _IMPL_AVAILABLE = True
except ImportError:
    _IMPL_AVAILABLE = False
    _diff_stop_sequences = _EstimateTravelTimeRequest = estimate_travel_time = None

import app.routers.gtfs as gtfs_module

_requires_impl = pytest.mark.skipif(
    not _IMPL_AVAILABLE,
    reason="estimate_travel_time not yet implemented",
)


# ── Fixtures / helpers ───────────────────────────────────────────────────────

def _route1_stops(sample_saved_routes):
    """route1 route_stops: MTD_1001, MTD_1002 (both real stop_ids)."""
    return sample_saved_routes[0]["route_stops"]


def _route2_stops(sample_saved_routes):
    """route2 route_stops: MTD_1001 (shared), MTD_1003, and one editor-added (stop_id None)."""
    return sample_saved_routes[1]["route_stops"]


# ── Tests ─────────────────────────────────────────────────────────────────────

@_requires_impl
async def test_returns_estimate_per_stop(sample_saved_routes):
    """Result has one entry per proposed stop, ordered by stop_sequence."""
    proposed = _route1_stops(sample_saved_routes)
    body = _EstimateTravelTimeRequest(original_stops=proposed, proposed_stops=proposed)

    osrm_result = {"legs": [{"duration": 60.0}, {"duration": 90.0}]}

    with patch.object(gtfs_module, "_osrm_route", new=AsyncMock(return_value=osrm_result)), \
         patch.object(gtfs_module, "_get_delays_for_stops", new=AsyncMock(return_value={})):
        result = await estimate_travel_time(body, user_id="user-test-id")

    assert len(result) == len(proposed)
    seqs = [r.stop_sequence for r in result]
    assert seqs == sorted(seqs)


@_requires_impl
async def test_existing_stop_gets_delay(sample_saved_routes):
    """Proposed stop also present in original gets upstream_delay_seconds from MTD.

    Routes are identical and `_osrm_route` is a single mock returning the same legs
    for both the proposed and original calls, so osrm_delta == 0 for MTD_1001 under
    the per-stop formula. basis is "osrm+delay" (0 osrm delta + nonzero upstream delay).
    """
    original = _route1_stops(sample_saved_routes)
    proposed = _route1_stops(sample_saved_routes)
    body = _EstimateTravelTimeRequest(original_stops=original, proposed_stops=proposed)

    osrm_result = {"legs": [{"duration": 60.0}]}

    with patch.object(gtfs_module, "_osrm_route", new=AsyncMock(return_value=osrm_result)), \
         patch.object(gtfs_module, "_get_delays_for_stops", new=AsyncMock(return_value={"MTD_1001": 240})):
        result = await estimate_travel_time(body, user_id="user-test-id")

    mtd_1001_estimate = next(r for r in result if r.stop_id == "MTD_1001")
    assert mtd_1001_estimate.upstream_delay_seconds == 240
    assert mtd_1001_estimate.osrm_delta_seconds == 0
    assert "delay" in mtd_1001_estimate.basis


@_requires_impl
async def test_new_stop_gets_osrm_delta(sample_saved_routes):
    """A proposed stop_id not in the original gets osrm_delta_seconds propagated from
    the nearest preceding "existing" stop's per-stop osrm_delta.

    MTD_1003 (idx1, "new") propagates from MTD_1001 (idx0, "existing"), whose
    osrm_delta is 0 (both index-0 stops are MTD_1001, cumulative starts at 0
    for both proposed and baseline).
    """
    original = _route1_stops(sample_saved_routes)  # MTD_1001, MTD_1002
    proposed = _route2_stops(sample_saved_routes)  # MTD_1001, MTD_1003, custom (stop_id None)
    body = _EstimateTravelTimeRequest(original_stops=original, proposed_stops=proposed)

    osrm_result = {"legs": [{"duration": 300.0}, {"duration": 400.0}]}

    with patch.object(gtfs_module, "_osrm_route", new=AsyncMock(return_value=osrm_result)), \
         patch.object(gtfs_module, "_get_delays_for_stops", new=AsyncMock(return_value={})):
        result = await estimate_travel_time(body, user_id="user-test-id")

    mtd_1001_estimate = next(r for r in result if r.stop_id == "MTD_1001")
    mtd_1003_estimate = next(r for r in result if r.stop_id == "MTD_1003")
    assert mtd_1003_estimate.osrm_delta_seconds is not None
    assert mtd_1003_estimate.osrm_delta_seconds == mtd_1001_estimate.osrm_delta_seconds
    assert "osrm" in mtd_1003_estimate.basis


@_requires_impl
async def test_osrm_failure_fallback(sample_saved_routes):
    """OSRM total failure falls back to 60s/stop without raising; endpoint still returns a result.

    Both the proposed and (identical) original sequences accumulate the same
    FALLBACK_LEG_SECONDS-per-leg estimate, so stop 1's per-stop delta is 0 but not
    None — proposed_is_fallback and baseline_is_fallback are both True, so basis
    is "fallback" rather than "osrm".
    """
    proposed = _route1_stops(sample_saved_routes)
    body = _EstimateTravelTimeRequest(original_stops=proposed, proposed_stops=proposed)

    with patch.object(gtfs_module, "_osrm_route", new=AsyncMock(return_value=None)), \
         patch.object(gtfs_module, "_get_delays_for_stops", new=AsyncMock(return_value={})):
        result = await estimate_travel_time(body, user_id="user-test-id")

    assert len(result) == len(proposed)
    # Stop 0 has no leg data yet when OSRM is unavailable — no fallback delta.
    assert result[0].osrm_delta_seconds is None
    assert result[0].basis == "none"
    # Stop 1 accumulated the 60s/leg fallback into `cumulative` and `baseline_cumulative`
    # identically, so the per-stop delta is 0 but basis reflects the fallback path.
    assert result[1].osrm_delta_seconds == 0
    assert result[1].basis == "fallback"


@_requires_impl
async def test_all_new_stops_no_original(sample_saved_routes):
    """Fully custom route (empty original_stops) returns OSRM-only estimates without error.

    With original_stops empty, baseline_cumulative == [] and every proposed stop is
    classified "new". No "existing" stop is ever seen, so last_osrm_delta stays None
    and every osrm_delta_seconds is None (basis "none").
    """
    proposed = _route1_stops(sample_saved_routes)
    body = _EstimateTravelTimeRequest(original_stops=[], proposed_stops=proposed)

    osrm_result = {"legs": [{"duration": 60.0}]}

    with patch.object(gtfs_module, "_osrm_route", new=AsyncMock(return_value=osrm_result)), \
         patch.object(gtfs_module, "_get_delays_for_stops", new=AsyncMock(return_value={})) as mock_delays:
        result = await estimate_travel_time(body, user_id="user-test-id")

    assert len(result) == len(proposed)
    for r in result:
        assert r.upstream_delay_seconds is None
        assert r.osrm_delta_seconds is None
        assert r.basis == "none"


@_requires_impl
async def test_synthetic_ids_excluded_from_delay(sample_saved_routes):
    """Synthetic custom_* stop_ids present in both original and proposed are never sent to MTD."""
    original = _route1_stops(sample_saved_routes) + [
        {
            "stop_sequence": 2,
            "stop_id": "custom_5_2",
            "stop_name": "Custom Stop A",
            "stop_lat": 40.1130,
            "stop_lon": -88.2430,
        },
    ]
    proposed = original
    body = _EstimateTravelTimeRequest(original_stops=original, proposed_stops=proposed)

    osrm_result = {"legs": [{"duration": 60.0}, {"duration": 90.0}]}

    with patch.object(gtfs_module, "_osrm_route", new=AsyncMock(return_value=osrm_result)), \
         patch.object(gtfs_module, "_get_delays_for_stops", new=AsyncMock(return_value={})) as mock_delays:
        await estimate_travel_time(body, user_id="user-test-id")

    assert mock_delays.called
    called_ids = mock_delays.call_args[0][0]
    assert "custom_5_2" not in called_ids


@_requires_impl
async def test_no_edits_zero_delta(sample_saved_routes):
    """No edits (proposed == original) yields zero delta at every stop.

    With identical sequences and a single AsyncMock returning the same legs for
    both the proposed and original OSRM calls, cumulative[i] == baseline_cumulative[i]
    for every index — so osrm_delta_seconds == 0 and estimated_arrival_delta_seconds == 0
    everywhere.
    """
    proposed = _route1_stops(sample_saved_routes)
    original = _route1_stops(sample_saved_routes)
    body = _EstimateTravelTimeRequest(original_stops=original, proposed_stops=proposed)

    osrm_result = {"legs": [{"duration": 60.0}]}

    with patch.object(gtfs_module, "_osrm_route", new=AsyncMock(return_value=osrm_result)), \
         patch.object(gtfs_module, "_get_delays_for_stops", new=AsyncMock(return_value={})):
        result = await estimate_travel_time(body, user_id="user-test-id")

    assert len(result) == len(proposed)
    for r in result:
        assert r.osrm_delta_seconds == 0
        assert r.estimated_arrival_delta_seconds == 0


@_requires_impl
async def test_new_stop_propagates_preceding_delta(sample_saved_routes):
    """A "new" stop's osrm_delta equals the nearest preceding "existing" stop's osrm_delta.

    original = route1 (MTD_1001 idx0, MTD_1002 idx1).
    proposed = MTD_1002 (idx0, existing), MTD_1003 (idx1, new), MTD_1001 (idx2, existing).

    With legs [100.0, 50.0] (single mock for both calls):
    - baseline_cumulative (original) = [0, 100]
    - proposed cumulative = [0, 100, 150]
    - idx0 MTD_1002 (existing, j=1): osrm_delta = cumulative[0] - baseline_cumulative[1]
      = 0 - 100 = -100
    - idx1 MTD_1003 (new): propagates idx0's delta = -100
    - idx2 MTD_1001 (existing, j=0): osrm_delta = cumulative[2] - baseline_cumulative[0]
      = 150 - 0 = 150
    """
    original = _route1_stops(sample_saved_routes)  # MTD_1001 (seq0), MTD_1002 (seq1)
    proposed = [
        {
            "stop_sequence": 0,
            "stop_id": "MTD_1002",
            "stop_name": "Main & Second",
            "stop_lat": 40.1110,
            "stop_lon": -88.2410,
        },
        {
            "stop_sequence": 1,
            "stop_id": "MTD_1003",
            "stop_name": "University & Wright",
            "stop_lat": 40.1120,
            "stop_lon": -88.2420,
        },
        {
            "stop_sequence": 2,
            "stop_id": "MTD_1001",
            "stop_name": "Main & First",
            "stop_lat": 40.1100,
            "stop_lon": -88.2400,
        },
    ]
    body = _EstimateTravelTimeRequest(original_stops=original, proposed_stops=proposed)

    osrm_result = {"legs": [{"duration": 100.0}, {"duration": 50.0}]}

    with patch.object(gtfs_module, "_osrm_route", new=AsyncMock(return_value=osrm_result)), \
         patch.object(gtfs_module, "_get_delays_for_stops", new=AsyncMock(return_value={})):
        result = await estimate_travel_time(body, user_id="user-test-id")

    mtd_1002_estimate = next(r for r in result if r.stop_id == "MTD_1002")
    mtd_1003_estimate = next(r for r in result if r.stop_id == "MTD_1003")
    assert mtd_1002_estimate.osrm_delta_seconds == -100
    assert mtd_1003_estimate.osrm_delta_seconds == mtd_1002_estimate.osrm_delta_seconds


# ── _diff_stop_sequences unit test ───────────────────────────────────────────

@_requires_impl
def test_diff_stop_sequences_classification(sample_saved_routes):
    """_diff_stop_sequences classifies each proposed stop as 'existing' or 'new'."""
    original = _route1_stops(sample_saved_routes)  # MTD_1001, MTD_1002
    proposed = _route2_stops(sample_saved_routes)  # MTD_1001, MTD_1003, None (editor-added)

    classifications = _diff_stop_sequences(original, proposed)

    assert len(classifications) == len(proposed)
    assert classifications[0] == "existing"  # MTD_1001 in original
    assert classifications[1] == "new"  # MTD_1003 not in original


# ── TestClient 200 test ──────────────────────────────────────────────────────

@_requires_impl
def test_estimate_endpoint_returns_200(sample_saved_routes):
    """POST /api/gtfs/estimate-travel-time returns 200 with auth override."""
    from fastapi.testclient import TestClient
    from app.main import app

    proposed = _route1_stops(sample_saved_routes)
    payload = {
        "original_stops": proposed,
        "proposed_stops": proposed,
    }

    osrm_result = {"legs": [{"duration": 60.0}]}

    app.dependency_overrides[gtfs_module._user_id] = lambda: "user-test-id"
    try:
        with patch.object(gtfs_module, "_osrm_route", new=AsyncMock(return_value=osrm_result)), \
             patch.object(gtfs_module, "_get_delays_for_stops", new=AsyncMock(return_value={})):
            client = TestClient(app, raise_server_exceptions=True)
            response = client.post(
                "/api/gtfs/estimate-travel-time",
                json=payload,
                headers={"Authorization": "Bearer fake-token"},
            )
    finally:
        app.dependency_overrides.pop(gtfs_module._user_id, None)

    assert response.status_code == 200
    body = response.json()
    assert len(body) == len(proposed)
