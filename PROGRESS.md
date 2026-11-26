# Progress log

Newest entry on top. Each session ends with an entry: what got done, what is half done, what is next, any blockers or questions for Bunny.

## 2026-11-27: Phase G (G.2-G.4) and Phase K merged into main (coordinator)
- Merged `claude/multiplayer-0fc95f` (G.2-G.4 + G.1 plan, clean) and `claude/accuracy-dab84d` (K.1-K.5, 5 conflicts). Resolved: DECISIONS/PROGRESS/style.css keep both sides; `onFoot.ts` keeps the ground follow (hills) plus `animate()` for friends; `unstuck()` uses `Game.teleport()`, which now calls `settle()` so cars land on slopes.
- Found and fixed: a stale gitignored `scripts/osm/raw.json` (old box) shadowed `raw.json.gz`, so `map:build` gave a different map. `loadRaw()` now ignores a raw.json from another box; `map:build` on main reproduces the committed `kurnool.json` and `terrain.bin` byte for byte. Added to CLAUDE.md Gotchas.
- Checked: typecheck and build pass; localhost, 2 tabs in one room on the new terrain (name tags, room panel, game card, player height follows ground); street level on low draws 75-90k triangles in 53-61 calls. Live updated (map 1.92 MB + terrain 0.35 MB brotli), loads with no console errors.
- Open: Bunny's phone check on the live link (ticks K.1-K.3, K.5); K.4 needs the Abdullah Khan Estate pin; G.1 handed to the multiplayer session; G.5 only if Bunny wants it; Telugu spelling for the Jagannatha Gattu sign.

