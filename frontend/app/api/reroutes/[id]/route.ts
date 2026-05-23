export async function GET(req: Request, { params }: { params: { id: string } }) {
  const authHeader = req.headers.get("authorization");
  const res = await fetch(`${process.env.BACKEND_URL}/api/reroutes/${params.id}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
  });
  return res;
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const authHeader = req.headers.get("authorization");
  const body = await req.json();
  const res = await fetch(`${process.env.BACKEND_URL}/api/reroutes/${params.id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  });
  return res;
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const authHeader = req.headers.get("authorization");
  const res = await fetch(`${process.env.BACKEND_URL}/api/reroutes/${params.id}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
  });
  return res;
}
