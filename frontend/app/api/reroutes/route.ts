import { authHeaders, BACKEND } from "@/lib/apiProxy";

export async function GET(req: Request) {
  const res = await fetch(`${BACKEND}/api/reroutes`, {
    method: "GET",
    headers: authHeaders(req),
  });
  return res;
}

export async function POST(req: Request) {
  const body = await req.json();
  const res = await fetch(`${BACKEND}/api/reroutes`, {
    method: "POST",
    headers: authHeaders(req),
    body: JSON.stringify(body),
  });
  return res;
}
