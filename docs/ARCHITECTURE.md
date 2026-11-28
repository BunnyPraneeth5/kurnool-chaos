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
  public/fonts/                Noto Sans Telugu Bold (OFL, licence in OFL.txt), loaded by src/util/fonts.ts
  tests/                       Vitest tests (npm test)
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
    // In the file edges are one flat list [a, b, road, len in decimetres, i0, i1, ...]; the loader unpacks them.
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
  police: { name: string; x: number; z: number; a: number }[] // OSM police stations: spot at the road in front, a = way the sign faces
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
| car | 34 | 15 | high | 2 x 1.0 | sedans, hatchbacks |
| auto | 18 | 9 | low | 2 x 0.75 | tippy, body rolls a lot |
| bike | 30 | 20 | medium | 2 x 0.45 | leans into turns, fits through gaps |
| bus | 20 | 6 | high | 4 x 1.25 | slow turning, long |
| lorry | 22 | 7 | medium | 3 x 1.25 | heavy, pushes cars |

Real numbers in `src/vehicles/params.ts` (also turn rate, roll, weight, camera). Collision is a row of circles along the body (`hull.ts`); in a crash with traffic or a cop, weight decides who moves. Tune in play-tests.

- Car, auto and bike get low-poly models. Bus and lorry are simple box shapes.
- Vehicle-to-vehicle collision uses each type's radius.
- Physics time step is capped at 1/30 s and split into sub-steps on slow frames, so fast vehicles never pass through walls.

## Player
- Spawn: players start spread out on a ring of road points around Rajvihar, not on one spot.
- Parked vehicles: 14 near spawn on the same spots on every screen (8 cars, then 2 autos, 2 bikes, a bus, a lorry). Rooms move the 8 cars to the lobby; rounds put player slot k in car k.
- Unstuck: R key or a touch button moves you to the nearest road point, facing along the road, speed zero.

## Controls (Phase M)
- Actions (`src/player/actions.ts`): one list (gas, brake, left, right, hand, act, horn, boost, unstuck, map) with the keys for each. `Keyboard` turns keys into actions; `TouchControls` turns buttons into the same actions; `Game` only asks `held(action)` and `pressed(action)`. `moveFrom()` builds throttle and steering from held actions, the joystick and tilt. A new move = a line in `ACTIONS`/`KEYS`, a button in `layout.ts`/`touch.ts`.
- Touch layout (`src/ui/layout.ts`): every control has an anchor corner, a centre offset and a diameter. Four layouts: portrait or landscape x joystick or pedal steering (arrows and tilt share pedals). `visibleControls(state)` decides what shows on foot, driving, riding and in map view; hidden, never greyed. Edited layouts are saved in `localStorage` `kc.controls`, only the changed layouts, merged over the defaults.
- Swipe to look (`src/player/look.ts`): drags on the canvas (phones: right of 40% of the width; laptops: left mouse button) turn the chase camera round the target and tilt it; while driving it swings back 0.6 s after letting go, on foot once you walk.
- Tilt (`src/player/tilt.ts`): `devicemotion` gravity along the screen's horizontal axis (by screen rotation), sin of about 20 degrees = full lock, 1.7 degree dead zone; iPhones flip the sign and ask permission from a tap. Centred each time you get in and from Settings. No data or refused: a message, no fallback.
- Haptics (`src/ui/haptics.ts`): `navigator.vibrate` on button presses (12 ms), getting in and out (20 ms), crashes (25 to 90 ms) and smashing borders (40 ms); at most one buzz per 60 ms; Vibration setting.

