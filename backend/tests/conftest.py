"""Shared fixtures for GTFS export tests."""

import pytest
from unittest.mock import MagicMock

# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def sample_reroute():
    """A minimal reroute dict matching the Supabase reroutes table."""
    return {
        "id": "aaaaaaaa-0000-0000-0000-000000000001",
        "user_id": "bbbbbbbb-0000-0000-0000-000000000001",
        "name": "Test Reroute",
    }


@pytest.fixture
def sample_saved_routes():
    """Two saved routes that share a common stop (MTD_1001) and include an editor-added stop.

    Route 1: stops MTD_1001, MTD_1002
    Route 2: stops MTD_1001 (shared — dedup test), MTD_1003, and one editor-added stop (stop_id None)
    """
    route1_id = "cccccccc-0000-0000-0000-000000000001"
    route2_id = "cccccccc-0000-0000-0000-000000000002"
    return [
        {
            "id": route1_id,
            "name": "Route Green",
            "short_name": "GRN",
            "color": "#009B77",
            "is_custom": False,
            "route_stops": [
                {
                    "stop_sequence": 0,
                    "stop_id": "MTD_1001",
                    "stop_name": "Main & First",
                    "stop_lat": 40.1100,
                    "stop_lon": -88.2400,
                },
                {
                    "stop_sequence": 1,
                    "stop_id": "MTD_1002",
                    "stop_name": "Main & Second",
                    "stop_lat": 40.1110,
                    "stop_lon": -88.2410,
                },
            ],
        },
        {
            "id": route2_id,
            "name": "Route Blue",
            "short_name": "BLU",
            "color": None,  # exercises default color path
            "is_custom": True,
            "route_stops": [
                {
                    "stop_sequence": 0,
                    "stop_id": "MTD_1001",  # shared with Route 1 — dedup test
                    "stop_name": "Main & First",
                    "stop_lat": 40.1100,
                    "stop_lon": -88.2400,
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
                    "stop_id": None,  # editor-added stop — synthetic id test
                    "stop_name": "Custom Stop A",
                    "stop_lat": 40.1130,
                    "stop_lon": -88.2430,
                },
            ],
        },
    ]


@pytest.fixture
def mock_supabase(sample_reroute, sample_saved_routes):
    """A fake Supabase client whose chained query methods return fixture data.

    The export endpoint's _client() will be monkeypatched to return this.
    """
    client = MagicMock()

    def _from_side_effect(table_name):
        mock = MagicMock()
        if table_name == "reroutes":
            mock.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [sample_reroute]
        elif table_name == "saved_routes":
            mock.select.return_value.eq.return_value.execute.return_value.data = sample_saved_routes
        return mock

    client.from_.side_effect = _from_side_effect
    return client
