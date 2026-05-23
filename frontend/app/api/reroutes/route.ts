export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const res = await fetch(`${process.env.BACKEND_URL}/api/reroutes`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
  });
  return res;
}

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const body = await req.json();
  const res = await fetch(`${process.env.BACKEND_URL}/api/reroutes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  });
  return res;
}