## 2026-11-26: Phase 3 merged into main (coordinator)
- Merged `claude/multiplayer-0fc95f` (head 55fafc3, tasks 3.1 to 3.4 plus the Phase G plan) into `main` with no conflicts. Checked before merging: only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` reach the browser (allowlist in `vite.config.ts`), no keys committed. After merging: typecheck and build pass; on localhost with the real Supabase project, two tabs joined the same room from the link and both saw each other in the room panel (host badge shown).
- `CLAUDE.md` updated to match: no `VITE_` prefix for the two Supabase values, broadcast rate lives in ARCHITECTURE.
- The accuracy branch is still open; when it merges, `DECISIONS.md`, `PROGRESS.md` and `src/style.css` need both sides kept.

## 2026-11-26: Tasks G.2 to G.4 (lobby and round flow, Chor–Police, Landmark hunt)
- Done: `src/modes/` (types, round flow with the host as referee, `hunt.ts`, `chorPolice.ts`, `ui.ts` lobby card / countdown / round bar with arrow / results, `visuals.ts` target light pillar and police light bar), room event `g`, `Game.locked`, `driveCar()`, `toFoot()`, ready/role/score badges in the player list. One commit for all three tasks, because the round flow, the UI and both modes are woven together.
- Checked with 2 then 3 tabs (render loop pumped by a timer because the pane was hidden): lobby card for host and guest, Ready ticks, "Start anyway?" when not all ready; countdown holds both players in their slot's car; Landmark hunt: 3 targets, guest's claim accepted by the host, targets advance for both, beacon on the current target, round ends after the last target, results (Chandu 2, Anna 1), back on foot at the lobby spot after 10 s. Chor–Police: roles 1 police / 1 chor, police held 10 s with "you can go in 9 s", chor starts 312 m out, light bar on the police car on both screens, catch turns the chor police (scores 30 / 35), round ends with no chors left. A third tab joining mid-round waits ("you'll join the next round"); host leaving mid-round hands over and the next host's updates are accepted.
- Fixed while testing: a brief dropout ended Chor–Police at once (now 15 s grace); results named a player who had left "Someone".
- Bunny check: game modes on phone + laptop on the branch preview (commit 09e73dd): "works well". G.2, G.3, G.4 ticked.
- Next: coordinator merges `claude/multiplayer-0fc95f` into `main`. G.1 (lobby on the real Jagannatha Gattu from the accuracy track's terrain) waits for the accuracy branch to be merged; Bunny to confirm using the real hill and the Telugu spelling.

## 2026-11-26: Phase G planned
- Bunny wants a lobby where the host picks a game mode, like a hangout before each round, on Jagannatha Gattu hill. Planned Phase G in TASKS.md (G.1 hill, G.2 lobby and round flow, G.3 Chor–Police, G.4 Landmark hunt, G.5 King of the circle).
- Found: Jagannatha Gattu (IIITDM campus, 15.7532 N 78.0349 E) is 1.9 km past the south map edge and 8.4 km from Raj Vihar; the game world has no hills.
- Agreed order: merge Phase 3 into `main` first, then G.2 to G.4 with Raj Vihar Circle as the lobby spot, then G.1 after Phase K is merged.

## 2026-11-25: Task 3.4 Room controls (Bunny's request after 3.3)
- Done: `src/net/roomSession.ts` (room wiring moved out of main.ts), `src/ui/chat.ts`, player menu in `src/ui/roomHud.ts`, host/kick/chat/rename/leave in `src/net/room.ts`, block and speech bubbles in `remotePlayers.ts`, `Game.teleport()`, keyboard ignores typing in text boxes.
- Checked with 2 tabs and a test bot: host badge; chat both ways (HTML shown as text), emote bubbles appear on arrival, second message within 0.8 s refused; rename shows in list, tag and a notice; Go to lands 7 m behind the friend; Block hides model, tag, collisions and chat, Unblock brings them back; guests get no Kick; host Kick (asks "Kick?") shows the kicked tab "You were removed" and the rejoin is refused for 10 min; a bot that ignores the kick stays hidden, also after the host passes on; host Leave returns to the start screen and the next player gets "You are now the host"; T opens chat, typing W does not drive, Esc closes; solo Exit returns to the start screen.
- Bunny check (2026-11-26): room controls on phone + laptop on the branch preview (kurnool-chaos-d49ntah67, commit 24bfe06): "works well". 3.4 ticked.
- Next: coordinator merges `claude/multiplayer-0fc95f` into `main`.

## 2026-11-25: Phase 3 Multiplayer (tasks 3.1 to 3.3, branch `claude/multiplayer-0fc95f`)
- 3.1: Supabase project `kurnool-chaos` created on Bunny's account (free plan, Mumbai, ref lpafbvfxmbapagjozlvt). `.env.local` written (gitignored). `@supabase/supabase-js` 2.119 added, loaded only when playing in a room. Free-plan Realtime limits logged in DECISIONS (2M messages/month, 100/s; a broadcast counts 1 + 1 per receiver). Checked: the app joins a room channel with the publishable key; missing key shows "Multiplayer is not set up"; an unreachable server shows "Could not connect to the room" with Try again.
- 3.2: start screen (nickname + Create room / Join with code / Play alone), room links skip to the nickname, room panel with code, Share button and player list, soft 8-player cap ("Room full" checked with 2 tabs + 6 bots + a 9th tab), lowest free slot sets colour and spawn on a ring around Raj Vihar (8 points, 14.7 m apart at least). Checked with 2 tabs: both see the list and spawn 31 m apart. Nicknames shown with textContent (tested with `Bunny<b>`).
- 3.3: adaptive send rate (5 Hz up to 4 players, 80/N² above, 2 s heartbeat when idle, nothing when alone), interpolation one interval + 100 ms behind, remote car and on-foot models with name tags, friends' cars are solid (my car got shoved 7.5 m and never came closer than 3.0 m), friend driving parked car k hides my copy and leaves it where they park, recovery after phone lock.
- Checked with a Node test bot driving known circles: at 12 m/s drawn angular speed 0.600 ± 0.002 rad/s (true 0.6), under 5 cm off the path; at 25 m/s (90 km/h) drawn speed 25.19 m/s ± 0.08. Faked a 10 s phone lock: "Reconnecting…" then back online in 0.6 s, friend visible again; same with the socket killed while hidden. Idle heartbeat about every 2.5 s. Solo play unchanged and never downloads Supabase.
- Vercel: Bunny added `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (Production and Preview, type Sensitive) at 10:39 UTC. Renamed from `VITE_...` because Vercel refused the public prefix on a key. Branch previews built before then have no Supabase settings.
- Bunny check: phone + laptop played together in one room on the branch preview (kurnool-chaos-cg1ds5h24, commit dcbac1e): "works well". 3.1, 3.2 and 3.3 ticked. Also checked on that preview with a test bot: join, player list, name tags, updates both ways.
- Next: coordinator merges `claude/multiplayer-0fc95f` into `main`. Then friends can use the main site (preview links need a Vercel login).
- Known v1 limits: parked cars moved before you joined are at their original spots for you; `CLAUDE.md` modules list still says 10 Hz (ARCHITECTURE has the real rate).
## 2026-11-26: Map extended south to Jagannath Gattu (accuracy track)
- Bunny asked to include Jagannath Gattu. Box south edge 15.770 -> 15.748 (9.6 x 13.5 km). Re-downloaded OSM (main, wide, details), Overture (80,207 outlines) and the Earth Engine layers for the bigger box.
- Build: 73,801 buildings (14,970 OSM, 53,750 Overture, 5,165 filler), 5,038 roads, 49 places of worship, 18 flyover ways and 10 underpasses, 4 OSM level crossings. Terrain reaches 153 m above Raj Vihar on the hill (434 m above sea level). kurnool.json 5.95 MB (1.76 MB gzipped; graph edges now packed), terrain.bin 0.94 MB. Rebuild identical. The airport link now starts from NH40 in the south-east (the real airport is on NH40).
- Checks: typecheck and build pass; autopilot 7 routes including C-Camp to the top of Jagannath Gattu (8.2 km, climbs to 153 m): 0 stuck. Low quality street level: avg 85k, max 108k triangles. No console errors.
- Still waiting for Bunny: phone check, Abdullah Khan Estate pin, wrong spots, KC Canal city width, photos for landmarks (4.1) and typical streets.

