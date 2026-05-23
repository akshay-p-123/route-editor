"""CRUD for user-saved/modified routes stored in Supabase."""

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from supabase import create_client
from app.config import settings

router = APIRouter(prefix="/routes", tags=["routes"])


def _client():
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def _user_id(authorization: str = Header(...)) -> str:
    """Extract user_id from Supabase JWT passed as Bearer token."""
    token = authorization.removeprefix("Bearer ").strip()
    sb = _client()
    resp = sb.auth.get_user(token)
    if not resp.user:
        raise HTTPException(status_code=401, detail="Invalid token")
    return resp.user.id


# ── Models ──────────────────────────────────────────────────────────────────

class StopIn(BaseModel):
    stop_sequence: int
    stop_id: str | None = None
    stop_name: str
    stop_lat: float
    stop_lon: float


class RouteIn(BaseModel):
    name: str
    short_name: str | None = None
    color: str | None = None
    is_custom: bool = False
    base_route_id: str | None = None
    reroute_id: str | None = None
    stops: list[StopIn]


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/")
async def list_routes(user_id: str = Depends(_user_id)):
    sb = _client()
    resp = (
        sb.table("saved_routes")
        .select("*, route_stops(*)")
        .eq("user_id", user_id)
        .order("updated_at", desc=True)
        .execute()
    )
    return resp.data


@router.post("/", status_code=201)
async def create_route(body: RouteIn, user_id: str = Depends(_user_id)):
    sb = _client()
    route_resp = (
        sb.table("saved_routes")
        .insert(
            {
                "user_id": user_id,
                "name": body.name,
                "short_name": body.short_name,
                "color": body.color,
                "is_custom": body.is_custom,
                "base_route_id": body.base_route_id,
                "reroute_id": body.reroute_id,
            }
        )
        .execute()
    )
    route_id = route_resp.data[0]["id"]

    if body.stops:
        stops = [{"route_id": route_id, **s.model_dump()} for s in body.stops]
        sb.table("route_stops").insert(stops).execute()

    return {"id": route_id}


@router.get("/{route_id}")
async def get_route(route_id: UUID, user_id: str = Depends(_user_id)):
    sb = _client()
    resp = (
        sb.table("saved_routes")
        .select("*, route_stops(*)")
        .eq("id", str(route_id))
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Route not found")
    return resp.data


@router.put("/{route_id}")
async def update_route(route_id: UUID, body: RouteIn, user_id: str = Depends(_user_id)):
    sb = _client()
    sb.table("saved_routes").update(
        {
            "name": body.name,
            "short_name": body.short_name,
            "color": body.color,
            "is_custom": body.is_custom,
            "base_route_id": body.base_route_id,
            "reroute_id": body.reroute_id,
        }
    ).eq("id", str(route_id)).eq("user_id", user_id).execute()

    # Replace stops atomically
    sb.table("route_stops").delete().eq("route_id", str(route_id)).execute()
    if body.stops:
        stops = [
            {"route_id": str(route_id), **s.model_dump()} for s in body.stops
        ]
        sb.table("route_stops").insert(stops).execute()

    return {"id": str(route_id)}


@router.delete("/{route_id}", status_code=204)
async def delete_route(route_id: UUID, user_id: str = Depends(_user_id)):
    sb = _client()
    sb.table("saved_routes").delete().eq("id", str(route_id)).eq(
        "user_id", user_id
    ).execute()
