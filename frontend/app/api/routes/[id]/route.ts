import { NextRequest, NextResponse } from "next/server";
import { authHeaders, BACKEND } from "@/lib/apiProxy";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const res = await fetch(`${BACKEND}/api/routes/${id}`, { headers: authHeaders(req) });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.text();
  const res = await fetch(`${BACKEND}/api/routes/${id}`, {
    method: "PUT",
    headers: authHeaders(req),
    body,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const res = await fetch(`${BACKEND}/api/routes/${id}`, {
    method: "DELETE",
    headers: authHeaders(req),
  });
  return new NextResponse(null, { status: res.status });
}
