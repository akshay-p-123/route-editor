"""PNG export via staticmaps + Pillow."""

import asyncio
import io
import logging
from typing import Optional, Tuple

import requests
import s2sphere
import staticmaps
from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/export", tags=["export"])

_CARTO_POSITRON = staticmaps.TileProvider(
    name="carto-positron",
    url_pattern="https://$s.basemaps.cartocdn.com/light_all/$z/$x/$y.png",
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
    width: int = 1200
    height: int = 800


def _osrm_coords(stops: list[StopPoint]) -> Optional[list[s2sphere.LatLng]]:
    coord_str = ";".join(f"{s.lon},{s.lat}" for s in stops)
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


def _render_png(body: ExportRequest) -> bytes:
    ctx = staticmaps.Context()
    ctx.set_tile_provider(_CARTO_POSITRON)

    orig = body.original_stops
    mod = body.modified_stops

    if len(orig) >= 2:
        coords = _osrm_coords(orig) or _straight_coords(orig)
        ctx.add_object(staticmaps.Line(
            coords,
            color=staticmaps.parse_color("#aaaaaa"),
            width=3,
        ))

    if len(mod) >= 2:
        coords = _osrm_coords(mod) or _straight_coords(mod)
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
    png = await asyncio.to_thread(_render_png, body)
    return Response(
        content=png,
        media_type="image/png",
        headers={"Content-Disposition": "attachment; filename=route-export.png"},
    )
