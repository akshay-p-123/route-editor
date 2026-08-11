import { authHeaders, BACKEND } from "@/lib/apiProxy";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; routeId: string }> }
) {
  const { id, routeId } = await params;
  const res = await fetch(
    `${BACKEND}/api/reroutes/${id}/routes/${routeId}`,
    {
      method: "POST",
      headers: authHeaders(req),
    }
  );
  return res;
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; routeId: string }> }
) {
  const { id, routeId } = await params;
  const res = await fetch(
    `${BACKEND}/api/reroutes/${id}/routes/${routeId}`,
    {
      method: "DELETE",
      headers: authHeaders(req),
    }
  );
  return res;
}