## Traffic and cops (local only)
- Code: `src/ai/graph.ts` (road graph, lanes, A*), `agent.ts`, `traffic.ts`, `cops.ts`, `life.ts`. Computer vehicles move along road polylines, not wall physics; a knock pushes them up to 2.5 m aside and they drift back.
- Traffic follows the road graph on the left lane: offset to the left of the edge direction, ends trimmed so they curve through junctions. Picks a random legal next edge at nodes (bigger roads more often; buses and lorries keep to roads 9 m+). Slows for bends, stops for vehicles and people ahead, steers round parked vehicles, ghosts through after 5 s stuck (demo logic). 20 on low, 32 on high, spawned 120 to 300 m away and removed past 360 m. Walk up to one and get in to take it.
- Cops spawn on graph nodes 140 to 320 m away when heat rises. Chase along the graph using A* to the player's nearest road point, recomputed about once a second (greedy steps get stuck at dead ends); they may drive against one-way roads. Switch to direct pursuit with line of sight under 30 m. Busted after 1.3 s stopped within 7 m. 10 s more than 58 m from every cop drops a star; new heat first gives them 20 s to arrive. No local cops during a game round you are in.
- Heat triggers: taking a vehicle out of traffic, hitting another vehicle hard, hitting a cop (at most once every 3 s). Up to 3 stars, one cop per star.
- Junctions (H.6, `src/ai/junctions.ts`, `src/map/signals.ts`): busy junctions found from the graph (4+ ways, 3+ main roads, one trunk or primary; nodes within 25 m merged). Arriving lanes are grouped into two directions; a 34 s cycle (12 s green, 3 s amber, 2 s all red each) runs from Date.now() plus a per-junction offset. Traffic stops at the end of its lane unless green. Raj Vihar and C-Camp get a traffic policeman on a solid stand instead of lights. Poles are solid; poles and lamps are merged per 500 m chunk.
- Traffic behaviour (H.7): honks when held up, overtakes on the right on two-way roads 9 m+ wide with 70 m clear, buses pull in every 300 m on main roads, autos at auto stands; passengers on some bikes and autos.
- Pedestrians (H.8, `src/ai/pedestrians.ts`): instanced, 25 low / 50 high, walking the road edges along graph edges, crossing at road ends, pushed clear of vehicles; traffic stops for those in the road.
- Cops (H.9): at 2+ stars they lead the player by up to 1.5 s and ram; at 3 stars a two-car roadblock about 160 m ahead along the player's road; bike cops in lanes 7 m wide or less.
- Sound (H.7, `src/audio/sound.ts`): Web Audio playing the CC0 recordings in `public/sounds/` (297 KB; list, sources and loop points in `src/audio/clips.ts`). Downloaded at boot, decoded on the first tap or key. An engine loop per vehicle type (playback speed follows speed), held and traffic horns (panned), siren by distance, crash, beeps. A file that fails to load is named in a box with Retry; no generated fallback.
- Chaos points (H.10, `src/modes/chaosPoints.ts`): local; see DECISIONS for values.
- HUD (`src/ui/minimap.ts`, `hud.ts`): minimap top right (roads, water, parks, runway and landmarks drawn once at 6 m per pixel; turns with the camera; cops, friends, game target; tap for the whole city), heat stars beside it.
- Police vehicles say "POLICE" only. No real department logos.

