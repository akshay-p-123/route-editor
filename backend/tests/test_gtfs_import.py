"""Tests for GTFS zip import — TRIPMOD-01 (folded GTFS-import todo).

POST /api/gtfs/import accepts a multipart GTFS zip upload, parses it with
gtfs_kit.read_feed() off the event loop, and creates a reroutes record plus
one saved_routes row (with route_stops) per route in the feed.
"""

import io
import zipfile

import pandas as pd
import pytest
from unittest.mock import MagicMock, patch


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def fake_feed():
    """A minimal fabricated gtfs_kit-like Feed object with two routes.

    Route R1 has a representative trip T1 with stops S1 (canonical) -> S2 (canonical).
    Route R2 has a representative trip T2 with a single stop that has no usable
    stop_id in feed.stops (exercises the synthetic-id fallback).
    """
    feed = MagicMock()

    feed.routes = pd.DataFrame([
        {"route_id": "R1", "route_long_name": "Route One", "route_short_name": "R1", "route_color": "FF0000"},
        {"route_id": "R2", "route_long_name": "Route Two", "route_short_name": "R2", "route_color": None},
    ])

    feed.trips = pd.DataFrame([
        {"trip_id": "T1", "route_id": "R1"},
        {"trip_id": "T2", "route_id": "R2"},
    ])

    feed.stop_times = pd.DataFrame([
        {"trip_id": "T1", "stop_id": "S1", "stop_sequence": 0},
        {"trip_id": "T1", "stop_id": "S2", "stop_sequence": 1},
        {"trip_id": "T2", "stop_id": "S3", "stop_sequence": 0},
    ])

    feed.stops = pd.DataFrame([
        {"stop_id": "S1", "stop_name": "First & Main", "stop_lat": 40.10, "stop_lon": -88.20},
        {"stop_id": "S2", "stop_name": "Second & Main", "stop_lat": 40.11, "stop_lon": -88.21},
        # Note: S3 intentionally absent from feed.stops to exercise synthetic fallback
    ])

    return feed


@pytest.fixture
def mock_supabase_import():
    """A fake Supabase client that records inserts for reroutes/saved_routes/route_stops."""
    client = MagicMock()
    inserted = {"reroutes": [], "saved_routes": [], "route_stops": []}

    route_counter = {"n": 0}

    def _from_side_effect(table_name):
        mock = MagicMock()

        if table_name == "reroutes":
            def _insert(data):
                inserted["reroutes"].append(data)
                m = MagicMock()
                m.execute.return_value.data = [{"id": "reroute-id-1"}]
                return m
            mock.insert.side_effect = _insert

        elif table_name == "saved_routes":
            def _insert(data):
                inserted["saved_routes"].append(data)
                route_counter["n"] += 1
                route_id = f"saved-route-id-{route_counter['n']}"
                m = MagicMock()
                m.execute.return_value.data = [{"id": route_id}]
                return m
            mock.insert.side_effect = _insert

        elif table_name == "route_stops":
            def _insert(data):
                inserted["route_stops"].append(data)
                m = MagicMock()
                m.execute.return_value.data = data
                return m
            mock.insert.side_effect = _insert

        return mock

    client.from_.side_effect = _from_side_effect
    client._inserted = inserted
    return client


