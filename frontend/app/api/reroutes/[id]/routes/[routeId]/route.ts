export async function POST(
  req: Request,
  { params }: { params: { id: string; routeId: string } }
) {
  const authHeader = req.headers.get("authorization");
  const res = await fetch(
    `${process.env.BACKEND_URL}/api/reroutes/${params.id}/routes/${params.routeId}`,
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
  { params }: { params: { id: string; routeId: string } }
) {
  const authHeader = req.headers.get("authorization");
  const res = await fetch(
    `${process.env.BACKEND_URL}/api/reroutes/${params.id}/routes/${params.routeId}`,
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
