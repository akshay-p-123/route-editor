import { authHeaders, BACKEND } from "@/lib/apiProxy";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${BACKEND}/api/reroutes/${id}`, {
    method: "GET",
    headers: authHeaders(req),
  });
  return res;
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const res = await fetch(`${BACKEND}/api/reroutes/${id}`, {
    method: "PUT",
    headers: authHeaders(req),
    body: JSON.stringify(body),
  });
  return res;
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${BACKEND}/api/reroutes/${id}`, {
    method: "DELETE",
    headers: authHeaders(req),
  });
  return res;
}
