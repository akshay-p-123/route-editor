from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.routers import mtd, routes, export, reroutes

app = FastAPI(title="MTD Route Editor API", version="0.1.0")

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
