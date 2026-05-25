import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.routers import mtd, routes, export, reroutes
from app.services import mtd as mtd_svc

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await asyncio.gather(mtd_svc.get_route_groups(), mtd_svc.get_stops())
        logger.info("MTD cache warmed (route groups + stops)")
    except Exception as exc:
        logger.warning("MTD cache warmup failed: %s", exc)
    yield


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


@app.get("/health")
async def health():
    return {"status": "ok"}
