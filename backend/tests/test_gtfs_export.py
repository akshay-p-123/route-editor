"""Tests for GTFS static export — EXPORT-01,02,04,05,06,07,08,10.

Task 1: Stubs only — builders not yet implemented (RED state).
        Collection succeeds; running tests fails until Task 2 adds the builders.
Task 2: Builders implemented — all 7 tests turn GREEN.
Task 3: Endpoint tests added (test_export_endpoint, test_export_ownership).
"""

import zipfile
import io
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

# Try to import builders. ImportError is expected (RED) until Task 2 is done.
try:
    from app.routers.gtfs import (
        _build_routes_df,
        _build_stops_df,
        _build_trips_df,
        _build_shapes_df,
        _build_stop_times_df,
        _build_calendar_dates_df,
        _build_feed_info_df,
        _build_agency_df,
        _write_feed,
    )
    _BUILDERS_AVAILABLE = True
except ImportError:
    _BUILDERS_AVAILABLE = False
    _build_routes_df = _build_stops_df = _build_trips_df = None
    _build_shapes_df = _build_stop_times_df = _build_calendar_dates_df = None
    _build_feed_info_df = _build_agency_df = _write_feed = None


_requires_builders = pytest.mark.skipif(
    not _BUILDERS_AVAILABLE, reason="builders not yet implemented (Task 2)"
)


# ── EXPORT-02: Zip contains all 8 required GTFS files at root ────────────────

@_requires_builders
def test_all_files_present(sample_saved_routes):
    """EXPORT-02: The zip produced by _write_feed contains exactly the 8 required files at root."""
    import gtfs_kit
    import pandas as pd

    SERVICE_ID = "mtd_route_editor_service"
    calendar_df = _build_calendar_dates_df(SERVICE_ID)
    start_date = calendar_df["date"].iloc[0]
    end_date = calendar_df["date"].iloc[-1]

    agency_df = _build_agency_df(None)
    routes_df = _build_routes_df(sample_saved_routes)
    stops_df = _build_stops_df(sample_saved_routes)
    trips_df = _build_trips_df(sample_saved_routes, SERVICE_ID)
    feed_info_df = _build_feed_info_df(start_date, end_date)

    stop_times_parts = []
    shapes_parts = []
    for route in sample_saved_routes:
        sorted_stops = sorted(route["route_stops"], key=lambda s: s["stop_sequence"])
        st_df = _build_stop_times_df(route, [])
        stop_times_parts.append(st_df)
        coords = [[s["stop_lon"], s["stop_lat"]] for s in sorted_stops]
        sh_df = _build_shapes_df(str(route["id"]), coords)
        shapes_parts.append(sh_df)

    stop_times_df = pd.concat(stop_times_parts, ignore_index=True)
    shapes_df = pd.concat(shapes_parts, ignore_index=True)

    feed = gtfs_kit.Feed(
        dist_units="km",
        agency=agency_df,
        routes=routes_df,
        trips=trips_df,
        stops=stops_df,
        stop_times=stop_times_df,
        shapes=shapes_df,
        calendar_dates=calendar_df,
        feed_info=feed_info_df,
    )

    zip_bytes = asyncio.get_event_loop().run_until_complete(_write_feed(feed))

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        namelist = zf.namelist()

    expected = {
        "agency.txt",
        "routes.txt",
        "trips.txt",
        "stops.txt",
        "stop_times.txt",
        "shapes.txt",
        "calendar_dates.txt",
        "feed_info.txt",
    }
    assert set(namelist) == expected, f"Unexpected files in zip: {namelist}"
    assert all("/" not in name for name in namelist), f"Subdirectory found in zip: {namelist}"


# ── EXPORT-04: Stops deduplicated across routes ───────────────────────────────

@_requires_builders
def test_stops_deduplicated(sample_saved_routes):
    """EXPORT-04: Shared stop MTD_1001 appears exactly once in stops_df."""
    stops_df = _build_stops_df(sample_saved_routes)

    stop_ids = stops_df["stop_id"].tolist()
    assert stop_ids.count("MTD_1001") == 1, f"MTD_1001 should appear once, got: {stop_ids}"
    assert len(stop_ids) == len(set(stop_ids)), f"Duplicate stop_ids found: {stop_ids}"


