# Architecture: Kurnool Chaos v1

## Stack
| Part | Choice | Notes |
|---|---|---|
| Build | Vite + TypeScript | `npm run dev -- --host` to test on phone over Wi-Fi |
| 3D | Three.js from npm | WebGL2, no physics engine in v1 (custom arcade physics like the demo) |
| Realtime | `@supabase/supabase-js` v2 Realtime | Broadcast for state, Presence for who is in the room |
| Data | Supabase Postgres, one table | `race_results` |
| Hosting | Vercel, static build | Env vars set in the Vercel dashboard |
| Map pipeline | Node scripts in `scripts/osm/` | Run once, output committed to the repo |

## Folder layout
```
kurnool-chaos/
  public/map/kurnool.json      built map, committed
  public/fonts/                Noto Sans Telugu (if self-hosted)
  scripts/osm/fetch.mjs        Overpass API -> scripts/osm/raw.json (gitignored)
  scripts/osm/build.mjs        raw.json -> public/map/kurnool.json
  src/main.ts                  boot, game loop
  src/map/  src/vehicles/  src/player/  src/ai/  src/net/  src/race/  src/ui/
  supabase/schema.sql          table + RLS policies
  reference/port-meridian-demo.html
```

## Map pipeline
1. `fetch.mjs` sends one Overpass query for the bounding box in `MAP-SPEC.md`: `highway=*` ways, `building=*` ways, `natural=water`, `waterway=riverbank`, `waterway=river`, `railway=rail`, and the landmark features. Uses `out geom;`. Saves raw JSON.
2. `build.mjs`:
   - Projects lat/lon to local meters around the map centre (equirectangular is fine at this size). X = east, Z = south, to match Three.js.
   - Roads: keep drivable highway types, assign width by type, simplify with Douglas-Peucker (about 1 m tolerance), build a road graph (nodes at intersections, edges with polylines) for traffic AI.
   - Buildings: footprint polygons. Height from `building:levels` if present, otherwise 1 to 4 floors from a random generator seeded by the OSM id (same output every run), taller near commercial centres. Drop tiny ones (< 12 m2).
   - Road cleanup: drop or shrink any building that overlaps a drivable road (half road width + 1 m), so narrow old-city lanes stay drivable.
   - Filler: where an area has almost no OSM buildings, add parks (green patches, a few trees) and simple random buildings along road edges. Seeded, not precise.
   - Water: river polygons. River centreline as fallback if no polygon. Roads tagged `bridge=yes` cross water: water collision is removed under them.
   - Landmarks: id, name_en, name_te, position, footprint, type.
   - Adds the airport block (see MAP-SPEC) and the highway link to it.
   - Rounds coordinates to 0.1 m to keep the file small. Target under 3 MB.
   - Validates before writing: no NaN, every point inside bounds, polygons with 3+ points and no self-crossing, `version` set. Fails loudly if not.
3. Output JSON is committed. A gzipped `scripts/osm/raw.json.gz` snapshot is committed too, so the build can be re-run on the same data later. Game loads the map with `fetch('/map/kurnool.json')` and shows a clear error screen if the fetch or parse fails.

### kurnool.json shape
```ts
type MapData = {
  version: 1
  center: { lat: number; lon: number }
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number }
  roads: { id: number; kind: string; width: number; oneway: boolean; bridge: boolean; pts: [number, number][] }[]
  graph: { nodes: [number, number][]; edges: { a: number; b: number; road: number; len: number }[] }
  buildings: { pts: [number, number][]; h: number; kind?: string }[]
  water: { pts: [number, number][] }[]
  parks: { pts: [number, number][] }[]
  rail: { pts: [number, number][] }[]
  landmarks: { id: string; nameEn: string; nameTe: string; type: string; x: number; z: number; pts?: [number, number][] }[]
  airport: { runway: { x: number; z: number; len: number; w: number; heading: number }; terminal: { pts: [number, number][] } }
  spawn: { x: number; z: number; heading: number }
}
```

## Rendering
- Ground: one big plane. Roads as merged ribbon meshes per 250 m chunk, slightly above the ground, with polygonOffset.
- Buildings: extruded footprints merged per chunk into one geometry with vertex colors. Window texture shared. Frustum culling per chunk.
- Landmarks: hand-built low-poly groups (fort tower, bridge with railings, station shed, hospital block). Signboards are CanvasTexture planes with English and Telugu text. Wait for `document.fonts.load` on Noto Sans Telugu before drawing them, otherwise the text shows as boxes.
- Dusk sky, fog and lights reused from the demo.
- Quality setting: low / high. Low = pixel ratio 1, shorter fog distance, fewer traffic cars, no window emissive.

## Collision
- Uniform spatial hash grid (cell 32 m) holding building polygon edges and water edges.
- Vehicles and players are circles. Push out of edges, kill speed on hard hits, like the demo.
- Off-road driving is allowed everywhere except inside buildings and water.

## Vehicles
One arcade model (from the demo) with a params table:

| Type | Top speed (m/s) | Accel | Grip | Radius | Notes |
|---|---|---|---|---|---|
| car | 34 | 15 | high | 1.6 | sedans, hatchbacks |
| auto | 18 | 9 | low | 1.2 | tippy, body rolls a lot |
| bike | 30 | 20 | medium | 0.7 | leans into turns, fits through gaps |
| bus | 20 | 6 | high | 2.4 | slow turning, long |
| lorry | 22 | 7 | medium | 2.4 | heavy, pushes cars |

Numbers are starting points. Tune in play-tests.

- Car, auto and bike get low-poly models. Bus and lorry are simple box shapes.
- Vehicle-to-vehicle collision uses each type's radius.
- Physics time step is capped at 1/30 s and split into sub-steps on slow frames, so fast vehicles never pass through walls.

## Player
- Spawn: players start spread out on a ring of road points around Rajvihar, not on one spot.
- Parked vehicles: about 8 mixed vehicles parked near spawn. Local to each player.
- Unstuck: R key or a touch button moves you to the nearest road point, facing along the road, speed zero.

## Traffic and cops (local only)
- Traffic follows the road graph on the left lane: offset to the left of the edge direction. Picks a random next edge at nodes. Stops when blocked, ghosts through after 5 s stuck (demo logic).
- Cops spawn on graph nodes 140 to 320 m away when heat rises. Chase along the graph using a shortest-path search to the player's nearest node, recomputed about once a second (greedy steps get stuck at dead ends). Switch to direct pursuit with line of sight under 30 m. Busted after 1.3 s stopped near a cop.
- Heat triggers: taking a vehicle out of traffic, hitting another vehicle hard, hitting a cop.
- Police vehicles say "POLICE" only. No real department logos.

## Multiplayer (Supabase Realtime)
- Room URL: `/?room=ABC123`. 6-char code, uppercase letters and digits without 0/O/1/I.
- Channel: `room:ABC123` with `config: { broadcast: { self: false }, presence: { key: playerId } }`.
- Presence payload: `{ id, nick, color, joinedAt }`.
- Broadcast event `s` at 5 Hz: `{ id, t, x, z, y, h, v, mode }` where `mode` is the vehicle type or `foot` and `h` is heading in radians. Keep it small. While standing still, send only a heartbeat every 2 s.
- Remote players: buffer snapshots stamped with local receive time, render 200 ms in the past, interpolate position and heading. Drop players missing for 5 s.
- Remote vehicles are solid for you: you bounce off them like a wall. You cannot push them.
- Phone lock or app switch (`visibilitychange`): on return, cap the time step, rejoin presence, show "Reconnecting" until the channel is back.
- Events: `race_setup`, `race_start` (sends `delayMs`, about 5000; each client starts its countdown when the message arrives, because phone clocks differ), `race_finish`.
- Limit: 8 players per room, soft cap. Presence can briefly disagree, so each client sorts players by presence order and leaves with "Room full" if it is past 8.
- Message budget: the Supabase free plan limits Realtime messages per month and per second. Check the current numbers in task 3.1 and log them in DECISIONS.md.

## Races
- Races are secondary. Any player opens race setup and picks a preset route. Presets are chosen after the map is built. Custom routes on the minimap are out of scope.
- Checkpoints are snapped to the nearest road. Rings shown to everyone.
- One race at a time, identified by `raceId`. The player who set it up is the owner and re-sends race state when someone joins, so late joiners see it.
- A race ends when everyone has finished or after a timeout. Players who leave are DNF. If the owner leaves, the race continues on local timers.
- Countdown starts when `race_start` arrives. Each client times itself and broadcasts `race_finish` with its time, then inserts into `race_results`.

### supabase/schema.sql
```sql
create table race_results (
  id bigint generated always as identity primary key,
  room text not null check (char_length(room) = 6),
  race_id text not null,
  nick text not null check (char_length(nick) between 1 and 16),
  vehicle text not null,
  time_ms integer not null check (time_ms between 5000 and 3600000),
  created_at timestamptz not null default now()
);
alter table race_results enable row level security;
create policy "anyone can read" on race_results for select using (true);
create policy "anyone can insert" on race_results for insert with check (true);
create index on race_results (room, race_id, time_ms);
```
No update or delete policies, so results cannot be edited from the client. Anyone with the publishable key can insert fake times: accepted risk for a friends game.

## Errors
No blank screens. Each failure shows a plain message with a Retry button:
- Map file missing, unreadable or fails validation.
- Supabase env vars missing, or the Realtime channel fails to connect.
- Room full.

Nicknames and any player text are shown with `textContent`, never `innerHTML`.

## Env
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local` and in Vercel project settings. Both are public by design. Security comes from RLS.

## Open questions
- Exact bounding box and landmark coordinates: confirm with Bunny in task 1.3.
- Telugu spellings: Bunny verifies.
- Whether OSM has enough Kurnool buildings or we lean on generated filler: decide after first export.
- Race preset routes: pick after the map is built.