## 2026-11-26: Task K.5 part 3, terrain, flyovers, underpasses, satellite rivers (accuracy track)
- Bunny reported inaccuracies (KC Canal, rivers, railway, station platforms shown as houses, bridges, flyovers, underpasses) and asked for real ground highs and lows, using Google Earth Engine data where it beats OSM.
- Terrain: Copernicus DEM GLO-30 from Earth Engine (roofs and trees removed), 20 m grid in `public/map/terrain.bin` (0.77 MB). Raj Vihar is 281.7 m above sea level; the city slopes north to the Tungabhadra (-20 m) and rises to the south-east hills (+35 m in the box). The ground, roads, water, parks, buildings, props, railway and canal walls all sit on it; cars and the player follow it and cars tilt on slopes; chase and map cameras stay above hills; fog and near plane use height above the ground.
- Rivers: water outlines traced from the Dynamic World water map (53 outlines, 7 with islands), sandy river bed where the river is dry. Ground under water lowered to the water level.
- Flyovers and underpasses: 11 OSM bridges that cross a road or the railway are raised 6.5 m with ramps (47 ramp ways), deck slabs, parapets and piers; 10 OSM underpasses are dug 5.5 m under the railway, which stays level on its bridges. Collision is height-aware: cars drive under flyovers and stay on them. Level crossings only from OSM (3).
- OSM details re-downloaded: now include 2 platforms, the station building and 3 level crossings (the station is barely mapped in OSM).
- Checks: typecheck and build pass; map and terrain rebuild identical. Autopilot (real car physics, left lane): Raj Vihar - fort - station - bus stand - GGH - C-Camp, and fort - Tungabhadra bridge (through the NH44 flyover underpass that blocked before): 0 stuck. Low quality street level: avg 81k, max 111k triangles, 45-74 draw calls (was 62k / 101k). No console errors. Credit fits on phones (portrait and landscape).
- Station (second commit): 11 buildings on the tracks dropped; 7 platforms with maroon sheet shelters on columns (2 from OSM, 5 from satellite outlines of platform roofs beside the tracks); no more houses on the platforms. Autopilot 6 routes still 0 stuck; triangles unchanged.
- Waiting for Bunny: phone check of the preview (30+ fps on low), his list of any remaining wrong spots, the Abdullah Khan Estate pin, and the KC Canal width in the city if he knows it.

## 2026-11-25: Task K.5 part 2, satellite heights and water widths (accuracy track)
- Bunny registered Google Earth Engine (free noncommercial Community tier, valid to May 2028) and signed in on the laptop (the first two sign-ins failed because two sign-in listeners were waiting on the same port; the third worked). `earthengine-api` installed as a uv tool.
- Done: `scripts/osm/earthengine.py` downloaded Google Open Buildings 2.5D heights (2023, 4 m grid, 2411 x 2767) and Dynamic World water probability (5 m grid) into committed snapshots (0.86 MB + 0.40 MB). `build.mjs` gives 58,902 buildings their satellite height (70 keep OSM levels, 7,585 not seen by the satellite keep their style height). Floors now 1: 29k, 2: 26k, 3: 8k, 4: 2.1k, 5: 0.6k, 6+: 0.5k; median 5 m, tallest 67 m.
- Water widths measured every 20 m: KC Canal west reach 29 m, its unnamed head reach 36 m, Handri 41 m; satellite water centres are 1 to 5 m from the OSM lines, so the OSM positions are right. The KC Canal city reach is too narrow for 10 m pixels and stays 12 m. Widths depend on the threshold (see DECISIONS), so they are approximate.
- Credit now adds "Google Open Buildings, Dynamic World" (CC BY 4.0); on phones it is 9 px and sits under the joystick and buttons (checked portrait 375x812 and landscape 740x360).
- File 5.67 MB (1.58 MB gzipped), rebuild identical (sha256 1789e6b3be8a7a9b). Autopilot 5 routes: 0 stuck, 0 crashes. Low quality street level: avg 65k, max 99k triangles. No console errors.
- Waiting for Bunny: phone check of the preview; the real width of the KC Canal in the city (if he knows it) and the Abdullah Khan Estate pin for K.4.

