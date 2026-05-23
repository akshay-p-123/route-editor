from fastapi import APIRouter, Header, HTTPException, status
from typing import Optional
from datetime import date
from pydantic import BaseModel
from uuid import UUID
from supabase import create_client
from app.config import settings

router = APIRouter(prefix="/api/reroutes", tags=["reroutes"])


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


class RerouteIn(BaseModel):
    name: str
    description: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class SavedRouteRef(BaseModel):
    id: UUID
    name: str
    short_name: Optional[str] = None
    is_custom: bool


class RerouteOut(BaseModel):
    id: UUID
    user_id: UUID
    name: str
    description: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    created_at: str
    updated_at: str
    saved_routes: list[SavedRouteRef] = []


@router.get("/", response_model=list[RerouteOut])
def list_reroutes(authorization: str = Header(None)):
    """List all reroutes for the authenticated user, with nested saved routes."""
    user_id = _user_id(authorization)
    client = _client()

    # Fetch reroutes
    res = client.from_("reroutes").select(
        "id, user_id, name, description, start_date, end_date, created_at, updated_at"
    ).eq("user_id", user_id).order("created_at", desc=True).execute()

    if not res.data:
        return []

    # For each reroute, fetch associated saved routes
    reroutes_out = []
    for reroute in res.data:
        routes_res = client.from_("saved_routes").select(
            "id, name, short_name, is_custom"
        ).eq("reroute_id", reroute["id"]).execute()

        reroute_out = RerouteOut(
            **reroute,
            saved_routes=[SavedRouteRef(**r) for r in routes_res.data]
        )
        reroutes_out.append(reroute_out)

    return reroutes_out


@router.post("/", response_model=RerouteOut)
def create_reroute(payload: RerouteIn, authorization: str = Header(None)):
    """Create a new reroute for the authenticated user."""
    user_id = _user_id(authorization)
    client = _client()

    data = payload.model_dump(exclude_unset=True)
    data["user_id"] = str(user_id)

    res = client.from_("reroutes").insert(data).select(
        "id, user_id, name, description, start_date, end_date, created_at, updated_at"
    ).execute()

    if not res.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)

    return RerouteOut(**res.data[0], saved_routes=[])


@router.get("/{reroute_id}", response_model=RerouteOut)
def get_reroute(reroute_id: UUID, authorization: str = Header(None)):
    """Get a single reroute with its associated routes."""
    user_id = _user_id(authorization)
    client = _client()

    res = client.from_("reroutes").select(
        "id, user_id, name, description, start_date, end_date, created_at, updated_at"
    ).eq("id", str(reroute_id)).eq("user_id", str(user_id)).execute()

    if not res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    reroute = res.data[0]

    routes_res = client.from_("saved_routes").select(
        "id, name, short_name, is_custom"
    ).eq("reroute_id", str(reroute_id)).execute()

    return RerouteOut(
        **reroute,
        saved_routes=[SavedRouteRef(**r) for r in routes_res.data]
    )


@router.put("/{reroute_id}", response_model=RerouteOut)
def update_reroute(reroute_id: UUID, payload: RerouteIn, authorization: str = Header(None)):
    """Update a reroute."""
    user_id = _user_id(authorization)
    client = _client()

    # Verify ownership
    check = client.from_("reroutes").select("id").eq("id", str(reroute_id)).eq("user_id", str(user_id)).execute()
    if not check.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    data = payload.model_dump(exclude_unset=True)
    res = client.from_("reroutes").update(data).eq("id", str(reroute_id)).select(
        "id, user_id, name, description, start_date, end_date, created_at, updated_at"
    ).execute()

    if not res.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)

    reroute = res.data[0]

    routes_res = client.from_("saved_routes").select(
        "id, name, short_name, is_custom"
    ).eq("reroute_id", str(reroute_id)).execute()

    return RerouteOut(
        **reroute,
        saved_routes=[SavedRouteRef(**r) for r in routes_res.data]
    )


@router.delete("/{reroute_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reroute(reroute_id: UUID, authorization: str = Header(None)):
    """Delete a reroute. Associated routes are set to reroute_id=NULL."""
    user_id = _user_id(authorization)
    client = _client()

    # Verify ownership
    check = client.from_("reroutes").select("id").eq("id", str(reroute_id)).eq("user_id", str(user_id)).execute()
    if not check.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    client.from_("reroutes").delete().eq("id", str(reroute_id)).execute()
    return None


@router.post("/{reroute_id}/routes/{route_id}", status_code=status.HTTP_204_NO_CONTENT)
def add_route_to_reroute(reroute_id: UUID, route_id: UUID, authorization: str = Header(None)):
    """Tag a saved route with a reroute."""
    user_id = _user_id(authorization)
    client = _client()

    # Verify reroute ownership
    check = client.from_("reroutes").select("id").eq("id", str(reroute_id)).eq("user_id", str(user_id)).execute()
    if not check.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    # Verify route ownership
    route_check = client.from_("saved_routes").select("id").eq("id", str(route_id)).eq("user_id", str(user_id)).execute()
    if not route_check.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    client.from_("saved_routes").update({"reroute_id": str(reroute_id)}).eq("id", str(route_id)).execute()
    return None


@router.delete("/{reroute_id}/routes/{route_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_route_from_reroute(reroute_id: UUID, route_id: UUID, authorization: str = Header(None)):
    """Remove a route from a reroute."""
    user_id = _user_id(authorization)
    client = _client()

    # Verify reroute ownership
    check = client.from_("reroutes").select("id").eq("id", str(reroute_id)).eq("user_id", str(user_id)).execute()
    if not check.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    # Verify route ownership
    route_check = client.from_("saved_routes").select("id").eq("id", str(route_id)).eq("user_id", str(user_id)).execute()
    if not route_check.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    client.from_("saved_routes").update({"reroute_id": None}).eq("id", str(route_id)).execute()
    return None
