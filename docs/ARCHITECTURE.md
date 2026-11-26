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
   - Overture buildings (task K.1): `scripts/osm/overture.py` downloads Overture Maps buildings (pinned release, `overturemaps` Python tool) into the committed `scripts/osm/overture-buildings.json.gz`. The build adds every Overture building that is not more than 20% on an OSM outline (2 m raster), with the same road clean-up. Real heights or floor counts are used when Overture has them, otherwise seeded floors like OSM.
   - Styles (task K.2): `scripts/osm/fetch-details.mjs` (`npm run osm:details`) downloads OSM land use, shops, amenities, offices, place names, power poles and trees into the committed `scripts/osm/details.json.gz`. Each building gets a style: industrial or campus from building tags and land use; market (shop fronts) when it faces a main or market road in a built-up or shop area; old city near old-city neighbourhood names (Peta, Pet, Pura, Bagh, Qila...) or the fort, or very dense near the fort; outskirts in villages or very sparse areas; colony in named colonies, residential land use or houses. Heights without real data follow the style. Colony houses whose wall box (1.8 m out) is clear of roads, buildings and other walls get a compound wall with a gate facing the nearest road.
   - Street details (task K.3): electric poles every 38 m on the left verge of town roads (wired in runs), neem trees on verges every 26 m, hoardings every 240 m on main roads, places of worship (a small building under an OSM temple/mosque/church point is replaced by the model, otherwise it goes on free ground facing the road) and auto stands at the kerb near busy landmarks. Every spot is checked against a 2 m raster of buildings, water, compound walls and earlier props, and kept off every road surface and away from junctions.
   - Corrections (task K.4): `scripts/osm/corrections.json` holds Bunny's fixes: landmark pins, buildings to remove or add, river and canal widths by name, and circles kept free of props. Each one is listed in the build report; one that matches nothing stops the build.
   - Satellite data (task K.5): `scripts/osm/earthengine.py` (Google Earth Engine, Bunny's free noncommercial project, id passed in `EE_PROJECT`, never committed) downloads Google Open Buildings 2.5D heights (2023, 4 m) and Dynamic World water probability (90th percentile June 2023 to June 2024, 5 m) into committed grids (`ee-heights.bin.gz`, `ee-water.bin.gz`, `earthengine.json`). Buildings without OSM levels take the 80th percentile height inside their outline when at least 30% of it shows a building. Canal and river widths are measured across the water map every 20 m (50% water = edge, median of the wet points); runs the satellite cannot resolve keep the default. Order of width sources: corrections, satellite, OSM width tag, default.
   - Terrain (task K.5): Copernicus DEM GLO-30 from Earth Engine (roofs and trees removed by a 45 m morphological opening), sampled onto a 20 m grid over the map plus 300 m, heights relative to Raj Vihar, written to `public/map/terrain.bin` (Int16 decimetres, row by row). Ground under water is lowered to the lowest point within 60 m; underpasses are dug into it (full depth across the road, easing out over 12 m).
   - Water outlines (task K.5): traced from the Dynamic World water map at 50% (`scripts/osm/contour.mjs`), kept only where they touch an OSM river or lake; islands are holes. River lines are a sandy bed (no water unless the satellite sees it); canal lines stay water strips.
   - Flyovers and underpasses (task K.5): an OSM bridge that crosses another road or the railway is raised 6.5 m (`road.lift`), with ramps down the connecting road ways at 6%; OSM tunnels (roads under the railway) are dug 5.5 m into the terrain the same way. Level crossings only where OSM has railway=level_crossing. Rail runs carry their own heights (`rail[].y`, the undug ground every 20 m).
   - Railway station (task K.5): buildings within 3 m of a track are dropped. Platforms come from OSM railway=platform ways and from long narrow satellite outlines lying beside and along the tracks within 1.2 km of Kurnool City station (Google sees platform roofs as buildings); they go into `props.platforms` and are drawn as raised slabs with a sheet roof on columns.
   - Filler: where an area has almost no OSM or Overture buildings, add parks (green patches, a few trees) and simple random buildings along road edges. Seeded, not precise.
   - Water: river polygons. River centreline as fallback if no polygon. Roads tagged `bridge=yes` cross water: water collision is removed under them.
   - Landmarks: id, name_en, name_te, position, footprint, type.
   - Adds the airport block (see MAP-SPEC) and the highway link to it.
   - Rounds coordinates to 0.1 m to keep the file small. Target under 6 MB (about 1.5 MB gzipped); raised from 3 MB when the map was expanded.
   - Validates before writing: no NaN, every point inside bounds, polygons with 3+ points and no self-crossing, `version` set. Fails loudly if not.
3. Output JSON is committed. A gzipped `scripts/osm/raw.json.gz` snapshot is committed too, so the build can be re-run on the same data later. Game loads the map with `fetch('/map/kurnool.json')` and shows a clear error screen if the fetch or parse fails.

### kurnool.json shape
```ts
type MapData = {
  version: 2
  center: { lat: number; lon: number }
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number }   // play area + airport
  playArea: { minX: number; minZ: number; maxX: number; maxZ: number } // the OSM box only
  roads: { id: number; kind: string; width: number; oneway: boolean; bridge: boolean; pts: [number, number][]; lift?: number[] }[] // lift: flyover height above ground per point
  graph: {
    nodes: [number, number][]
    // road = index into roads; pts i0..i1 of that road is the edge's polyline (a at i0, b at i1)
    edges: { a: number; b: number; road: number; len: number; i0: number; i1: number }[]
  }
  buildings: { p: number[]; h: number; k?: string; s?: number; w?: number }[]   // file form; the loader unpacks it to { pts, h, kind, style, gate }. kind 'filler' = generated
  water: { pts: [number, number][]; holes?: [number, number][][] }[]  // holes = islands
  parks: { pts: [number, number][] }[]
  rail: { pts: [number, number][]; y?: number[]; bridge?: true; overWater?: true; electric?: true; service?: string }[]
  waterways: { pts: [number, number][]; w: number; kind: 'river' | 'canal'; name?: string; part?: 'aqueduct' | 'culvert' }[] // OSM centre lines
  landmarks: { id: string; nameEn: string; nameTe: string; type: string; x: number; z: number; pts?: [number, number][] }[]
  props: {                                  // street details (K.3), flat arrays in whole decimetres
    poles: number[][]                       // wired runs [x0, z0, dx1, dz1, ...]
    trees: number[]                         // [x, z, ...]
    hoardings: number[]                     // [x, z, headingDeg, ...], heading = the way the board faces
    worship: { x: number; z: number; a: number; w: number; d: number; r: 'h' | 'm' | 'c'; name?: string }[] // metres, a in radians
    autoStands: number[]                    // [x, z, headingDeg, count, ...]
    crossings: { x: number; z: number; a: number; hw: number }[] // OSM level crossings
    platforms: { pts: [number, number][]; roof: boolean }[]       // railway platforms, roof = shelter
  }
  terrain: { file: 'terrain.bin'; x0: number; z0: number; cell: number; w: number; h: number; ref: number } // ref = metres above sea level of height 0
  airport: { runway: { x: number; z: number; len: number; w: number; heading: number }; terminal: { pts: [number, number][] } }
  spawn: { x: number; z: number; heading: number }
  meta: { osmBase: string; overtureRelease: string; credit: string }
}
```
Building outlines are packed to keep the file small: `p = [x0, z0, dx1, dz1, ...]` in whole decimetres (first point absolute, then deltas), `k` = kind, `s` = style (0 plain, 1 old city, 2 colony, 3 market, 4 campus, 5 outskirts, 6 industrial; see `src/map/buildingStyle.ts`), `w` = compound wall gate side (0..3 of the box around the house aligned to its longest edge). `src/map/loadMap.ts` unpacks them into `pts` in metres.
Conventions:
- Units are metres, rounded to 0.1. X = east, Z = south.
- Credit (`meta.credit` and `#credit` in index.html): "© OpenStreetMap contributors, Overture Maps Foundation, Google Open Buildings, Dynamic World, Copernicus DEM". Copernicus DEM: produced using Copernicus WorldDEM-30, © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the EU and ESA. OSM and Overture are ODbL, the two Google datasets CC BY 4.0. On phones it is 9 px and fits under the controls.
- Polygons are open rings (no repeated closing point) with positive shoelace area in (x, z).
- Heading is radians with forward = (sin h, cos h), same as the demo.
- Roads with `oneway` run in point order. The airport link road has `id: -1`.
- Rivers and canals that OSM only has as centrelines become strips of quads in `water`.
- Landmark names come from the table in MAP-SPEC.md. Landmarks OSM lacks get a pin in `scripts/osm/corrections.json` (`landmarkPins`).
- Build: `npm run map:build`. It also writes `scripts/osm/map-preview.html` (gitignored) for a top-down check.

## Rendering
- Ground: one big plane. Roads as merged ribbon meshes per 250 m chunk, slightly above the ground, with polygonOffset.
- Buildings: extruded footprints merged per chunk into one geometry with vertex colors. Frustum culling per chunk. One material: a texture atlas with one row per wall pattern (windows, old-city shuttered windows, shop fronts with signboards, campus ribbon windows, colony barred windows, sheet metal, old-city doors and shops); the shader picks the row from the style and the floor (wall v = 64 x style + floors). Shop rows are not tinted by the wall colour. Outskirts and sheds with four corners get gable sheet or tile roofs. Compound walls are in the same mesh and in collision.
- Street details (`src/map/props.ts`): black-and-yellow kerbs on trunk, primary and secondary roads and a green divider with street lights on two-way trunk and primary roads (gaps at junctions, U-turn openings every 300 m) come from the road shapes; poles, wires, trees, hoardings, temples, mosques, churches and auto stands come from `map.props`. Per 500 m chunk: one merged props mesh (hoarding atlas), one kerb mesh (stripe texture), one instanced neem mesh, one set of wire lines. Poles, tree trunks, hoarding posts, places of worship, autos and dividers are solid; kerbs are not.
- Railway (`src/map/rail.ts`): ballast and sleepers from one repeating texture, two rails at broad gauge, bridges over water 6 m high on piers with girder sides, other bridges at ground level with low side rails, overhead line masts and contact wire on electrified track, raised barrier booms where a road crosses at ground level. Masts and barrier posts are solid.
- Waterways (`src/map/waterways.ts`): KC Canal walls along both banks (gaps where roads cross), sand banks along river lines, the aqueduct over the Handri as a raised trough on piers. Culverts are not drawn.
- Terrain (`src/map/terrain.ts`): `groundY(x, z)` (bilinear on the 20 m grid) is the ground for everything: the ground mesh (640 m chunks plus a coarse skirt), roads (a point every 16 m; bridges straight between their banks; flyover lift on top), water and parks (split only where the ground bends), buildings (floor on the lowest corner), props, rail, canal walls. The collision world's `heightAt(x, z, near)` returns the ground or the deck nearest the caller's height; walls have a height range (railings only at deck height), so cars drive under flyovers. Cars tilt with the slope. Flyovers get deck slabs, parapets and piers (never on a road below).
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
