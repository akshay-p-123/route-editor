/** Backend base URL for BFF proxy handlers. Server-side only — never exposed to the browser. */
export const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";

/** Build fetch headers for a proxied backend request, forwarding the incoming Authorization header when present. */
export function authHeaders(req: Request): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const auth = req.headers.get("authorization");
  if (auth) h["Authorization"] = auth;
  return h;
}
