# Tasks

One task at a time. Tick it only when every acceptance check passes. Bunny check = stop and wait for Bunny to confirm before moving on.

Order: core game first (map, driving, playing together), extras after. If time runs out, extras get cut, not the core.

## Phase 1: Setup
- [x] **1.1 Scaffold.** Vite + TypeScript + Three.js, `npm run dev`, `build`, `typecheck` scripts, `.gitignore`, `.env.example`. git init, first commit.
  - Accept: `npm run dev -- --host` shows a spinning cube on laptop and phone. Build and typecheck pass.
- [x] **1.2 GitHub repo.** Create public repo `kurnool-chaos` on BunnyPraneeth5 (use `gh repo create` if available, else ask Bunny to create it on github.com) and push.
  - Accept: repo is visible on GitHub with the docs.
- [x] **1.3 OSM fetch.** `scripts/osm/fetch.mjs` with the bbox from MAP-SPEC. Find every landmark in the data and print their positions. Print counts: roads by type, buildings, water areas, bridges. Check whether the Handri river and KC Canal are inside the area.
  - Accept: raw.json saved and a gzipped snapshot committed. A list of landmarks with found/not found. Counts printed.
  - **Bunny check:** show the landmark list and a simple top-down PNG or HTML preview of roads, water and buildings. Bunny confirms the area is right.

## Phase 2: The city
- [x] **2.1 Map build script.** `build.mjs` producing `public/map/kurnool.json` per ARCHITECTURE: seeded heights, buildings overlapping roads removed or shrunk, parks and simple filler buildings where OSM is empty, bridges cross water, validation at the end.
  - Accept: file under 3 MB (raised to 6 MB after the map expansion). Counts of roads, buildings, parks, landmarks printed. Re-running gives an identical file. Validation passes.
- [x] **2.2 Render roads, ground, water.** Load the JSON, chunked road meshes, river, dusk sky and fog.
  - Accept: free camera fly-over shows recognizable Kurnool roads and the river. 50+ fps on laptop.
- [x] **2.3 Buildings and parks.** Extruded, merged per chunk, colour palette, parks and filler where OSM is empty.
  - Accept: city looks dense, no z-fighting, 30+ fps on Bunny's phone on low quality.
- [x] **2.4 Collision grid + on-foot player + camera.** Port from the demo.
  - Accept: can walk around Rajvihar, cannot walk through buildings or into water, can cross bridges.
- [x] **2.5 Car driving + touch controls.** Port demo handling, retune for narrow streets. Enter/exit. Parked cars near spawn. Unstuck button (R key and touch). Touch joystick and buttons from the demo. Capped physics time step.
  - Accept: drive from Rajvihar to the fort without getting stuck on geometry, on laptop and on phone with thumbs. Unstuck puts you on the nearest road.
- [x] **2.6 Deploy.** Connect repo to Vercel. Live link. Loading screen, and a clear error screen if the map fails to load.
  - Accept: link works on phone and laptop. A broken map URL shows a clear error, not a blank screen.
  - **Bunny check:** Bunny drives around and reports streets that look wrong.

## Phase 3: Friends
- [x] **3.1 Supabase project.** Create project, add env vars locally and on Vercel. Check the current free-plan Realtime limits (messages per month and per second) and log them in DECISIONS.md.
  - Accept: the app joins a Realtime channel with the publishable key. Missing env vars or a failed connection show a clear error.
- [x] **3.2 Rooms.** Create room, share link, nickname prompt, presence list, soft 8-player cap, spread-out spawn.
  - Accept: 2 browser tabs join the same room, both see the player list, and they spawn apart.
- [x] **3.3 Live sync.** 5 Hz broadcast (heartbeat only while idle), 200 ms interpolation, remote vehicle models, name tags, bounce off friends' cars, recover after phone lock or app switch.
  - Accept: phone and laptop in one room see each other move smoothly at normal driving speed. Locking the phone for 10 s and coming back recovers without a refresh.
- [x] **3.4 Room controls (Bunny, 2026-11-25).** Leave button in rooms and Exit in solo, join/leave/host notices, player menu (Go to, Block on your screen, Rename yourself), host controls (Kick; host = first to join, passes on when they leave), quick emotes and short text chat with speech bubbles. No report button (useless without logins).
  - Accept: works with 2 tabs and on phone + laptop; a kicked player sees a clear screen and cannot rejoin the same room for 10 min.

## Phase K: Kurnool accuracy (runs in parallel with Phase 3, on its own branch)
Goal (Bunny, 2026-11-25): the street layout matches, but the city must look and feel like real Kurnool in low poly.
- [ ] **K.1 Real building outlines.** Download Overture Maps buildings for the map box with the `overturemaps` Python tool (approved by Bunny) into a committed snapshot. In `build.mjs`, keep OSM buildings, add Overture buildings that do not overlap them, use real heights where Overture has them, and only generate filler where neither source has buildings. Same road clean-up rules. Update the in-game credit for any new data licence.
  - Accept: building counts printed per source, rebuild identical, file size reported (ask Bunny if it goes over 6 MB), street-level triangles and laptop fps reported, Bunny checks 30+ fps on his phone on low.
- [ ] **K.2 Kurnool-style buildings by area.** Pick a style per building from OSM land use, shops and density: dense 2 to 3 floor old city (Peta, Budhwarpet), colony houses with compound walls, market streets with shop fronts, shutters and colourful signboards on the ground floor (Park Road, Raj Vihar, bus stand road), campuses, outskirts.
  - Accept: the named areas look clearly different; phone still 30+ fps on low.
