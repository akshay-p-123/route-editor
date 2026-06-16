"""Generate a realistic GTFS zip with actual UUID IDs and MTD-style stop IDs."""
import asyncio, sys, os, zipfile, io, csv
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.routers.gtfs import (
    _build_routes_df, _build_stops_df, _build_trips_df, _build_shapes_df,
    _build_stop_times_df, _build_calendar_dates_df, _build_feed_info_df,
    _build_agency_df, _write_feed,
)
import gtfs_kit, pandas as pd

SERVICE_ID = "mtd_route_editor_service"

# Realistic data: real UUID IDs, MTD-style stop IDs
saved_routes = [
    {
        "id": "550e8400-e29b-41d4-a716-446655440001",
        "name": "Route 1 Reroute",
        "short_name": "1",
        "color": "#009B77",
        "is_custom": False,
        "route_stops": [
            {"stop_sequence": 0, "stop_id": "IT:1:1", "stop_name": "Main & First", "stop_lat": 40.1100, "stop_lon": -88.2300},
            {"stop_sequence": 1, "stop_id": "IT:1:2", "stop_name": "Main & Second", "stop_lat": 40.1150, "stop_lon": -88.2280},
            {"stop_sequence": 2, "stop_id": "IT:1:3", "stop_name": "Main & Third", "stop_lat": 40.1200, "stop_lon": -88.2260},
            {"stop_sequence": 3, "stop_id": "IT:1:4", "stop_name": "Main & Fourth", "stop_lat": 40.1250, "stop_lon": -88.2240},
            {"stop_sequence": 4, "stop_id": "IT:1:5", "stop_name": "Main & Fifth", "stop_lat": 40.1300, "stop_lon": -88.2220},
        ],
    },
    {
        "id": "550e8400-e29b-41d4-a716-446655440002",
        "name": "Route 2 Reroute",
        "short_name": "22",
        "color": None,
        "is_custom": True,
        "route_stops": [
            {"stop_sequence": 0, "stop_id": "IT:1:1", "stop_name": "Main & First", "stop_lat": 40.1100, "stop_lon": -88.2300},
            {"stop_sequence": 1, "stop_id": None, "stop_name": "Custom Stop", "stop_lat": 40.1050, "stop_lon": -88.2350},
            {"stop_sequence": 2, "stop_id": "IT:2:1", "stop_name": "Elm & Oak", "stop_lat": 40.1000, "stop_lon": -88.2400},
            {"stop_sequence": 3, "stop_id": "IT:2:2", "stop_name": "Elm & Pine", "stop_lat": 40.0950, "stop_lon": -88.2450},
        ],
    },
]

async def main():
    routes_df = _build_routes_df(saved_routes)
    stops_df = _build_stops_df(saved_routes)
    calendar_df = _build_calendar_dates_df(SERVICE_ID)
    feed_info_df = _build_feed_info_df(calendar_df["date"].min(), calendar_df["date"].max())
    agency_df = _build_agency_df(None)
    trips_df = _build_trips_df(saved_routes, SERVICE_ID)

    all_stop_times, all_shapes = [], []
    for route in saved_routes:
        sorted_stops = sorted(route["route_stops"], key=lambda s: s["stop_sequence"])
        geometry_coords = [[s["stop_lon"], s["stop_lat"]] for s in sorted_stops]
        all_stop_times.append(_build_stop_times_df(route, []))
        all_shapes.append(_build_shapes_df(str(route["id"]), geometry_coords))

    feed = gtfs_kit.Feed(
        dist_units="km", agency=agency_df, routes=routes_df, trips=trips_df,
        stops=stops_df, stop_times=pd.concat(all_stop_times, ignore_index=True),
        shapes=pd.concat(all_shapes, ignore_index=True),
        calendar_dates=calendar_df, feed_info=feed_info_df,
    )
    zip_bytes = await _write_feed(feed)
    out = "/tmp/mtd-realistic.zip"
    with open(out, "wb") as f: f.write(zip_bytes)
    print(f"Written {len(zip_bytes)} bytes to {out}")

    # Inspect all files
    with zipfile.ZipFile(out) as z:
        for fname in z.namelist():
            rows = list(csv.DictReader(io.StringIO(z.read(fname).decode("utf-8-sig"))))
            print(f"\n=== {fname} ({len(rows)} rows) ===")
            for r in rows[:3]:
                print(dict(r))
            if len(rows) > 3: print(f"  ... +{len(rows)-3} more")

    # Cross-check FK constraints
    with zipfile.ZipFile(out) as z:
        stops = {r["stop_id"] for r in csv.DictReader(io.StringIO(z.read("stops.txt").decode()))}
        trips = {r["trip_id"] for r in csv.DictReader(io.StringIO(z.read("trips.txt").decode()))}
        routes = {r["route_id"] for r in csv.DictReader(io.StringIO(z.read("routes.txt").decode()))}
        shapes = {r["shape_id"] for r in csv.DictReader(io.StringIO(z.read("shapes.txt").decode()))}
        svc = {r["service_id"] for r in csv.DictReader(io.StringIO(z.read("calendar_dates.txt").decode()))}

        st = list(csv.DictReader(io.StringIO(z.read("stop_times.txt").decode())))
        tr = list(csv.DictReader(io.StringIO(z.read("trips.txt").decode())))

        print("\n=== FK CHECKS ===")
        bad = [r["stop_id"] for r in st if r["stop_id"] not in stops]
        print(f"stop_times.stop_id not in stops: {bad}")
        bad = [r["trip_id"] for r in st if r["trip_id"] not in trips]
        print(f"stop_times.trip_id not in trips: {bad}")
        bad = [r["route_id"] for r in tr if r["route_id"] not in routes]
        print(f"trips.route_id not in routes: {bad}")
        bad = [r["shape_id"] for r in tr if r["shape_id"] and r["shape_id"] not in shapes]
        print(f"trips.shape_id not in shapes: {bad}")
        bad = [r["service_id"] for r in tr if r["service_id"] not in svc]
        print(f"trips.service_id not in calendar_dates: {bad}")

asyncio.run(main())
