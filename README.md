# MTD Route Editor

A web app for editing and creating bus routes for Champaign-Urbana's Mass Transit District (MTD). Admins can visually reroute existing lines or build custom ones, then export a rider-facing PNG showing what changed.

## Stack

- **Frontend** — Next.js 14 (App Router), React Map GL + MapLibre GL JS, Zustand, TanStack Query, dnd-kit, shadcn/ui
- **Backend** — FastAPI (Python), Supabase (Postgres + Auth), Playwright (PNG export)
- **Map tiles** — CARTO Positron (free, no API key)
- **Transit data** — MTD API v3 at api.mtd.dev (read-only)

**No Mapbox dependency.** Map tiles come from CARTO (free, no key). PNG exports are rendered by a headless Chromium browser via Playwright.

---

## Prerequisites

- Node.js ≥ 18
- Python ≥ 3.11
- An [MTD v3 API key](https://mtd.dev) — sign up at mtd.dev (v2 keys from developer.mtd.org do NOT work)
- A [Supabase project](https://supabase.com/) (free tier)

---

## 1. Supabase setup

1. Create a new Supabase project.
2. In the SQL editor, run the contents of [`supabase_schema.sql`](./supabase_schema.sql).
3. Enable **Email** auth under Authentication → Providers.
4. Copy your **Project URL**, **anon key**, and **service_role key** from Settings → API.

---

## 2. Frontend setup

```bash
cd frontend
cp .env.local.example .env.local
```

Fill in `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
NEXT_PUBLIC_API_URL=http://localhost:8000
```

```bash
npm install
npm run dev   # http://localhost:3000
```

---

## 3. Backend setup

```bash
cd backend
cp .env.example .env
```

Fill in `.env`:

```env
MTD_API_KEY=your_mtd_v3_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
CORS_ORIGINS=["http://localhost:3000"]
```

Install Python dependencies and the Playwright browser (one-time):

```bash
pip install -r requirements.txt
playwright install chromium
```

```bash
uvicorn app.main:app --reload   # http://localhost:8000
```

---

## Features

### Edit an existing route

1. Pick a route from the left sidebar (all MTD routes load automatically).
2. The map shows the route polyline and stop pins.
3. **List mode** (right panel): drag stops to reorder, click × to remove, search to add.
4. Click **Save** to persist your edits to Supabase (requires sign-in).

### Create a custom route

1. Click **New** in the route picker.
2. Set a name, route number, and color.
3. Use stop search to build the stop list from scratch.
4. Save when done.

### Export rider-facing PNG

Click **Export PNG** in the toolbar. The backend launches a headless Chromium browser, renders the route on a MapLibre map, and returns a PNG showing:

- Original route (grey dashed)
- Modified route (route color, solid)
- Green circles = added stops, red = removed stops, grey = unchanged

### My Routes dashboard

Sign in to see all your saved routes. Click the pencil icon to reopen any route in the editor.

---

## Project structure

```text
route-editor/
├── frontend/               # Next.js app
│   ├── app/
│   │   ├── layout.tsx
│   │   └── page.tsx        # Main editor page
│   ├── components/
│   │   ├── RouteMap.tsx    # MapLibre GL JS map (via react-map-gl/maplibre)
│   │   ├── RoutePicker.tsx # Left sidebar: MTD route groups
│   │   ├── StopList.tsx    # Right panel: dnd-kit stop list
│   │   ├── StopSearch.tsx  # Server-side stop search
│   │   ├── EditorToolbar.tsx
│   │   ├── AuthModal.tsx
│   │   ├── NewRouteModal.tsx
│   │   ├── SavedRoutesDashboard.tsx
│   │   └── Providers.tsx
│   ├── lib/
│   │   ├── api.ts          # Typed API client
│   │   └── supabase.ts
│   └── store/
│       └── editorStore.ts  # Zustand edit session state
├── backend/                # FastAPI app
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── routers/
│       │   ├── mtd.py      # MTD API v3 proxy
│       │   ├── routes.py   # CRUD for saved routes
│       │   └── export.py   # PNG export via Playwright + MapLibre
│       └── services/
│           └── mtd.py      # MTD API v3 client (X-ApiKey header)
└── supabase_schema.sql
```

---

## Deployment

The frontend is a standard Next.js app and deploys anywhere that supports Node.js. The backend requires a persistent server (not serverless) because Playwright downloads and runs a Chromium binary — a `Dockerfile` is included at `backend/Dockerfile`.

The recommended setup is **Vercel** (frontend) + **Railway** (backend).

---

### How API routing works

The browser never calls the backend directly. All `/api/*` requests go to the Next.js server, which rewrites them to the backend using the server-side `BACKEND_URL` env var. This means no CORS configuration is needed on the backend, and the backend URL is never exposed to the browser.

---

### Frontend → Vercel

1. Push the repo to GitHub.
2. Go to [vercel.com](https://vercel.com) → **New Project** → import your repo.
3. Set **Root Directory** to `frontend`.
4. Add these environment variables under **Settings → Environment Variables**, then deploy:

```env
BACKEND_URL=https://your-backend.railway.app
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

Vercel auto-deploys on every push to `main`.

---

### Backend → Railway

Railway builds and runs the included `Dockerfile` automatically.

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
2. Select your repo, set the **Root Directory** to `backend`.
3. Under **Variables**, add the following and deploy. Then under **Settings → Networking** generate a public domain and copy it back into Vercel as `BACKEND_URL`.

```env
MTD_API_KEY=your_mtd_v3_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

---

### Backend → Render (alternative)

1. Go to [render.com](https://render.com) → **New → Web Service** → connect your repo.
2. Set **Root Directory** to `backend`, **Runtime** to **Docker**.
3. Add the same environment variables as above under **Environment**.
4. Set **Health Check Path** to `/health`.

---

### Self-hosted with Docker Compose

Create a `.env` at the repo root:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

Backend variables go in `backend/.env` as normal. Then create `docker-compose.yml` at the repo root:

```yaml
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    env_file: ./backend/.env

  frontend:
    build:
      context: ./frontend
      args:
        NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL}
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}
    environment:
      BACKEND_URL: http://backend:8000
    ports:
      - "3000:3000"
    depends_on:
      - backend
```

`BACKEND_URL` is passed as a runtime environment variable (not a build arg), so the Next.js server can use the Docker-internal hostname `backend` to reach the backend container without the browser ever seeing it. Then:

```bash
docker compose up --build
```

---

## MTD API v3 endpoints used

| Endpoint              | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `GET /routes/groups`  | Populate route picker                                |
| `GET /stops`          | Build stop lookup map (id → name/coords)             |
| `GET /stops/search`   | Server-side stop search typeahead                    |
| `GET /trips`          | Find a representative trip per route group           |
| `GET /shapes/{id}`    | Route polyline + stop sequence (stopId on points)    |
