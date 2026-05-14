"""PNG export endpoint using the Mapbox Static Images API."""

import json
import urllib.parse
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
import httpx
from pydantic import BaseModel
from app.config import settings

router = APIRouter(prefix="/export", tags=["export"])

# Champaign-Urbana center
DEFAULT_CENTER = [-88.2272, 40.1164]
DEFAULT_ZOOM = 13


class StopPoint(BaseModel):
    lat: float
    lon: float
    stop_name: str
    is_added: bool = False
    is_removed: bool = False


class ExportRequest(BaseModel):
    original_stops: list[StopPoint]
    modified_stops: list[StopPoint]
    route_color: str = "#009B77"
    width: int = 1200
    height: int = 800


def _stops_to_geojson(stops: list[StopPoint], color: str, opacity: float) -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [s.lon, s.lat]},
                "properties": {"name": s.stop_name},
            }
            for s in stops
        ],
    }


def _line_geojson(stops: list[StopPoint], color: str) -> dict:
    return {
        "type": "Feature",
        "geometry": {
            "type": "LineString",
            "coordinates": [[s.lon, s.lat] for s in stops],
        },
        "properties": {"stroke": color, "stroke-width": 4},
    }


@router.post("/png")
async def export_png(body: ExportRequest):
    # Build simplified GeoJSON overlays encoded in the URL
    # Original route — faded
    orig_line = _line_geojson(body.original_stops, "#999999")
    # Modified route — bold with route color
    mod_line = _line_geojson(body.modified_stops, body.route_color)

    # Stop markers: green = added, red = removed, grey = unchanged
    added = [s for s in body.modified_stops if s.is_added]
    removed = [s for s in body.original_stops if s.is_removed]
    unchanged = [s for s in body.modified_stops if not s.is_added]

    def marker_layer(stops: list[StopPoint], color: str) -> str:
        fc = _stops_to_geojson(stops, color, 1.0)
        return f"geojson({urllib.parse.quote(json.dumps(fc))})"

    overlays = [
        f"geojson({urllib.parse.quote(json.dumps(orig_line))})",
        f"geojson({urllib.parse.quote(json.dumps(mod_line))})",
    ]
    if removed:
        overlays.append(marker_layer(removed, "#ef4444"))
    if unchanged:
        overlays.append(marker_layer(unchanged, "#6b7280"))
    if added:
        overlays.append(marker_layer(added, "#22c55e"))

    overlay_str = ",".join(overlays)
    url = (
        f"https://api.mapbox.com/styles/v1/mapbox/light-v11/static"
        f"/{overlay_str}"
        f"/auto/{body.width}x{body.height}"
        f"?access_token={settings.mapbox_token}&padding=60"
    )

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url)
        resp.raise_for_status()

    return StreamingResponse(
        iter([resp.content]),
        media_type="image/png",
        headers={"Content-Disposition": "attachment; filename=route-export.png"},
    )
