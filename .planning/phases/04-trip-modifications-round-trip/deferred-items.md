# Deferred Items

## Phase 04 Plan 04: malformed-JWT 500 in `_user_id()`

**Found during:** Plan 04-04, Task 3 pre-checkpoint smoke test.

**Observation:** `curl -X POST /api/gtfs/import -H "Authorization: Bearer fake"` returns
HTTP 500 (not 401). Traceback bottoms out in `_user_id()`:

```
File "backend/app/routers/gtfs.py", line 89, in _user_id
    resp = sb.auth.get_user(token)
supabase_auth.errors.AuthApiError: invalid JWT: unable to parse or verify
signature, token is malformed: token contains an invalid number of segments
```

**Root cause:** `_user_id()` only handles the case where `sb.auth.get_user(token)`
succeeds but returns no user (`if not resp.user: raise HTTPException(401, ...)`).
It does not catch `AuthApiError` raised when the token string itself is not a
syntactically valid JWT (e.g., not three dot-separated segments).

**Scope:** `_user_id()` is a shared private helper duplicated across
`backend/app/routers/gtfs.py`, `routes.py`, and `reroutes.py`. This is
pre-existing behavior, not introduced by plan 04-04, and affects every
`Depends(_user_id)` / `_user_id(authorization)` endpoint in the codebase.

**Why not fixed here:** Out of scope per SCOPE BOUNDARY — not caused by
04-04's changes. The real frontend flow always supplies a real
Supabase-issued JWT (`supabase.auth.getSession()`), so this path is not hit
in normal usage. Fixing it would mean editing a shared helper used by
unrelated routers, which is a cross-cutting change better handled as its own
task/plan.

**Suggested fix (future plan):** Wrap `sb.auth.get_user(token)` in
`_user_id()` with `try/except AuthApiError: raise HTTPException(401, "Invalid token")`.
