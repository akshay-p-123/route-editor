# MTD Route Editor

A web app for editing and creating bus routes for Champaign-Urbana's Mass Transit District (MTD). Admins can visually reroute existing lines or build custom ones, then export a rider-facing PNG showing what changed.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14 (App Router), React Map GL, Mapbox GL JS, Zustand, TanStack Query, dnd-kit, shadcn/ui |
| Backend | FastAPI (Python), Supabase (Postgres + Auth) |
| Maps & export | Mapbox (tiles + Static Images API for PNG export) |
| Transit data | MTD API v2.2 (read-only) |

---

## Prerequisites

- Node.js ≥ 18
- Python ≥ 3.11
- A [Mapbox account](https://account.mapbox.com/) (free tier covers MVP usage)
- An [MTD Developer API key](https://developer.mtd.org/) 
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

```
NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_mapbox_public_token
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

```
MTD_API_KEY=your_mtd_api_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
MAPBOX_TOKEN=sk.your_mapbox_secret_token   # or public token
CORS_ORIGINS=["http://localhost:3000"]
```

```bash
pip install -r requirements.txt
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
Click **Export PNG** in the toolbar. The backend calls the Mapbox Static Images API and returns a PNG showing:
- Original route (grey, faded)
- Modified route (route color, bold)
- Green pins = added stops, red pins = removed stops

### My Routes dashboard
Sign in to see all your saved routes. Click the pencil icon to reopen any route in the editor.

---

## Project structure

```
route-editor/
├── frontend/               # Next.js app
│   ├── app/
│   │   ├── layout.tsx      # Root layout + Providers
│   │   └── page.tsx        # Main editor page
│   ├── components/
│   │   ├── RouteMap.tsx    # Mapbox GL JS map
│   │   ├── RoutePicker.tsx # Left sidebar: MTD route list
│   │   ├── StopList.tsx    # Right panel: dnd-kit stop list
│   │   ├── StopSearch.tsx  # Stop autocomplete search
│   │   ├── EditorToolbar.tsx  # Save / Export / mode toggle
│   │   ├── AuthModal.tsx   # Login / signup
│   │   ├── NewRouteModal.tsx  # Custom route creation
│   │   ├── SavedRoutesDashboard.tsx
│   │   └── Providers.tsx   # TanStack Query provider
│   ├── lib/
│   │   ├── api.ts          # Typed API client (MTD proxy + FastAPI)
│   │   └── supabase.ts     # Supabase browser client
│   └── store/
│       └── editorStore.ts  # Zustand edit session state
├── backend/                # FastAPI app
│   └── app/
│       ├── main.py         # App entry point + CORS
│       ├── config.py       # Pydantic settings (reads .env)
│       ├── routers/
│       │   ├── mtd.py      # MTD API proxy (hides API key)
│       │   ├── routes.py   # CRUD for saved routes
│       │   └── export.py   # PNG export via Mapbox Static Images
│       └── services/
│           └── mtd.py      # MTD API client with changeset caching
└── supabase_schema.sql     # DB schema + RLS policies
```

---

## MTD API endpoints used

| Endpoint | Purpose |
|---|---|
| `GetRoutes` | Populate route picker |
| `GetStops` | Stop search database |
| `GetTripsByRoute` | Find representative trip for a route |
| `GetStopTimesByTrip` | Ordered stop list for a trip |
| `GetShape` | Route polyline geometry |
| `GetShapeBetweenStops` | Segment geometry between two stops |

All MTD calls are proxied through FastAPI to keep the API key off the client. Responses use `changeset_id` caching to stay within the 1,000 req/hour rate limit.