## 2026-11-25: Task K.5 Railway, KC Canal and rivers, part 1 (accuracy track, Bunny's request)
- Done: `src/map/rail.ts` draws the OSM railway: 15 runs (main line and station sidings), ballast with sleepers and two rails at broad gauge, the 897 m Tungabhadra rail bridge and the Handri rail bridge 6 m high on piers with girder sides, overhead line masts and contact wire on the electrified line, raised red-and-white barrier booms at the 20 places where roads cross the track at ground level. `src/map/waterways.ts` draws concrete walls along the KC Canal (gaps where roads cross), sand banks along the Handri and other river lines, and the KC Canal's 241 m aqueduct over the Handri as a raised trough on piers. Build: rail keeps OSM bridge/electrified/siding tags, waterway centre lines are kept, culverts are not drawn as water, 20 buildings standing in water dropped, the mistagged "site1" rail loop skipped.
- Also fixed: kerbs, dividers and canal walls lost their corners (cut by about a metre).
- File 5.74 MB (1.55 MB gzipped), rebuild identical (sha256 c091fc9a7f44f298).
- Checked in the game: screenshots of the main line with masts and wires, the Tungabhadra rail bridge, the aqueduct, a canal stretch with wall gaps at a road, a level crossing. Autopilot over the 5 routes (8.8 km): 0 times stuck, 0 crashes. Railway and waterways add about 2.8k triangles on average (low quality, street level: avg 67k, max 107k this run). No console errors.
- Still to do: KC Canal and Handri widths are still guesses (12 m, 30 m) until Earth Engine water maps; Bunny is registering (free Community tier, organisation type "Other").

## 2026-11-25: Task K.4 Corrections file, half done (accuracy track)
- Done: `scripts/osm/corrections.json` (with a help list inside) applied by `build.mjs`: landmark pins, remove buildings (under a point or within a radius), add buildings (outline, floors, style), river and canal widths by name, and circles kept free of props. The build report lists every correction; one that matches nothing (for example a misspelt canal name) stops the build with an error. Tested all five kinds with a temporary file, then restored it: with no corrections the map is identical to K.3 (sha256 614b792dca17a2af).
- Waiting for Bunny: the Abdullah Khan Estate pin (lat, lon from Google Maps) and any wrong spots he has seen (buildings that should not be there, missing buildings, canal or river widths). K.4 needs at least one real correction before it can be ticked.

## 2026-11-25: Task K.3 Street details (accuracy track)
- Done: `src/map/props.ts` draws black-and-yellow kerbs on trunk, primary and secondary roads, green dividers with double-arm street lights on two-way trunk and primary roads (gaps at junctions, U-turn openings every 300 m), concrete electric poles with wires, neem trees, hoardings with generic ads (SAREES, GOLD JEWELLERY, MOBILES, CEMENT...), temples (platform, hall, stepped tower, flag post), mosques (green dome, two minarets) and churches (tower, spire, cross), and auto stands (four green and yellow autos and an AUTO STAND board). `build.mjs` places 15,950 poles in 3,955 wired runs, 11,199 roadside trees, 168 hoardings, 38 places of worship (27 temples, 7 mosques, 4 churches; 31 replace the small building under the OSM point, 12 skipped for lack of room) and 6 auto stands (bus stand, station, Raj Vihar, C-Camp, GGH/KMC, fort area).
- Solid: poles, tree trunks, hoarding posts, worship models, autos and dividers are in collision; kerbs are not.
- File 5.73 MB (1.55 MB gzipped), rebuild identical (sha256 614b792dca17a2af). Pole runs are delta-coded.
- Also fixed: a faint seam at floor lines on building walls (atlas filtering picked up the next row).
- Checked in the game: screenshots of a main road (kerbs, divider, lights, shops, neem trees), Risaldar Masjid, Venkateswara Swamy Temple, a hoarding and the bus stand auto stand. Autopilot with the real car physics on the left lane: Raj Vihar to fort, station, bus stand, GGH and C-Camp (8.8 km), 0 times stuck, 0 crashes. Unstuck next to divided roads never lands in a divider (8 of 8 then drive off). High quality: lit windows, glowing signboards, no console errors.
- Measured on the laptop, low quality, street level at 7 landmarks x 4 headings: 44k to 101k triangles (avg 62k, was 46k), 39 to 59 draw calls, 3.4 ms per timed frame. The worst view (fort, 101k) is still inside the 90k to 115k that Bunny's phone ran at 60 fps on low in task 2.3. Of the fort view: buildings 42k, ground 18k (unchanged), neem trees 13k, props 12k, roads 9k.
- Waiting: Bunny's phone check on the preview link.