## Moves and fighting (Phase M, tasks M.6 to M.12)
- On foot (`src/player/onFoot.ts`): jump (7.4 m/s up, gravity 20: about 1.4 m), falls of up to 8 m with gravity (bigger drops are teleports and snap). Collision walls carry a height (`top`; breakables by kind: cone 0.75, barricade 1.0, railing 1.1, fence 1.8, planter divider 0.65, flyover barrier 1.0); `collide(..., clear)` skips walls lower than the feet's height above the ground. Jumping against a vehicle (not a bike) whose roof is under 3.4 m above your feet climbs onto it (`game.keepOffCars`); `roofAt` lets you stand and walk on roofs. Crouch 2 m/s; roll (crouch while running) 0.45 s at 10 m/s, no damage. Emotes: wave, dance, point, namaste. The body pivots at the waist for rolls and falls.
- Health (`src/combat/health.ts`): 100; comes back at 12/s after 8 s without a hit; at 0 you lie 5 s, lose a tenth of your chaos points (at least 20) and get up at the nearest hospital with full health and ammo, 2 s shield. Riders take no damage; a driver's hits go to the vehicle (60%).
- Hospitals: `map.hospitals` (84 OSM amenity=hospital, a spot at the road in front of each, like police stations); signboards are two instanced meshes with one shared texture.
- Weapons (`src/combat/weapons.ts`): fists (every third hit a kick), cricket bat, lathi, pistol, shotgun, water balloon, tomato, firecracker; numbers there are shown in the guide. Start: fists, bat, pistol. 60 pickup spots seeded from the map (`src/combat/pickups.ts`, same on every screen, at least 180 m apart, back 90 s after taken on your screen; 12 nearest drawn). Ammo refills at police stations (every 30 s) and on getting up.
- Attacks (`src/combat/combat.ts`): aim is the camera's way (`game.aimYaw`); aim assist picks the best target in a cone (0.35 rad, phones 0.55) with a clear line. Melee hits one person per swing within reach and arc; fists on a slow traffic vehicle carjack it (driver becomes a running pedestrian). Guns are hit-scan rays stopped by walls; drivers shoot out of the side window the camera faces, riders anywhere. Throwables fly with gravity 20 from a 45 degree launch (`throwVelocity`), land on walls or the ground; firecrackers go off 0.8 s after landing (blast falls off with distance; vehicles damaged, traffic shoved, people knocked over and scared).
- Vehicle health (agents and `Vehicle`): crash damage `(impact - 3)^2 x 0.35 / sqrt(mass)` (impact = speed lost in a hard hit); dented look below 60, smoke below 50, wrecked at 0 (stops, burns; one more hit or 8 s burning blows it up: blast 5 m, 40 damage). Looks swap between three shared materials. Wrecked shared parked vehicles go back home 2 minutes after the wreck (local timer on each screen).
- Cops on foot (`src/combat/officers.ts`): heat stops at 3 stars, so at 2+ stars a chasing cop within 30 m of you on foot parks and an officer (khaki, 60 health, down 10 s when beaten) runs after you at 6.2 m/s; sees you within 45 m (14 m crouched) with a clear line, checked 4 times a second; gives up after 4 s out of sight (2 s crouched); busts you after 1.2 s within 1.5 m while you stand still; at 3 stars shoots every 1.4 s within 30 m (hit chance 55%, crouched 30%, rolling 0), 8 damage. Up to 3 officers.
- Performance (M.13): an on-foot figure is 6 meshes (torso, head and hair merged; 4 limbs; shadow) plus one for a held weapon, all on shared vertex-colour materials with cached geometries. Low quality: smaller effect pools (12 tracers, 8 flashes, 12 splats, 4 blasts, 24 puffs), 3 puffs per blast, smoke every 0.25 s, 6 pickup crates drawn. Automatic slow-down (`src/world/autoQuality.ts`, wired in `main.ts`): 10 one-second samples under 25 fps in a row (real frame time, not the capped one; not hidden, not in the menu, not the first 8 s) step down once: pixel ratio 1, then 0.75, then half the traffic and pedestrians (`count` on both, farthest removed first); a toast says so, and Auto saves Low for the next load. Off when the player picked High or a `?quality=` link is used.
- Effects (`src/combat/effects.ts`): fixed pools made once (24 tracers, 16 flashes, 24 splats, 6 blasts, 60 puffs, 8 thrown things, the throw arc): nothing is created per shot.