def _make_zip_upload_file() -> bytes:
    """Build a minimal in-memory zip's bytes (content doesn't matter — read_feed is patched)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("agency.txt", "agency_id,agency_name\n1,Test Agency\n")
    return buf.getvalue()


# ── Tests ────────────────────────────────────────────────────────────────────

def test_import_creates_reroute(fake_feed, mock_supabase_import):
    """A valid (mocked/parsed) GTFS feed produces one reroutes insert and, per route,
    one saved_routes insert + a route_stops insert. The reroute name derives from
    the uploaded filename."""
    from fastapi.testclient import TestClient
    from app.main import app
    from app.routers import gtfs as gtfs_module

    zip_bytes = _make_zip_upload_file()

    app.dependency_overrides[gtfs_module._user_id] = lambda: "user-123"
    try:
        with (
            patch("app.routers.gtfs._client", return_value=mock_supabase_import),
            patch("app.routers.gtfs.gtfs_kit.read_feed", return_value=fake_feed),
        ):
            client = TestClient(app, raise_server_exceptions=True)
            response = client.post(
                "/api/gtfs/import",
                files={"file": ("My Feed.zip", zip_bytes, "application/zip")},
                headers={"Authorization": "Bearer fake-token"},
            )
    finally:
        app.dependency_overrides.pop(gtfs_module._user_id, None)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["reroute_id"] == "reroute-id-1"
    assert body["route_count"] == 2

    # One reroutes insert
    assert len(mock_supabase_import._inserted["reroutes"]) == 1
    reroute_data = mock_supabase_import._inserted["reroutes"][0]
    assert reroute_data["name"] == "My_Feed_zip"
    assert reroute_data["user_id"] == "user-123"

    # One saved_routes insert per route
    assert len(mock_supabase_import._inserted["saved_routes"]) == 2

    # One route_stops insert (batch) per route
    assert len(mock_supabase_import._inserted["route_stops"]) == 2


def test_import_invalid_zip_422(mock_supabase_import):
    """When gtfs_kit.read_feed raises, the endpoint returns HTTP 422 with a clear detail."""
    from fastapi.testclient import TestClient
    from app.main import app
    from app.routers import gtfs as gtfs_module

    zip_bytes = b"not a real zip"

    app.dependency_overrides[gtfs_module._user_id] = lambda: "user-123"
    try:
        with (
            patch("app.routers.gtfs._client", return_value=mock_supabase_import),
            patch("app.routers.gtfs.gtfs_kit.read_feed", side_effect=ValueError("bad zip")),
        ):
            client = TestClient(app, raise_server_exceptions=True)
            response = client.post(
                "/api/gtfs/import",
                files={"file": ("bad.zip", zip_bytes, "application/zip")},
                headers={"Authorization": "Bearer fake-token"},
            )
    finally:
        app.dependency_overrides.pop(gtfs_module._user_id, None)

    assert response.status_code == 422, response.text
    assert "Invalid GTFS zip" in response.json()["detail"]


def test_import_synthetic_stop_id(fake_feed, mock_supabase_import):
    """A stop row lacking a usable stop_id in feed.stops is inserted with a
    synthetic stop_id custom_{route_id}_{stop_sequence}."""
    from fastapi.testclient import TestClient
    from app.main import app
    from app.routers import gtfs as gtfs_module

    zip_bytes = _make_zip_upload_file()

    app.dependency_overrides[gtfs_module._user_id] = lambda: "user-123"
    try:
        with (
            patch("app.routers.gtfs._client", return_value=mock_supabase_import),
            patch("app.routers.gtfs.gtfs_kit.read_feed", return_value=fake_feed),
        ):
            client = TestClient(app, raise_server_exceptions=True)
            response = client.post(
                "/api/gtfs/import",
                files={"file": ("My Feed.zip", zip_bytes, "application/zip")},
                headers={"Authorization": "Bearer fake-token"},
            )
    finally:
        app.dependency_overrides.pop(gtfs_module._user_id, None)

    assert response.status_code == 200, response.text

    # Route 2 (saved-route-id-2) has stop S3 which is absent from feed.stops —
    # expect synthetic id custom_saved-route-id-2_0
    all_stop_rows = [row for batch in mock_supabase_import._inserted["route_stops"] for row in batch]
    synthetic_ids = [r["stop_id"] for r in all_stop_rows if r["stop_id"] and r["stop_id"].startswith("custom_")]
    assert any(sid == "custom_saved-route-id-2_0" for sid in synthetic_ids), (
        f"Expected synthetic id 'custom_saved-route-id-2_0' in: {synthetic_ids}"
    )


def test_import_too_large_413(mock_supabase_import):
    """An upload larger than 50_000_000 bytes returns HTTP 413."""
    from fastapi.testclient import TestClient
    from app.main import app
    from app.routers import gtfs as gtfs_module

    # Build a payload > 50MB
    big_bytes = b"x" * (50_000_001)

    app.dependency_overrides[gtfs_module._user_id] = lambda: "user-123"
    try:
        with patch("app.routers.gtfs._client", return_value=mock_supabase_import):
            client = TestClient(app, raise_server_exceptions=True)
            response = client.post(
                "/api/gtfs/import",
                files={"file": ("big.zip", big_bytes, "application/zip")},
                headers={"Authorization": "Bearer fake-token"},
            )
    finally:
        app.dependency_overrides.pop(gtfs_module._user_id, None)

    assert response.status_code == 413, response.text