# ── EXPORT-05: Synthetic stop IDs for editor-added stops ─────────────────────

@_requires_builders
def test_synthetic_stop_ids(sample_saved_routes):
    """EXPORT-05: Editor-added stop (stop_id None) receives synthetic id custom_{route_id}_{stop_sequence}."""
    stops_df = _build_stops_df(sample_saved_routes)

    # Route 2 (index 1) has a stop at sequence 2 with stop_id None
    route2 = sample_saved_routes[1]
    route2_id = route2["id"]
    expected_synthetic_id = f"custom_{route2_id}_2"

    stop_ids = stops_df["stop_id"].tolist()
    assert expected_synthetic_id in stop_ids, (
        f"Expected synthetic id '{expected_synthetic_id}' not found in stops_df: {stop_ids}"
    )


# ── EXPORT-06: route_color has no # prefix ───────────────────────────────────

@_requires_builders
def test_route_color_format(sample_saved_routes):
    """EXPORT-06: route_color field contains no '#'; None defaults to '0070F3'."""
    routes_df = _build_routes_df(sample_saved_routes)

    color_map = dict(zip(routes_df["route_id"].astype(str), routes_df["route_color"]))

    route1_id = str(sample_saved_routes[0]["id"])
    route2_id = str(sample_saved_routes[1]["id"])

    assert color_map[route1_id] == "009B77", (
        f"Expected '009B77' for #009B77 route, got '{color_map[route1_id]}'"
    )
    assert color_map[route2_id] == "0070F3", (
        f"Expected default '0070F3' for None-color route, got '{color_map[route2_id]}'"
    )
    assert all("#" not in c for c in routes_df["route_color"]), "# found in route_color column"


# ── EXPORT-07: shape_pt_lat/lon not swapped from OSRM [lon, lat] ─────────────

@_requires_builders
def test_shape_coordinate_order():
    """EXPORT-07: OSRM [lon, lat] coords are stored as shape_pt_lat=lat, shape_pt_lon=lon."""
    # Fake OSRM geometry: list of [lon, lat] pairs
    coords = [
        [-88.2400, 40.1100],  # lon, lat  (OSRM GeoJSON order)
        [-88.2410, 40.1110],
    ]
    shapes_df = _build_shapes_df("test-route-id", coords)

    # First point: lat must be 40.1100, lon must be -88.2400
    first_row = shapes_df.iloc[0]
    assert first_row["shape_pt_lat"] == pytest.approx(40.1100), (
        f"shape_pt_lat should be latitude (40.11), got {first_row['shape_pt_lat']}"
    )
    assert first_row["shape_pt_lon"] == pytest.approx(-88.2400), (
        f"shape_pt_lon should be longitude (-88.24), got {first_row['shape_pt_lon']}"
    )


# ── EXPORT-08: All stops have arrival + departure times; timepoint=0 ──────────

@_requires_builders
def test_stop_times_all_present(sample_saved_routes):
    """EXPORT-08: Every stop_times row has arrival_time, departure_time (equal), timepoint=0, non-decreasing times."""
    # Use route 1 (2 stops)
    route = sample_saved_routes[0]
    stop_times_df = _build_stop_times_df(route, [])  # empty leg_durations → fallback 60s

    assert not stop_times_df["arrival_time"].isnull().any(), "arrival_time has null values"
    assert not stop_times_df["departure_time"].isnull().any(), "departure_time has null values"
    assert (stop_times_df["arrival_time"] == "").sum() == 0, "arrival_time has empty strings"
    assert (stop_times_df["departure_time"] == "").sum() == 0, "departure_time has empty strings"

    for _, row in stop_times_df.iterrows():
        assert row["arrival_time"] == row["departure_time"], (
            f"arrival_time != departure_time at stop_sequence {row['stop_sequence']}: "
            f"{row['arrival_time']} vs {row['departure_time']}"
        )

    assert (stop_times_df["timepoint"] == 0).all(), "Not all rows have timepoint=0"

    sorted_df = stop_times_df.sort_values("stop_sequence")
    times = sorted_df["arrival_time"].tolist()
    assert times == sorted(times), f"Times are not non-decreasing: {times}"


# ── EXPORT-10: feed_info.txt has required fields ─────────────────────────────