## Multiplayer (Supabase Realtime)
- Room URL: `/?room=ABC123`. 6-char code, uppercase letters and digits without 0/O/1/I.
- Channel: `room:ABC123` with `config: { broadcast: { self: false }, presence: { key: playerId } }`.
- Start screen without a room link: nickname + Create room / Join with code / Play alone. A room link goes straight to the nickname box.
- Presence payload: `{ id, nick, slot, joinedAt }`. Each player takes the lowest free slot 0..7; the slot sets their colour and their spawn point on the ring around Raj Vihar.
- Broadcast event `s`: `{ id, t, x, z, y, h, v, mode, car }` where `t` is the sender's `Date.now()`, `mode` is the vehicle type (car, auto, bike, bus, lorry) or `foot`, `h` is heading in radians and `car` is the index of the shared parked vehicle being driven (-1 on foot, -2 for one taken from your own traffic). Keep it small. Rate adapts to the room: 5 Hz up to 4 players, then 80 / N² Hz (1.25 Hz with 8), nothing when alone. While standing still, send only a heartbeat every 2 s.
- Remote players: buffer snapshots, map sender `t` onto the local clock using local receive times (fastest message seen), render one send interval + 100 ms in the past (300 ms at 5 Hz), interpolate position and heading. Hide players missing for 5 s.
- Parked cars are on the same spots on every screen, so when a friend drives parked car k, your copy of car k is hidden, theirs is drawn in its colour, and it stays where they leave it.
- Remote vehicles are solid for you: you bounce off them like a wall. You cannot push them.
- Phone lock or app switch (`visibilitychange`): on return, cap the time step, rejoin presence, show "Reconnecting" until the channel is back.
- Riding along (H.4): seats per vehicle in `params.ts` (bike 2, auto 3, car 4, lorry 3, bus 8). A rider sends state `s` with `mode: 'ride'`, `ride` (driver id) and `seat` (1 and up) and the driver's position; every screen draws a seated figure in that seat of the driver's vehicle (`models.ts` SEATS). Seats are taken from what each rider sees; two on one seat: the earlier joiner keeps it. During a round only the same team may ride together; in Landmark hunt the whole vehicle scores.
- Round timers: on waking from sleep, timers move on by the time `performance.now()` missed (Date.now() difference), and a guest sends `g` `{ k: 'sync' }` so the host resends the state.
- Room controls: the host is the earliest `joinedAt` in presence (passes on automatically). Broadcast `c` `{ id, text }` or `{ id, e }` is chat or an emote (8 fixed emotes, text up to 80 chars, at most one message per 0.8 s per player). Broadcast `k` `{ by, target }` is a kick; clients accept it only if `by` is the host in their own presence list, then hide and ignore the target. The kicked client leaves, shows "You were removed", and remembers the room in localStorage for 10 min. If the target's client ignores it, the host repeats the kick whenever presence changes so newcomers hide them too. Block is local only (hide the player, ignore their chat). Go to puts you 7 m behind the friend, on the nearest road if within 15 m.
- Lobby (G.1, `src/modes/lobby.ts`): rooms gather on the real Jagannatha Gattu summit, found as the highest terrain point within 150 m of a pin (15.76463 N, 78.03279 E). A paved plaza (24 m, follows the ground) with a black-and-yellow kerb and an English + Telugu signboard facing Raj Vihar; the 8 shared parked cars stand in a ring on it, players spawn on a 9 m ring. Round start spots stay in the city around Raj Vihar; after results everyone goes back to the plaza. Solo play is unchanged (Raj Vihar).
- Game rounds (Phase G, `src/modes/`): broadcast `g` carries `{ k: 'state', s }` from the host (whole round state: round, rev, phase lobby/countdown/playing/results, mode, mins, ready, players, scores, roles, mode data, `leftMs` and `elapsedMs` as durations at send time), `{ k: 'ready', on }` and `{ k: 'claim', c }` from anyone. The host is the referee: it starts rounds, checks claims against its own view of positions (a catch within 15 m, a landmark within 90 m), keeps scores, and resends the state every 4 s and when someone joins. Everyone moves themselves to their start spot in parked car = their slot, held during the 3.5 s countdown (and police for 10 s more). A player who drops out briefly still counts as present for 15 s. If the host leaves, the next host carries on from its last state.
- More modes (H.10, H.11): Chaos (cops on; each player sends `{ k: 'claim', c: { kind: 'chaos', points } }` every 3 s; the host keeps them and sends them with the 4 s keep-alive, not at once), Hill climb (course from the road route summit -> Raj Vihar, start where the ground is 115 m below the summit; `finish` claims checked within 60 m of the summit), Chor–Police `escape` claims and `lastChor`, Landmark hunt targets with `cps` (Raj Vihar) or `gate` (fort).
- Events: `race_setup`, `race_start` (sends `delayMs`, about 5000; each client starts its countdown when the message arrives, because phone clocks differ), `race_finish`.
- Limit: 8 players per room, soft cap. A newcomer that finds 8 others in presence leaves with "Room full" before announcing itself; players already in are never kicked. Presence can briefly disagree, so a 9th can slip in when two join at once.
- Fighting on the state message `s` (Phase M): `a` (on foot: crouch, roll, down, swing, fire, emote, weapon packed in 16 bits, `src/net/acts.ts`), `vd` (driving: vehicle health, -1 blown up) and `hits` ([victim id, damage, weapon], at most 8, collected since the last message). Pending hits make the state count as changed, so they go out at the normal send rate: no extra messages, so fighting never adds to the budget below. The receiver applies hits for its own id once per message (sender time), only if the hit rule (`src/combat/rules.ts`) allows it. A friend's `fire` going on draws a tracer from their hand (their screen decides hits). Event `w` (`{ from, i, x }`): a shared parked vehicle wrecked (x 0) or blown up (x 1); rare. Late joiners do not get wrecks (they come back after 2 minutes anyway).
- Message budget (free plan, checked 2026-11-25): 2 million messages per month, 100 per second; one broadcast counts 1 + 1 per receiver, so N players at f Hz cost f x N² per second. The adaptive rate keeps a full room near 80/s. See DECISIONS.md.

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

