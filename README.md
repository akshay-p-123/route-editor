# MTD Route Editor

A web tool for planning and communicating bus route changes for Champaign-Urbana's Mass Transit District (MTD). Planners can modify existing routes, build new ones from scratch, group changes under a named reroute, and export a rider-facing PNG showing exactly what changed.

<img width="1906" height="990" alt="image" src="https://github.com/user-attachments/assets/16dce09d-8385-4a5c-b7ec-5a650515cbc6" />

---

## Usage

To edit an existing MTD route, find it in the left sidebar by route group and select a direction. The stop list loads on the right and the route appears on the map. Drag stops to reorder them, click the X to remove one, hover and click the pencil icon to replace a stop with a different one, or use the search bar at the bottom to append new stops. Alternatively, you can click a stop you want to move and nearby stops will be suggested. Click Save in the toolbar to persist the edit. If you are not signed in, you can still explore and edit but nothing will be saved.

<img width="1897" height="915" alt="image" src="https://github.com/user-attachments/assets/7577cf2c-b3a6-4d2d-b50c-5e4942aa53e3" />

To build a route from scratch, click New in the sidebar, fill in a name and optional color, then add stops in sequence using the search bar. Visual stop suggestions also work here, but for stop creation, not modification.

<img width="653" height="498" alt="image" src="https://github.com/user-attachments/assets/4a4dff0e-5441-4ad4-ad8e-204881cfb88f" />
<img width="647" height="399" alt="image" src="https://github.com/user-attachments/assets/c10bd181-d724-4a1d-b740-1aeb21ce9c5a" />



To group related edits under a named detour or service change, open the Reroutes panel from the top navigation. Create a reroute, then use the route picker inside that reroute's card to load an MTD route directly into the editor with the reroute context already set. Saving from there attaches the modified route to the reroute automatically.

<img width="619" height="572" alt="image" src="https://github.com/user-attachments/assets/49b7799c-7dcc-4ec2-b9a9-7f064af76c1f" />


Once an edit is complete, click Export PNG to download a map image showing what changed. The image is suitable for posting to rider communications or service alerts.


<img width="1200" height="800" alt="route-12-reroute(2)" src="https://github.com/user-attachments/assets/ffa9d2aa-7e2f-47d9-bc5b-dd50441477aa" />

---

## Features

### Route editing

All active MTD routes are listed in the left sidebar, organized by route group (Teal, Silver, Gold, Green, etc.). Selecting a group expands its available directions; choosing one loads the full stop list and draws the route polyline on the map.

From there, stops can be reordered by dragging, removed with a single click, or replaced inline using a stop search typeahead. New stops can be appended to the end of the route from the search bar at the bottom of the stop list.

### Custom routes

The New button in the sidebar opens a form to create a route from scratch. A name, short route number, and brand color can be specified. Stops are then added in sequence using the same search interface used for editing.

### Reroutes

A reroute is a named grouping of route modifications that belong together, such as all the changes made for a road closure or a construction detour. Reroutes can have an optional description, start date, and end date.

Each reroute holds references to modified saved routes. From the Reroutes panel, a planner can open any MTD route into the editor pre-tagged to a specific reroute, edit it, and save it. Routes tied to a reroute are shown inside that reroute's card rather than in the main sidebar, keeping permanent edits and temporary detours visually separate.

### Guest access

The editor is accessible without signing in. Guests can load any MTD route, make edits, and view the result on the map. A notice in the toolbar explains that changes will not be saved. Signing in unlocks saving, the My Routes dashboard, and reroute management.

### Validation

The editor runs live validation on the stop list and displays inline warnings and errors:

- Stops with coordinates at (0, 0) or outside the MTD service area are flagged as errors.
- Consecutive stops at the same intersection are flagged as warnings.
- Newly added stops that appear to be on the wrong side of the road for the direction of travel are flagged as warnings, with an option to dismiss the warning if the placement is intentional.

### PNG export

The Export PNG button generates a static map image suitable for sharing with riders. The backend renders it server-side using staticmaps and Pillow against CARTO raster tiles. The image shows:

- The original route in grey
- The modified route in the route's brand color
- Green circles for added stops, red for removed stops, grey for unchanged stops

### Map navigation

The map uses CARTO Positron tiles with no API key required. A "Back to Champaign" button appears in the top-right corner of the map and highlights blue when the viewport has drifted far enough from the MTD service area to warrant a prompt.

---

## Tech stack

Frontend: Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui, Zustand, TanStack Query, react-map-gl with MapLibre GL JS, dnd-kit

Backend: FastAPI (Python), Supabase (Postgres + Auth), staticmaps, Pillow

Map tiles: CARTO Positron (no API key)

Routing: OSRM public API (road-snapping for the interactive map)

Transit data: MTD API v3 at api.mtd.dev

---

## Known Issues

- Hopper routes are not yet supported, nor are the many variants an MTD route can have (such as Green)
- PNG export is still somewhat dubious
- I've tested route editing/creation quite a bit, but there are definitely still small problems with it
- Small UI bugs

## Planned improvements

- The ability to add new stops (not just from MTD)
- UI/UX that aligns more closely with something like Transit
- Long-term, adapting this into a tool that any transit agency can use


## Architecture notes

The browser never calls the backend directly. All `/api/*` requests go to the Next.js server, which rewrites them to the backend using a server-side environment variable. The MTD API key and Supabase service role key are never sent to the client.

The backend maintains an in-memory TTL cache in front of the MTD API. Route groups, stops, and trips are cached for one hour. Shape geometry is cached for 24 hours since shapes do not change between schedule releases. Stop search bypasses the cache entirely.

Authentication is stateless. Every request to a protected endpoint includes a Supabase JWT as a Bearer token. The backend verifies it against Supabase using the service role key and extracts the user ID. All database queries are scoped to that user ID so users can only read and modify their own data.

Reroute associations are stored as a nullable foreign key on the `saved_routes` table. Deleting a reroute nulls out the foreign key on its associated routes rather than deleting them.