## 2026-11-25: Task K.2 Kurnool-style buildings by area (accuracy track)
- Done: new `npm run osm:details` (`scripts/osm/fetch-details.mjs`, shared Overpass client in `overpass.mjs`) downloaded OSM land use, shops, amenities, place names, power lines and trees into the committed `scripts/osm/details.json.gz` (85 kB, 1061 elements, 10 min on private.coffee). `build.mjs` gives every building a style; `src/map/buildings.ts` draws each style with its own colours and wall pattern from one texture atlas (still one draw call per chunk), `src/map/buildingStyle.ts` holds the style ids and the compound-wall shape shared with collision.
- Styles: colony 40,856 (6,633 with compound walls and a gate facing the road), outskirts 10,562 (village houses, about half with gable sheet or tile roofs), old city 7,803 (Budhwar Pet, Khadak Pura, Qila, N R Peta, Kotha Peta, Marwari Street, Chatri Bagh, Bada Padakhana, Bangar Pet, Old Bus Stand Area, around the fort: 2-3 floors, shuttered windows, doors and small shops below), market 3,451 (shutters, open shops and colourful signboards on the ground floor along main and market roads: Raj Vihar, Park Road, bus stand), industrial 2,099 (sheds), campus 1,069 (ribbon windows), plain 767. Heights without real data follow the style.
- File 5.44 MB (1.43 MB gzipped), rebuild identical (sha256 fa30d0bf349c9118).
- Checked in the game: screenshots of old city, a Raj Vihar market block, a colony house with its wall and gate, and Peddapadu's sloped roofs look clearly different. Walking into compound walls from the back stops at the wall (12 of 12); walking in through the gate reaches the yard (11 of 12, one house sits too close to its wall).
- Measured on the laptop, low quality, street level at 7 landmarks x 4 headings: 34k to 77k triangles (avg 46k, was 55k after K.1 because colony and village houses got lower), 1.8 ms per timed frame. Live fps not measurable here (pane hidden, browser throttles it).
- Waiting: Bunny's phone check on the preview link.

## 2026-11-25: Task K.1 Real building outlines (accuracy track, branch claude/accuracy-dab84d)
- Done: `scripts/osm/overture.py` downloads Overture Maps buildings (release 2026-11-18.0, pinned) for the map box into the committed `scripts/osm/overture-buildings.json.gz` (4.1 MB, 73,949 outlines: Google Open Buildings 48,615, OSM 17,739, Microsoft ML Buildings 7,595). `build.mjs` keeps OSM first, then adds Overture outlines that are not on an OSM building, with the same road clean-up; filler only where neither source has buildings.
- Build: 66,607 buildings = 15,322 OSM + 47,650 Overture (40,876 Google, 6,765 Microsoft, 9 newer OSM; 8,019 shrunk off roads) + 3,635 filler (was 11,578). Skipped Overture: 17,216 already in OSM, 7,350 blocking roads, 1,630 tiny. Overture has almost no heights for Kurnool (2 heights, 73 floor counts, all on buildings OSM already had), so heights stay seeded.
- File: version 2 with packed building outlines (decimetre deltas, unpacked in `loadMap.ts`): 5.02 MB, 1.39 MB gzipped (was 4.08 / 0.98). Rebuild identical (sha256 320536fe27b95d38).
- Credit now "© OpenStreetMap contributors, Overture Maps Foundation" in-game and in `meta.credit` (Overture buildings are ODbL). Fits on one line under the buttons at phone width.
- Measured on the laptop, street level at 7 landmarks x 4 headings: low quality 39k to 77k triangles (avg 55k), 33 to 48 draw calls, 2.9 ms per timed frame (Intel UHD); high 43k to 83k. Was 40k to 66k before. Boot 2.8 s on the laptop.
- Waiting: Bunny's phone check on the preview link (30+ fps on low) before ticking K.1.

