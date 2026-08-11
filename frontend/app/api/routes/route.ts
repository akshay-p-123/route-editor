import { NextRequest, NextResponse } from "next/server";
import { authHeaders, BACKEND } from "@/lib/apiProxy";

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
