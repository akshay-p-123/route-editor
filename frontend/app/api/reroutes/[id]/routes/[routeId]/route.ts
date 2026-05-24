export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; routeId: string }> }
) {
  const { id, routeId } = await params;
  const authHeader = req.headers.get("authorization");
  const res = await fetch(
    `${process.env.BACKEND_URL}/api/reroutes/${id}/routes/${routeId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    }
  );
  return res;
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; routeId: string }> }
) {
  const { id, routeId } = await params;
  const authHeader = req.headers.get("authorization");
  const res = await fetch(
    `${process.env.BACKEND_URL}/api/reroutes/${id}/routes/${routeId}`,
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    }
  );
  return res;
}