## 2026-11-25: Parallel work set up
- Bunny chose to run accuracy and multiplayer at the same time. Added Phase K (K.1 to K.4) to TASKS.md; 4.1 now uses Bunny's photos. Two sessions start from this commit, each on its own branch: "Kurnool accuracy" (K.1 onwards) and "Multiplayer" (3.1 onwards). This session coordinates and merges into `main`.
- Rules for both: commit and push only to your own branch (Vercel makes a preview link per branch), never merge into `main`, only tick your own tasks, add your own PROGRESS entries.

## 2026-11-25: Task 2.6 Deploy
- Bunny check: "everything looks nice", 2.6 ticked. Main feedback: the street layout matches, but buildings and everything inside the city do not feel like real Kurnool yet. Bunny wants a low-poly but accurate Kurnool. Plan options presented (real building outlines, Kurnool-style buildings and street details, landmark models from photos, corrections list); waiting for Bunny's decision on when.
- Live: https://kurnool-chaos.vercel.app/ (Bunny connected the GitHub repo in the Vercel dashboard; auto-deploys from `main`).
- Done: loading screen shows downloaded MB, then "Building the city…"; clear error with Retry for a missing map (404, or an HTML page instead of JSON), damaged JSON, interrupted download, or no WebGL. Dev-only `?map=` override to test the error screen locally.
- Checked live: page and map served with brotli, map as `application/json`, 1.06 MB download; missing file returns 404; http redirects to https. Live game loads on the laptop in the in-app browser, spawns at Raj Vihar, no console errors, OSM credit visible, dev hooks and fps readout hidden in production (`?fps` shows it).

## 2026-11-19: Task 2.5 Car driving + touch controls
- Phone check: Bunny confirmed driving works on his phone. 2.5 ticked.
- Done: `src/vehicles/{params,carModel,vehicle,parked}.ts` (demo sedan model and arcade handling, fixed 1/120 s sub-steps, two 1.0 m collision circles instead of one 1.6 m circle for narrow streets, crash slow-down and camera shake, bridge deck height), `src/map/roadIndex.ts` (nearest road point), `src/game.ts` (walk/drive state, get in/out on E or the button, exit on the right side, "Slow down first", unstuck on R or the button, map view on C), `src/ui/touch.ts` (demo joystick + Run/Drift, Get in/out, Unstuck buttons), `src/ui/hud.ts` (km/h readout, toasts). 8 parked cars on the left edge of roads 18 to 32 m from the start.
- Checked by driving the real car physics with an autopilot along shortest road routes: Raj Vihar to Konda Reddy Fort (1.37 km, 90 s, 0 times stuck), then on to the station, bus stand, GGH and C-Camp (about 7.5 km in total, 0 times stuck). Get in and get out work. Unstuck from 45 m off-road puts the car exactly on the road facing along it. Screenshot shows the car, speed and touch controls.
- Next: 2.6 deploy to Vercel.

## 2026-11-19: Task 2.4 Collision grid + on-foot player + camera
- Done: `src/map/collision.ts` (32 m hash grid of 152k wall segments: building outlines, water banks cut into 4 m pieces with gaps where any road crosses water, railings along bridges and along roads where they are over water; circle push-out; `heightAt` for bridge decks). `src/player/onFoot.ts` (demo figure and tank controls: W/S walk, A/D turn, Shift run), `src/player/chaseCamera.ts` (demo chase camera, kept out of buildings), `src/player/input.ts` (keyboard). Map view moved to the C key. Player spawns at Raj Vihar Circle.
- Checked by driving the player in code: walking 3 s into a building never gets inside; 8 attempts to walk into the Tungabhadra from different banks, 0 got in; both NH44 Tungabhadra bridges (634 m, 638 m) crossed end to end over water with the player on the deck (y 0.66); walking off a bridge's side is stopped by railings (also on an 11 m secondary bridge). Screenshot shows the figure at Raj Vihar with the chase camera.
- Not checked: live keyboard walking in the pane (session window was closed, so the render loop was paused). Phones cannot walk yet: touch controls are task 2.5.
- Dev-only: `window.__game` exposes player, world, map.
- Next: 2.5 car driving + touch controls.

