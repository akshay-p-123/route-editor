"""PNG export via headless Chromium (Playwright).

One-time setup: `playwright install chromium`
"""

import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/export", tags=["export"])


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


def _build_html(body: ExportRequest) -> str:
    orig = [[s.lon, s.lat] for s in body.original_stops]
    mod  = [[s.lon, s.lat] for s in body.modified_stops]

    # original_stops carries is_removed flags; modified_stops is active stops only
    removed   = [s for s in body.original_stops if s.is_removed]
    added     = [s for s in body.modified_stops if s.is_added]
    unchanged = [s for s in body.modified_stops if not s.is_added]

    def markers(stops: list[StopPoint], color: str) -> list[dict]:
        return [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [s.lon, s.lat]},
                "properties": {"color": color, "name": s.stop_name},
            }
            for s in stops
        ]

    # Only build line sources when there are enough points
    sources: dict = {}
    layers: list[str] = []

    if len(orig) >= 2:
        sources["orig_line"] = {
            "type": "geojson",
            "data": {"type": "Feature", "geometry": {"type": "LineString", "coordinates": orig}, "properties": {}},
        }
        layers.append("""map.addLayer({
          id: 'orig-line', type: 'line', source: 'orig_line',
          paint: { 'line-color': '#aaaaaa', 'line-width': 3, 'line-dasharray': [4, 3], 'line-opacity': 0.7 }
        });""")

    if len(mod) >= 2:
        sources["mod_line"] = {
            "type": "geojson",
            "data": {"type": "Feature", "geometry": {"type": "LineString", "coordinates": mod}, "properties": {}},
        }
        layers.append(f"""map.addLayer({{
          id: 'mod-line', type: 'line', source: 'mod_line',
          paint: {{ 'line-color': {json.dumps(body.route_color)}, 'line-width': 5, 'line-opacity': 0.95 }}
        }});""")

    for key, stops, color in [
        ("stops_unchanged", unchanged, "#6b7280"),
        ("stops_removed",   removed,   "#ef4444"),
        ("stops_added",     added,     "#22c55e"),
    ]:
        sources[key] = {"type": "geojson", "data": {"type": "FeatureCollection", "features": markers(stops, color)}}
        layers.append(f"""map.addLayer({{
          id: '{key}', type: 'circle', source: '{key}',
          paint: {{ 'circle-radius': 7, 'circle-color': '{color}',
                   'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 }}
        }});""")

    all_stops = body.original_stops + body.modified_stops
    all_lons = [s.lon for s in all_stops] or [-88.30]
    all_lats = [s.lat for s in all_stops] or [40.09]
    bounds = json.dumps([[min(all_lons), min(all_lats)], [max(all_lons), max(all_lats)]])
    layers_js = "\n  ".join(layers)

    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css">
  <script src="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.js"></script>
  <style>* {{ margin:0; padding:0 }} #map {{ width:{body.width}px; height:{body.height}px }}</style>
</head>
<body>
<div id="map"></div>
<script>
const sources = {json.dumps(sources)};

const map = new maplibregl.Map({{
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  bounds: {bounds},
  fitBoundsOptions: {{ padding: 60 }},
  attributionControl: false,
}});

map.on('load', function() {{
  for (const [id, src] of Object.entries(sources)) map.addSource(id, src);
  {layers_js}

  let done = false;
  function signal() {{ if (!done) {{ done = true; document.body.setAttribute('data-ready', 'true'); }} }}
  map.once('idle', signal);
  setTimeout(signal, 2500);
}});

map.on('error', function(e) {{
  console.error('MapLibre error', e);
  setTimeout(function() {{ document.body.setAttribute('data-ready', 'true'); }}, 1000);
}});
</script>
</body>
</html>"""


def _render_png(html: str, width: int, height: int) -> bytes:
    """Runs Playwright synchronously in a thread — avoids Windows asyncio
    subprocess limitations with the SelectorEventLoop."""
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox", "--disable-setuid-sandbox"])
        page = browser.new_page(viewport={"width": width, "height": height})
        page.set_content(html, wait_until="domcontentloaded")
        page.wait_for_selector("[data-ready='true']", timeout=20000)
        png = page.screenshot(type="png")
        browser.close()
    return png


@router.post("/png")
async def export_png(body: ExportRequest):
    html = _build_html(body)
    loop = asyncio.get_event_loop()
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            png = await loop.run_in_executor(pool, _render_png, html, body.width, body.height)
    except PlaywrightTimeout:
        logger.error("Export timed out waiting for map to render")
        raise HTTPException(
            status_code=504,
            detail="Map render timed out — run `playwright install chromium` and ensure the server has internet access.",
        )
    except Exception as exc:
        logger.exception("Export failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))

    return Response(
        content=png,
        media_type="image/png",
        headers={"Content-Disposition": "attachment; filename=route-export.png"},
    )