- [ ] **K.3 Street details.** Black-and-yellow kerbs and dividers on main roads, electric poles, temples, mosques and churches where OSM has places of worship, hoardings, auto stands, roadside neem trees. Instanced or merged so phones stay fast.
  - Accept: visible on main roads and at places of worship; phone still 30+ fps on low.
- [ ] **K.4 Corrections file.** `scripts/osm/corrections.json` applied by `build.mjs`: remove or add buildings, change water width, landmark pins (Abdullah Khan Estate). Bunny's reported wrong spots go here.
  - Accept: at least one real correction applied and visible; rebuild identical.
- Landmark models from Bunny's photos are task 4.1.

## Phase G: Lobby and game modes (Bunny, 2026-11-26; on the multiplayer branch)
Goal: rooms gather in a lobby, the host picks a game mode, everyone plays a timed round, sees results, and goes back to the lobby. Our own look: the "gather in a lobby" idea only, nothing copied from other games. Order: G.2 to G.4 now (lobby spot is Raj Vihar Circle for now), G.1 after Phase K is merged. Races (Phase 6) reuse G.2 later.
- [ ] **G.1 Jagannatha Gattu lobby hill.** Low-poly hill (about 35 m high) just past the south map edge, flat summit plaza, ghat road up, link road to the city, English + Telugu signboard. Room spawns and the lobby spot move there. Built in game code, not the map pipeline. Waits for Phase K.
  - Accept: drive up and down without getting stuck; phone 30+ fps on low.
  - **Bunny check:** Telugu spelling of the signboard, hill position.
- [x] **G.2 Lobby and round flow.** Lobby board (HUD panel) with mode, settings and Ready ticks; host picks mode and round length (3/5/10 min) and starts (2+ players); host's game is the referee. Countdown 3-2-1-Go with cars held, round timer, role banner, results card, everyone back to the lobby spot after 10 s. Late joiners wait for the next round; if the host leaves mid-round the next host carries on. Free roam the whole city between rounds.
  - Accept: 2 tabs run a full round (start, countdown, timer, results, back to lobby); a third tab joining mid-round waits and joins the next one; host leaving mid-round does not break it.
- [x] **G.3 Chor–Police.** 1 police (2 with 5+ players) chases the chors; a bump catches a chor, who turns police. Chors score by survival time; police by catches. Police car gets a light bar and "POLICE" text.
  - Accept: 2 tabs + bot: catches count once, roles switch, round ends when all are caught or time runs out, scores shown.
- [x] **G.4 Landmark hunt.** 3 to 5 landmarks one after another; first to reach each scores; arrow and distance to the current target on screen.
  - Accept: 2 tabs: targets advance for everyone, the first arrival gets the point, results rank by points.
- [ ] **G.5 King of the circle.** Score by time inside a zone that moves every minute. (After G.4, if Bunny still wants it.)

## Phase 4: Kurnool feel
- [ ] **4.1 Landmarks.** Fort, Tungabhadra bridge, station, bus stand, GGH + KMC, junction markers at Rajvihar and C-Camp, Abdullah Khan Estate sign. Low-poly models based on 2 or 3 photos per landmark from Bunny, so they look like the real ones.
  - Accept: each landmark visible, in the right place, and recognizable to Bunny.
- [ ] **4.2 Signboards.** English + Telugu boards at the 10 landmarks, using Noto Sans Telugu. Wait for the font to load before drawing.
  - Accept: Telugu renders correctly (no boxes or broken conjuncts) on phone and laptop.
  - **Bunny check:** Bunny verifies Telugu spellings.
- [ ] **4.3 Airport.** Highway link, runway, terminal with sign, 2 or 3 parked planes, "Planes coming soon" sign. No flying.
  - Accept: can drive from the city to the airport and down the runway.

## Phase 5: Vehicles and life
- [ ] **5.1 Vehicle types.** Auto and bike/scooter models with params (bike lean, auto body roll). Bus and lorry as simple box shapes with their own params.
  - Accept: each type feels different. All can be entered and driven.
- [ ] **5.2 Traffic.** Road-graph traffic, left lane, mixed types, density by quality setting.
  - Accept: 20 to 40 traffic vehicles moving without piling up for 5 minutes.
- [ ] **5.3 Cops and heat.** Port from demo onto the road graph. Cops path along roads with a shortest-path search.
  - Accept: stealing from traffic gives heat, cops chase without getting stuck at dead ends, bust and escape both work.
- [ ] **5.4 HUD and minimap.** Port from demo. Minimap draws real roads and landmarks.
  - Accept: full game playable on phone with thumbs only.

## Phase 6: Races (secondary)
- [ ] **6.1 Pick race routes.** Propose 2 or 3 preset routes from the built map.
  - **Bunny check:** Bunny picks the routes.
- [ ] **6.2 Results table.** Run `supabase/schema.sql`.
  - Accept: insert and select on `race_results` work with the publishable key. Update and delete are refused.
- [ ] **6.3 Races.** Presets, countdown that starts when the start message arrives, checkpoints, finish, DNF for players who leave, late joiners get race state, results table.
  - Accept: 2-player race on a preset route finishes and saves both times.

## Phase 7: Ship
- [ ] **7.1 Performance pass.** Quality toggle, pixel ratio cap, chunk culling check.
  - Accept: 30+ fps on Bunny's phone on low, during a 4-player session.
- [ ] **7.2 Friends play-test.** Bunny plus 3 or more friends, 20 minutes.
  - **Bunny check:** collect bugs into PROGRESS.md and fix the top ones.
- [ ] **7.3 README + credits.** What it is, how to play, how to run locally, how sync works, OSM credit.
  - Accept: a friend could clone and run it from the README alone.