## 2026-11-19: Map expansion (Bunny's request, between 2.3 and 2.4)
- Map box now S15.770 W77.975 N15.870 E78.065 (9.6 x 11.1 km), reaching G. Pulla Reddy College (south) and Peddapadu (west). Re-downloaded (about 25 min on private.coffee), new `raw.json.gz` 1.7 MB.
- Rebuilt `kurnool.json`: 4.08 MB (0.98 MB gzipped), identical on rebuild. 4615 roads, 26900 buildings (15322 OSM incl. 3725 shrunk, 11578 filler; 1903 dropped on roads), 644 parks, all 9 landmarks still found. Airport link now from Nandikottur Road. Size limit raised to 6 MB.
- Performance fixes found while checking: trees were one always-drawn instanced mesh (5649 trees, ~180k triangles); now instanced per 500 m chunk with cheaper trunks. Buildings chunked at 250 m. Camera far plane now stops just past the fog (sky dome scales to fit). Street-level drawn triangles fell from ~230k to 40k-66k (24 to 62 draw calls).
- Not measured: real fps after these changes (session window was closed, so browser timing was throttled). Expect better than the 60 fps Bunny saw on his phone before.
- Abdullah Khan Estate pin still needed.

## 2026-11-19: Task 2.3 Buildings and parks
- Phone check: Bunny's phone shows 60 fps on low. 2.3 ticked.
- Bunny feedback: some buildings, rivers and canals look misplaced or mismatched, and landmarks do not look like the real ones. Landmark models are task 4.1 (not built yet). Accuracy fix options discussed with Bunny, see the next entry when decided.
- Done: `src/map/buildings.ts` extrudes all 16876 buildings, merged per 500 m chunk: palette colours, shared window texture (8x8 bays, bay 0 plain), lit windows as an emissive map on high quality, lighter parapet band on buildings 6 m+, darker roofs, black water tanks on 15% of roofs. Tiny per-building height offsets stop coplanar roofs flickering. `src/map/parks.ts`: green park patches plus low-poly trees in one instanced mesh. `src/world/quality.ts`: low (phones, pixel ratio 1, fog 420 m, no lit windows, half the trees) or high (laptops); override with `?quality=low|high`. Road chunks raised to 500 m to cut draw calls. Junction discs at bridge ends now use the normal road's style (no raised caps).
- Checked on the laptop (Intel UHD), timed renders: high = about 114 fps at street level, 66 fps with the whole city on screen (353 draw calls, 519k triangles). Low = 160 to 185 fps (24 to 30 draw calls, 90k to 115k triangles). Live counter 60 fps (vsync). No z-fighting seen on roofs, walls, parks or roads.
- Not ticked: acceptance needs 30+ fps on Bunny's phone on low. Phones get low automatically. Bunny: run the dev server, open `http://<laptop Wi-Fi IP>:5173` on the phone, read the fps number in the top-left corner.
- Next: tick 2.3 after the phone check, then 2.4 collision + on-foot player + camera.

## 2026-11-19: Task 2.2 Render roads, ground, water
- Done: game loads `kurnool.json` with a loading screen and a clear error screen (with Retry) if the map is missing, damaged or WebGL fails. Renders ground, water and chunked road ribbons (250 m chunks, junction discs, bridges lifted 0.5 m), dusk sky dome, sun, fog and lights from the demo. Free fly-over camera in `src/player/freeCamera.ts` (mouse, WASD/Q/E/R/F, touch). FPS readout in dev or with `?fps`.
- New files: `src/map/{types,loadMap,meshBuilder,ground,water,roads}.ts`, `src/world/sky.ts`, `src/player/freeCamera.ts`, `src/ui/{status,fps}.ts`.
- Checked in the in-app browser (Intel UHD, 1536x1152): 60 fps live (vsync). Timed renders: about 113 fps at street view, about 71 fps with the whole city on screen (544 draw calls, 105k triangles). Roads, Tungabhadra, Handri and bridges recognizable. Junctions close up have no gaps or flicker.
- Fog and the camera near plane grow with camera height so the fly-over can see the whole city without road flicker.
- Not tested: touch controls on a real phone (Bunny can try on the Wi-Fi address). Lane markings not done yet.
- Dev-only: `window.__three` exposes renderer/scene/camera for checks.
- Next: 2.3 buildings and parks.