## Roads and borders (Phase R)
- `src/map/borders.ts` (data, cached per map) and `src/map/bordersMesh.ts` (meshes, 250 m chunks). Dividers: twin one-way roads (opposite-direction samples 0.5 to 14 m apart are joined by a median), two-way trunk/primary (12 m+) and secondary (11 m+) roads, flyover and bridge centre barriers (walls at deck height). Kerb lines (shared with props.ts) and railing-divider bases are kerb walls. Footpaths, islands, speed breakers (`props.bumps` from the build) and embankments are raised surfaces in `heightAt`.
- Collision world: walls have a kerb flag (block only vehicles under 7 m/s); breakable pieces have ids, a grid and a broken flag with a fix time; `collide(x, z, r, y, { speed, heavy })` returns the pieces a fast vehicle went through. Fixed 2 minutes after breaking.
- Network: broadcast `b` `{ from, l: [[id, msLeft], ...] }` for new breaks; the host sends all open breaks when someone joins.

## Menu and guide
- `src/ui/menu.ts`: Menu button (top left), Esc, G for the guide. Pages: Guide (`guide.ts`), Settings (`settings.ts`, saved in localStorage `kc.settings`: quality, camera distance, steering, minimap), Room (the room panel from `roomHud.ts`), Stats (`stats.ts`, this session), About (version from package.json, credits). Leave room / Exit at the end. Solo play pauses while it is open; in rooms the player stands still.
- The guide reads vehicle numbers from `params.ts` and places from the map, so it stays true; vehicle pictures are drawn once with the game's renderer.

## Errors
No blank screens. Each failure shows a plain message with a Retry button:
- Map file missing, unreadable or fails validation.
- Supabase env vars missing, or the Realtime channel fails to connect.
- Room full.

Nicknames and any player text are shown with `textContent`, never `innerHTML`.

## Env
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` in `.env.local` and in Vercel project settings (Production and Preview). No `VITE_` prefix, because Vercel refuses key-like variables with a public framework prefix; `vite.config.ts` bakes exactly these two names into the game at build time and nothing else. Both are public by design. Security comes from RLS. Never add the Supabase secret key to this list.

## Open questions
- Exact bounding box and landmark coordinates: confirm with Bunny in task 1.3.
- Telugu spellings: Bunny verifies.
- Whether OSM has enough Kurnool buildings or we lean on generated filler: decide after first export.
- Race preset routes: pick after the map is built.