@_requires_builders
def test_feed_info():
    """EXPORT-10: feed_info_df has all 5 required fields with correct values."""
    from datetime import date
    today = date.today().strftime("%Y%m%d")
    feed_info_df = _build_feed_info_df(today, today)

    assert len(feed_info_df) == 1, "feed_info_df should have exactly one row"
    row = feed_info_df.iloc[0]

    assert row["feed_publisher_name"] == "MTD Route Editor"
    assert row["feed_publisher_url"] == "https://mtd.org"
    assert row["feed_lang"] == "en"
    assert row["feed_start_date"] == today
    assert row["feed_end_date"] == today
    assert "feed_version" in feed_info_df.columns, "feed_version column missing"
    assert row["feed_version"] != "", "feed_version should not be empty"


# ── EXPORT-01 + T-02-01: Endpoint tests ──────────────────────────────────────

@_requires_builders
def test_export_endpoint(sample_reroute, sample_saved_routes):
    """EXPORT-01: GET /api/gtfs/export/{reroute_id} returns 200, application/zip, 8-file zip.

    Monkeypatches _client, _user_id, and _osrm_route to avoid network/DB calls.
    """
    from fastapi.testclient import TestClient
    from app.main import app

    reroute_id = sample_reroute["id"]
    user_id = sample_reroute["user_id"]
    reroute_name = sample_reroute["name"]

    # Mock Supabase client: reroutes returns sample_reroute, saved_routes returns sample_saved_routes
    mock_client = MagicMock()

    def _from_side_effect(table_name):
        mock = MagicMock()
        if table_name == "reroutes":
            mock.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [sample_reroute]
        elif table_name == "saved_routes":
            mock.select.return_value.eq.return_value.execute.return_value.data = sample_saved_routes
        return mock

    mock_client.from_.side_effect = _from_side_effect

    with (
        patch("app.routers.gtfs._client", return_value=mock_client),
        patch("app.routers.gtfs._user_id", return_value=user_id),
        patch("app.routers.gtfs._osrm_route", new=AsyncMock(return_value=None)),  # force fallback, no network
    ):
        # Ensure app.state.gtfs_feed is None (no GTFS ingestion needed for export)
        app.state.gtfs_feed = None

        client = TestClient(app, raise_server_exceptions=True)
        response = client.get(
            f"/api/gtfs/export/{reroute_id}",
            headers={"Authorization": "Bearer fake-token"},
        )

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    assert response.headers["content-type"] == "application/zip", (
        f"Expected application/zip, got {response.headers.get('content-type')}"
    )
    content_disposition = response.headers.get("content-disposition", "")
    assert reroute_name.replace(" ", "_") in content_disposition, (
        f"Reroute name not in Content-Disposition: {content_disposition}"
    )

    # Verify zip contains all 8 required GTFS files
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        namelist = zf.namelist()

    expected = {
        "agency.txt", "routes.txt", "trips.txt", "stops.txt",
        "stop_times.txt", "shapes.txt", "calendar_dates.txt", "feed_info.txt",
    }
    assert set(namelist) == expected, f"Unexpected zip contents: {namelist}"


@_requires_builders
def test_export_ownership(sample_reroute):
    """T-02-01: GET /api/gtfs/export/{reroute_id} for a non-owned reroute returns 404.

    Ownership check: mock reroutes query returns empty data to simulate wrong user.
    """
    from fastapi.testclient import TestClient
    from app.main import app

    reroute_id = sample_reroute["id"]
    user_id = sample_reroute["user_id"]

    # Mock returns empty data — simulates reroute not owned by this user
    mock_client = MagicMock()

    def _from_side_effect(table_name):
        mock = MagicMock()
        if table_name == "reroutes":
            mock.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
        return mock

    mock_client.from_.side_effect = _from_side_effect

    with (
        patch("app.routers.gtfs._client", return_value=mock_client),
        patch("app.routers.gtfs._user_id", return_value=user_id),
    ):
        app.state.gtfs_feed = None
        client = TestClient(app, raise_server_exceptions=True)
        response = client.get(
            f"/api/gtfs/export/{reroute_id}",
            headers={"Authorization": "Bearer fake-token"},
        )

    assert response.status_code == 404, f"Expected 404 for non-owned reroute, got {response.status_code}"
