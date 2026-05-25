"""PNG export via staticmaps + Pillow."""

import asyncio
import io
import logging
import os
import tempfile
from typing import Optional, Tuple

import requests
import s2sphere
import staticmaps
from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel

_TILE_CACHE_DIR = os.path.join(tempfile.gettempdir(), "route-editor-tiles")
os.makedirs(_TILE_CACHE_DIR, exist_ok=True)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/export", tags=["export"])

class _RetinaProvider(staticmaps.TileProvider):
    @staticmethod
    def tile_size() -> int:
        return 512


_CARTO_POSITRON = _RetinaProvider(
    name="carto-positron-2x",
    url_pattern="https://$s.basemaps.cartocdn.com/light_all/$z/$x/$y@2x.png",
    shards=["a", "b", "c", "d"],
    attribution="© OpenStreetMap contributors © CARTO",
    max_zoom=19,
)


class PixelCircle(staticmaps.Object):
    """Fixed screen-space circle marker (radius in pixels, not km)."""

    def __init__(
        self,
        latlng: s2sphere.LatLng,
        fill_color: staticmaps.Color,
        stroke_color: staticmaps.Color,
        radius: int = 7,
    ) -> None:
        super().__init__()
        self._latlng = latlng
        self._fill = fill_color
        self._stroke = stroke_color
        self._radius = radius

    def bounds(self) -> s2sphere.LatLngRect:
        return s2sphere.LatLngRect.from_point(self._latlng)

    def extra_pixel_bounds(self) -> Tuple[int, int, int, int]:
        r = self._radius + 2
        return (r, r, r, r)

    def render_pillow(self, renderer: staticmaps.PillowRenderer) -> None:
        x, y = renderer.transformer().ll2pixel(self._latlng)
        x, y = int(x), int(y)
        r = self._radius
        renderer.draw().ellipse(
            [x - r, y - r, x + r, y + r],
            fill=self._fill.int_rgba(),
            outline=self._stroke.int_rgba(),
            width=2,
        )

    def render_svg(self, _) -> None:
        pass

    def render_cairo(self, _) -> None:
        pass


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
    width: int = 2400
    height: int = 1600


_MAX_OSRM_WAYPOINTS = 12


def _sample_stops(stops: list[StopPoint], max_points: int) -> list[StopPoint]:
    """Return up to max_points evenly-spaced stops, always keeping first and last."""
    if len(stops) <= max_points:
        return stops
    indices = [round(i * (len(stops) - 1) / (max_points - 1)) for i in range(max_points)]
    return [stops[i] for i in indices]


def _osrm_coords(stops: list[StopPoint]) -> Optional[list[s2sphere.LatLng]]:
    coord_str = ";".join(f"{s.lon},{s.lat}" for s in _sample_stops(stops, _MAX_OSRM_WAYPOINTS))
    try:
        resp = requests.get(
            f"https://router.project-osrm.org/route/v1/driving/{coord_str}",
            params={"overview": "full", "geometries": "geojson"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != "Ok":
            return None
        return [
            staticmaps.create_latlng(lat, lon)
            for lon, lat in data["routes"][0]["geometry"]["coordinates"]
        ]
    except Exception:
        logger.warning("OSRM request failed, falling back to straight lines")
        return None


def _straight_coords(stops: list[StopPoint]) -> list[s2sphere.LatLng]:
    return [staticmaps.create_latlng(s.lat, s.lon) for s in stops]


async def _osrm_coords_async(stops: list[StopPoint]) -> Optional[list[s2sphere.LatLng]]:
    if len(stops) < 2:
        return None
    return await asyncio.to_thread(_osrm_coords, stops)


def _render_png(
    body: ExportRequest,
    orig_coords: Optional[list[s2sphere.LatLng]],
    mod_coords: Optional[list[s2sphere.LatLng]],
) -> bytes:
    ctx = staticmaps.Context()
    ctx.set_tile_provider(_CARTO_POSITRON)
    ctx.set_cache_dir(_TILE_CACHE_DIR)

    orig = body.original_stops
    mod = body.modified_stops

    if len(orig) >= 2:
        coords = orig_coords or _straight_coords(orig)
        ctx.add_object(staticmaps.Line(
            coords,
            color=staticmaps.parse_color("#aaaaaa"),
            width=3,
        ))

    if len(mod) >= 2:
        coords = mod_coords or _straight_coords(mod)
        ctx.add_object(staticmaps.Line(
            coords,
            color=staticmaps.parse_color(body.route_color),
            width=5,
        ))

    removed = [s for s in orig if s.is_removed]
    added = [s for s in mod if s.is_added]
    unchanged = [s for s in mod if not s.is_added]

    white = staticmaps.parse_color("#ffffff")
    for stops, fill_hex in [
        (unchanged, "#6b7280"),
        (removed,   "#ef4444"),
        (added,     "#22c55e"),
    ]:
        fill = staticmaps.parse_color(fill_hex)
        for s in stops:
            ctx.add_object(PixelCircle(
                staticmaps.create_latlng(s.lat, s.lon),
                fill_color=fill,
                stroke_color=white,
                radius=7,
            ))

    image = ctx.render_pillow(body.width, body.height)
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


@router.post("/png")
async def export_png(body: ExportRequest):
    orig_coords, mod_coords = await asyncio.gather(
        _osrm_coords_async(body.original_stops),
        _osrm_coords_async(body.modified_stops),
    )
    png = await asyncio.to_thread(_render_png, body, orig_coords, mod_coords)
    return Response(
        content=png,
        media_type="image/png",
        headers={"Content-Disposition": "attachment; filename=route-export.png"},
    )
