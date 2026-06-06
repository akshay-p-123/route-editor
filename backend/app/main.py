import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.routers import mtd, routes, export, reroutes, gtfs
from app.services import mtd as mtd_svc
from app.services import gtfs as gtfs_svc

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.gtfs_feed = None
    try:
        await asyncio.gather(
            mtd_svc.get_route_groups(),
            mtd_svc.get_stops(),
            gtfs_svc.load_and_store(app),
        )
        logger.info("Cache warmed (MTD + GTFS)")
    except Exception as exc:
        logger.warning("MTD cache warmup failed: %s", exc)
    task = asyncio.create_task(gtfs_svc._refresh_loop(app))
    yield
    task.cancel()


app = FastAPI(title="MTD Route Editor API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(mtd.router, prefix="/api")
app.include_router(routes.router, prefix="/api")
app.include_router(export.router, prefix="/api")
app.include_router(reroutes.router)
app.include_router(gtfs.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}
