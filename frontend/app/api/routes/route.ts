import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";

function authHeaders(req: NextRequest): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const auth = req.headers.get("authorization");
  if (auth) h["Authorization"] = auth;
  return h;
}

export async function GET(req: NextRequest) {
  const res = await fetch(`${BACKEND}/api/routes/`, { headers: authHeaders(req) });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const res = await fetch(`${BACKEND}/api/routes/`, {
    method: "POST",
    headers: authHeaders(req),
    body,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