## 2026-11-19: Task 2.1 Map build script
- Done: `scripts/osm/build.mjs` (`npm run map:build`) writes `public/map/kurnool.json`: 2.63 MB, 0.64 MB gzipped, builds in about 1.5 s. Rebuild gives an identical file (sha256 172b40fe83180cc3). Validation passes.
- Contents: 3178 roads + airport link, graph 5532 nodes / 8039 edges, 16876 buildings (10335 OSM, of which 2844 shrunk off roads; 1214 dropped for blocking roads; 6541 filler), 352 parks (44 OSM + 308 filler), 154 water shapes, 16 rail lines, 9 landmarks, airport, spawn at Raj Vihar Circle.
- Shared helpers moved to `scripts/osm/geo.mjs` and `landmarks.mjs`. Landmark names are read from the MAP-SPEC table. `report.mjs` uses them too.
- Checked the built-map preview: river, roads, landmarks and airport in place. The wide blue area east of the fort is real (Tungabhadra about 800 m wide, far bank outside the box); confirmed by comparing built water with raw OSM (7.27 km2 match, 0 km2 extra).
- Still open: Abdullah Khan Estate pin from Bunny (add to `MANUAL_PINS` in `scripts/osm/landmarks.mjs`, then `npm run map:build`).
- Next: 2.2 render roads, ground, water.

## 2026-11-18: Task 1.3 OSM fetch
- Done: `scripts/osm/fetch.mjs` (Overpass download, retries on busy/network errors, per-part cache in `scripts/osm/.cache/` keyed by bbox), `report.mjs` (counts, landmarks, rivers, bridges), `preview-template.html` -> `preview.html` (gitignored). `npm run osm:fetch` / `npm run osm:report`. Snapshot `scripts/osm/raw.json.gz` (1.2 MB) committed.
- Bunny check: Bunny chose to stretch the box north (and a little west) so the NH44 Tungabhadra bridge is inside. New box S15.805 W78.003 N15.870 E78.065, 6.6 x 7.2 km.
- Results: 3201 drivable roads (638 km), 12006 buildings (251 per km2, sparse, parks and filler needed), 51 road bridges incl. the two NH44 Tungabhadra bridges (~635 m). 8 of 9 point landmarks found and inside the box. Handri river and KC Canal run through the city.
- overpass-api.de was at capacity. Used `OVERPASS_URL=https://overpass.private.coffee/api/interpreter`. The main query once took over 3 hours of queueing and retries. If it is slow again, Bunny can run `npm run osm:fetch` himself.
- Still open: Abdullah Khan Estate is not in OSM. Waiting for Bunny's pin (lat, lon); add it by hand in 2.1. Telugu spellings still unverified.
- Next: 2.1 map build script.

## 2026-11-11: Task 1.2 GitHub repo
- Done: public repo https://github.com/BunnyPraneeth5/kurnool-chaos created with `gh` and pushed. `main` tracks `origin/main`. Docs visible on GitHub.
- Commits use Bunny's GitHub noreply email (set in this repo's local git config only). The first 2 commits were rewritten before the first push to remove the personal email.
- Next: 1.3 OSM fetch.

## 2026-11-11: Task 1.1 Scaffold
- Done: Vite + TypeScript + Three.js scaffold with a spinning cube, dusk colours and the OSM credit. `npm run typecheck` and `npm run build` pass. Checked in the in-app browser at desktop and phone size. First git commit.
- Phone check: Bunny confirmed the cube spins on his phone over Wi-Fi (`http://<laptop Wi-Fi IP>:5173`, was 192.168.1.35 this session). 1.1 ticked.
- Next: 1.2 GitHub repo.
- Notes: build warns the JS bundle is over 500 kB. That is Three.js itself (132 kB gzipped). Fine for now, revisit in the performance pass.

## 2026-11-11: Plan review
- Done: critiqued the plan. Bunny approved the simplifications. Updated PRD, MAP-SPEC, ARCHITECTURE, TASKS (reordered: multiplayer moved to Phase 3, races to Phase 6) and DECISIONS.
- Half done: nothing. No code yet.
- Next: task 1.1 Scaffold.
- Blockers: none. Still open: Telugu spellings, map area at 1.3, race routes after the map, Supabase message limits at 3.1.

## 2026-11-11: Handoff
- Done: planning in Claude chat. All docs written: CLAUDE.md, PRD, ARCHITECTURE, MAP-SPEC, TASKS, DECISIONS. Reference demo saved in `reference/`.
- Half done: nothing.
- Next: task 1.1 Scaffold.
- Blockers: none. Bunny still needs to verify Telugu spellings and confirm the map area at task 1.3.
