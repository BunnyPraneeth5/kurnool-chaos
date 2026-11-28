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
- [ ] **K.5 Railway, KC Canal and rivers.** (Bunny, 2026-11-25) Draw the OSM railway (main line, sidings, bridges, overhead line on the electrified line, level crossings); KC Canal with walls, its aqueduct over the Handri; river banks. Widths of the KC Canal and the Handri from satellite water maps (Google Earth Engine, Bunny registering).
  - Accept: tracks visible and in the right place, the Tungabhadra rail bridge on piers, canal and aqueduct visible; driving routes still pass; phone still 30+ fps on low.
- Landmark models from Bunny's photos are task 4.1.

## Phase G: Lobby and game modes (Bunny, 2026-11-26; on the multiplayer branch)
Goal: rooms gather in a lobby, the host picks a game mode, everyone plays a timed round, sees results, and goes back to the lobby. Our own look: the "gather in a lobby" idea only, nothing copied from other games. Order: G.2 to G.4 now (lobby spot is Raj Vihar Circle for now), G.1 after Phase K is merged. Races (Phase 6) reuse G.2 later.
- [x] **G.1 Jagannatha Gattu lobby.** Use the real hill from the accuracy track's terrain (summit about 153 m above Raj Vihar, IIITDM road drivable): flat summit plaza, English + Telugu signboard, parked cars for rounds. Room spawns, the lobby spot and round start spots move there; check start spots, Go to and back-to-lobby on slopes (heights from `groundY`). Waits for the accuracy branch (claude/accuracy-dab84d) to be merged into `main`.
  - Accept: everyone in a room starts on the summit; drive down into the city and back up without getting stuck; rounds start and end correctly from there; phone 30+ fps on low.
  - **Bunny check:** Telugu spelling of the signboard (proposed: జగన్నాథ గట్టు).
- [x] **G.2 Lobby and round flow.** Lobby board (HUD panel) with mode, settings and Ready ticks; host picks mode and round length (3/5/10 min) and starts (2+ players); host's game is the referee. Countdown 3-2-1-Go with cars held, round timer, role banner, results card, everyone back to the lobby spot after 10 s. Late joiners wait for the next round; if the host leaves mid-round the next host carries on. Free roam the whole city between rounds.
  - Accept: 2 tabs run a full round (start, countdown, timer, results, back to lobby); a third tab joining mid-round waits and joins the next one; host leaving mid-round does not break it.
- [x] **G.3 Chor–Police.** 1 police (2 with 5+ players) chases the chors; a bump catches a chor, who turns police. Chors score by survival time; police by catches. Police car gets a light bar and "POLICE" text.
  - Accept: 2 tabs + bot: catches count once, roles switch, round ends when all are caught or time runs out, scores shown.
- [x] **G.4 Landmark hunt.** 3 to 5 landmarks one after another; first to reach each scores; arrow and distance to the current target on screen.
  - Accept: 2 tabs: targets advance for everyone, the first arrival gets the point, results rank by points.
- [ ] **G.5 King of the circle.** Score by time inside a zone that moves every minute. (After G.4, if Bunny still wants it.)

## Phase H: Menu, guide, riders and a livelier city (Bunny, 2026-11-27)
Goal: friends understand the game from inside it, ride together, and the city reacts to them. Includes ChatGPT's review points Bunny picked (small fixes, Chor–Police balance, landmark challenges, driving feel). Order: H.1 to H.11; H.12 waits for the friends playtest notes. The guide (H.3) is updated by every later task.
- [x] **H.1 Review fixes.** Fair police shuffle (Fisher–Yates); round timers resync the moment a phone wakes; Noto Sans Telugu bundled in `public/fonts/` (OFL licence, credited) and loaded before Telugu text is drawn; Vitest added as a dev dependency (Bunny approved) with tests for scoring, role changes, claims, duplicate claims, host hand-over and `parseState`; `npm test` script.
  - Accept: `npm test` passes; a phone without a Telugu font shows the lobby sign correctly; a 30 s sleep mid-round shows the right time on wake.
- [x] **H.2 Menu screen.** Menu button (top left, also Esc) opens a full-screen menu over the game (the game keeps running in rooms, pauses in solo): Resume; Leave room / Exit; Guide (H.3); Settings: quality low/high, sound on/off and volume, camera distance, steering sensitivity, minimap show/hide (saved per device); Room: code, Share, player list with Go to / Block / Kick / Rename (the room panel moves here, only a small player count stays on screen); Stats: chaos points, best chaos round, cops escaped, times busted, distance driven per vehicle (this session); About: version, how sync works in one line, data credits and licences.
  - Accept: everything reachable with thumbs only and with the keyboard; settings survive a reload; Leave/Kick/Rename still work from the menu.
- [x] **H.3 Game guide.** Pages inside the menu, and a Guide button on the start screen: How to play; Vehicles (each type with picture, seats, top speed, handling notes, read from `params.ts` so it stays true); Controls (keyboard and touch, with the keys drawn); Places (landmarks with English + Telugu names, Jagannatha Gattu lobby, airport, police stations; tap one to see it on the map); People (you, friends and their colours, the host, traffic drivers and riders, pedestrians, cops, traffic police, police and chors in rounds); Game modes (Chor–Police, Landmark hunt with challenges, Chaos, Hill climb); Other (heat and stars, busted, unstuck, map view, riding along, chaos points, credits). English text, place names also in Telugu.
  - Accept: every page readable on a 375x812 phone; numbers match the game.
- [x] **H.4 Seats and riding along.** Seats including the driver: bike 2, auto 3, car 4, lorry 3 (cab), bus 8. In a room, walk up to a friend's vehicle and press Get in to take a free seat; riders are drawn sitting in their seat on every screen, their camera follows the vehicle, and Get out drops them beside it. Driver gets out or leaves: riders get out too. Rounds: same team only (a chor cannot get into a police vehicle); in Landmark hunt riders score with the driver. Network: state `s` gets `mode: 'ride'`, `ride: driverId`, `seat`; when two take the same seat the earlier joiner keeps it.
  - Accept: 3 tabs: two ride with one driver in a car, a fourth refused when full; bike takes 1 rider; get out works at low speed; riders follow smoothly at driving speed; round rules hold.
- [x] **H.5 Police stations and busted.** Build exports the OSM police stations (`map.police`: 5 after leaving out police quarters and a radio station; rebuild identical, size under 6 MB); the real buildings stay, a POLICE STATION signboard (English + Telugu) stands at the road in front of each. Busted: put on foot outside the nearest police station; a vehicle borrowed from traffic is taken away, a shared one stays where you were caught (on every screen); chaos points lost (H.10).
  - Accept: busted anywhere lands you at the nearest station; shared vehicles stay where you were caught for everyone.
- [x] **H.6 Junctions.** Traffic lights (poles with red/amber/green, solid) at the busiest junctions (4+ ways on trunk, primary or secondary roads), and a traffic policeman on a stand waving lanes through at Raj Vihar and C-Camp. Traffic stops on red and for the policeman's hand; running a red light seen by a cop or the traffic policeman adds heat. Lights are local but timed from the clock so friends see the same colour.
  - Accept: traffic queues and moves through 5 minutes without jams; running a red near the traffic policeman gives a star.
- [x] **H.7 Livelier drivers and sound.** Basic sound with Web Audio (no files): engine pitch per vehicle type, horn (H key and a touch button), siren on cops, beeps. Traffic honks when blocked, overtakes slow autos and bikes on the right on wide two-way roads, buses pull in every 300 m on main roads (the map file has no bus stops), autos pull in at auto stands, a few traffic vehicles carry riders.
  - Accept: sounds on phone and laptop, Sound setting mutes them; overtakes and stops seen; still no pile-ups in 5 minutes; phone 30+ fps on low.
- [x] **H.8 Pedestrians.** People walking on the road edges near you (instanced, fewer on low), crossing now and then at junctions; they run out of the way of fast vehicles and are never hurt; traffic stops for them; driving fast along the roadside near them adds heat.
  - Accept: pedestrians around Raj Vihar, bus stand and the old city; none hurt; phone 30+ fps on low.
- [x] **H.9 Smarter cops.** At 2+ stars cops aim ahead of you to cut you off and ram; at 3 stars a roadblock (two cop cars across the road on your likely route); bike cops in narrow old-city lanes. Escaping (losing a star) gives chaos points.
  - Accept: a roadblock appears ahead at 3 stars; bike cops follow into lanes cars cannot; you can still escape.
- [x] **H.10 Chaos.** Chaos points always count in free roam (small counter by the stars, in Stats): crashing into traffic (more at speed), near misses at speed, drifting, holding heat (per second per star), escaping cops; busted loses them. New room mode **Chaos** (3/5/10 min): local cops on, everyone scores, each player reports their own points (friends' game, no cheat check), leaderboard at the end.
  - Accept: 2 tabs run a Chaos round with points rising, a bust taking points away, and the right winner.
- [x] **H.11 Mode upgrades.** Chor–Police: police see chors as radar pings every 12 s (arrow and minimap show the last ping) instead of a constant arrow; each player has 2 boosts per round (3 s faster, B key and a touch button); a chor who gets away from police within 15 m to 60 m+ scores a bonus; when one chor is left everyone gets an announcement and the last chor scores double. Landmark hunt: some targets become challenges (Konda Reddy Fort: arrive through the marked approach road for a bonus; Raj Vihar: pass 3 checkpoints round the circle in order). New mode **Hill climb**: everyone starts at the foot of Jagannatha Gattu, first to the summit wins, times shown.
  - Accept: 2 tabs + bot: pings, boosts, escape bonus and last-chor bonus each happen once and score right; a Raj Vihar checkpoint challenge and a hill climb run end to end.
- [ ] **H.12 Driving and camera feel.** Tune steering, braking, wall recovery and the chase camera from Bunny's friends-playtest notes; touch steering curve for thumbs.
  - **Bunny check:** feels better on the phone. Waits for the playtest notes.
- **Bunny check (H.6 to H.11):** phone 30+ fps on low with traffic, pedestrians and junctions; sounds on the phone; a Chaos round and a Hill climb with friends.

## Phase R: Roads and borders (Bunny, 2026-11-27)
Goal: proper dividers on the main roads, raised edges where Kurnool has them, and borders along the railway, rivers and canals only where they belong. Some borders break when hit hard and the break is shared with friends. H.12 waits for Bunny's feedback. Everything is built in the game from the map's road, rail and water shapes (no new data), except speed-breaker spots (R.3), which need a small map rebuild.
- [x] **R.1 Breakable borders (the base for R.2 to R.6).** A breakable layer in the collision world: railings, fence panels and barricades each have a fixed id (same on every screen). Hit at over 30 km/h (buses and lorries over 15 km/h): it breaks, you lose some speed, pieces fall over; slower, it stops you like a wall. A break is sent to the room (one small message), everyone sees the gap; the host remembers open gaps and tells people who join; everything is fixed 2 minutes after it broke. Solo play: the same, on your screen.
  - Accept: 2 tabs: a break on one shows on the other; a late joiner sees it; it is fixed after 2 min on both; slow bumps do not break.
- [x] **R.2 Dividers.** (a) Between twin one-way roads (NH44, NH40, Bellary Road and others drawn as two parallel one-way roads): fill the gap with a divider. (b) Wide two-way trunk, primary and secondary roads. (c) Flyovers and big bridges (a centre barrier). Look, the Kurnool mix: a raised concrete strip painted black-and-yellow with small plants and street lights; on the busiest roads a metal railing on top (breakable). Gaps at junctions and U-turn openings; some openings closed by barricades (R.6).
  - Accept: dividers along NH44, NH40 and Bellary Road with no gaps except junctions and openings; traffic still flows 5 minutes; phone 30+ fps on low.
- [x] **R.3 Raised edges.** Taller kerbs (stop you below about 25 km/h, you mount them above). Raised footpaths (about 15 cm, with kerbs) on main roads in busy areas: market streets, the old city, round the station and the bus stand; vehicles bump up onto them; pedestrians walk on them. Raised islands at big junctions and small roundabout centres. Speed breakers near schools, hospitals and some colony roads (spots exported by the map build from OSM schools and hospitals) that bump your vehicle.
  - Accept: footpaths and speed breakers seen in the busy areas; driving over a breaker bumps the vehicle; the kerb stops a slow car and lets a fast one up; file under 6 MB, rebuild identical.
- [x] **R.4 Railway borders.** Boundary walls round Kurnool City station and its yard; fences along the line where it runs through the city (houses or roads close by), open in the fields outside. Crossing only at level crossings, underpasses and bridges, or by smashing through a fence panel at speed (breakable, R.1); station walls do not break.
  - Accept: you cannot drive onto the tracks in the city except at crossings or through a broken panel; routes across the railway still work.
- [x] **R.5 Rivers and canals.** KC Canal walls kept, with railings on top where the canal runs through the city next to roads (breakable). Raised earth embankments along the Tungabhadra and the Handri near the city, with stone steps (ghats) at a few places. Visible railings on every road bridge over water (now invisible walls; bridge railings do not break, nobody falls in the river). A low stone edge where a road runs right next to water.
  - Accept: the borders are visible where you hit them; no invisible walls left along roads by the water; the Tungabhadra bridge has railings.
- [x] **R.6 Barricades and cones.** Orange and white plastic barricades and cones: at the lit junctions and traffic police stands (channelling turns), at a few made-up road-works spots on main roads (one lane closed, a dug patch), at police checkposts (at the stations and where the highways enter the city), and closing some divider openings. (None round the traffic police stands: they blocked the junction.) They fly away when hit and come back with the R.1 timer (shared with friends).
  - Accept: barricades in all four kinds of places; hitting one knocks it away on both tabs; back after 2 min.
- [ ] **R.7 Phone check and guide.** Moved on 2026-11-28: performance into M.13, guide pages into M.14.
- Ghats: two on the Tungabhadra near the old city and one on the Handri (Bunny OK'd the proposal).

## Phase M: Phone controls, moves and fighting (Bunny, 2026-11-28; its own branch)
Goal: the game feels made for phones (icon buttons that change with what you are doing, swipe to look, your own button layout, steering choices, smooth on a mid-range Android), and on foot you can jump, crouch, roll, emote and fight. Weapons, health and vehicle damage join v1 (PRD changed, Bunny 2026-11-28). Cartoon style: low-poly, no blood. Friends can hurt each other in free roam; in rounds the mode decides. Order: M.1 is the base for everything; then the phone UI (M.2 to M.5) and moves (M.6); fighting M.7 to M.12 in order; M.13 and M.14 last. The guide (H.3) is updated by every task. Takes over R.7 and task 7.1.
- [x] **M.1 Actions layer (the base).** One list of actions (move, look, run, jump, crouch, attack, aim, next/previous weapon, get in/out, horn, boost, handbrake, emote, unstuck, map) that keyboard and touch both feed, so new moves are added in one place. A key for every action, shown on the Controls guide page. Short phone buzz (`navigator.vibrate`) on presses, hits and crashes, with a Vibration setting.
  - Accept: every existing control still works on keyboard and touch; `npm test` covers the key and button mapping.
- [x] **M.2 Buttons that change with what you are doing.** Big round icon buttons (thumb-sized, short English label under each icon) for the right thumb. On foot: Attack (biggest), Jump, Crouch, Run, Get in (only near a vehicle), weapon icon (tap: next weapon, hold: weapon wheel), Emote. Driving: Gas, Brake/Reverse, Handbrake, Horn, Boost (rounds), Get out, and Shoot when holding a gun (M.9). Unstuck and Map move to a small top-right row. Buttons that cannot be used right now are hidden, not greyed. Portrait and landscape; safe areas (notch, gesture bar) respected.
  - Accept: on a 375x812 phone and a landscape phone nothing overlaps the minimap, chat, HUD or credit; on foot and driving show the right sets.
- [x] **M.3 Swipe to look.** Drag on the free right half of the screen turns the camera around you (on foot and driving); while driving it eases back behind you a moment after you let go. Laptop: mouse drag (no pointer lock, so the menu stays easy). Look sensitivity in Settings.
  - Accept: look behind while driving and look around on foot with one thumb while the other steers or walks; buttons still work during a drag.
- [x] **M.4 Edit layout.** Settings → Edit controls: drag any touch button or the joystick, resize with pinch or a slider, opacity slider, Reset to default. Saved per device, separate for portrait and landscape.
  - Accept: a moved and resized layout survives a reload; Reset brings back the default; nothing can be dragged off screen.
- [ ] **M.5 Steering choices.** Settings → Steering: joystick (now), left/right arrow buttons with separate Gas and Brake, or tilt the phone (Device Orientation, with a centre calibration button; a clear message where the browser refuses it or asks permission).
  - Accept: all three drive a car round Raj Vihar Circle on the phone; the choice survives a reload.
  - **Bunny check:** tilt steering on a real Android phone (built and checked in the browser; a browser has no motion sensor, so tilt itself is untested).
- [x] **M.6 Jump, crouch, roll, emotes.** Jump (about 1 m) clears kerbs, speed breakers, low walls and dividers, and lands on footpaths and vehicle roofs (riding a moving roof not needed). Crouch: slower and smaller; cops on foot lose sight of you faster when you crouch behind something. Roll: quick dodge (Run + Crouch), no hits taken while rolling. Emotes: wave, dance, point, namaste from a small wheel. Friends see jumps, crouches, rolls and emotes (state `s` gets a small `act` field; ARCHITECTURE updated).
  - Accept: jump clears an NH44 divider and lands on a parked bus; 2 tabs see each other's emotes and crouch; building walls still stop you.
  - Built (2026-11-28): a jump is about 1.4 m, so you get onto a bus by jumping against it (climb, up to 3.4 m). Keys: Space jump, Z crouch, Shift+Z roll, X emote.
- [x] **M.7 Health and hospitals.** Health bar on the HUD (on foot; vehicles get theirs in M.12). Health comes back slowly after 8 s without a hit. At zero you fall over, lose some chaos points and get up at the nearest hospital after 5 s, like busted (H.5). The map build exports OSM hospitals (GGH and others) the way H.5 did police stations, with a HOSPITAL signboard (English + Telugu); rebuild identical, file under 6 MB. Health and falls sent to friends.
  - Accept: falling to zero anywhere lands you at the nearest hospital; friends see you fall and reappear.
  - **Bunny check:** Telugu text for the hospital signboard.
- [x] **M.8 Punches and melee weapons.** Punch and kick combo on Attack; cricket bat and lathi (longer reach, more damage). Hits knock pedestrians and traffic drivers over; they get up and run away (pedestrians still never die). Attack a traffic vehicle's driver: pull them out and take it (carjack). Low-poly swing, hit flash, buzz on hit.
  - Accept: fists, bat and lathi each hit within their reach; carjack works on traffic cars, autos and bikes; no hits through walls.
- [x] **M.9 Cartoon guns.** Pistol and one bigger gun (proposal: a toy-looking shotgun), low-poly, bright tracer, no blood. Phone: aim assist picks the nearest target in front, tap Attack to shoot. Laptop: aim with the mouse, click to shoot. Ammo. From a vehicle: driver shoots sideways only (proposal), riders aim freely.
  - Accept: shoot a cop, a friend and a traffic car on foot and from a car; aim assist picks the right target on the phone.
  - **Bunny check:** how weapons are got. Proposal: everyone starts with fists, bat and pistol; the bigger gun, lathi and throwables from pickups round the city (on the minimap); ammo refills at police stations and on respawn.
- [x] **M.10 Throwables.** Water balloons and tomatoes (splash, no damage, a friend's screen gets splattered for 2 s, pedestrians look round) and firecrackers (small blast, knocks people over, small damage, traffic swerves). Throw in an arc; hold to throw farther, with the arc drawn while held.
  - Accept: each lands where the arc showed; a firecracker near traffic makes it swerve; friends see the splatter.
- [x] **M.11 Fighting friends and cops.** The attacker's screen decides a hit on a friend and sends one small `hit` message (who, damage, direction); the victim's game applies it with a hit marker. Rules: free roam on; Chor–Police only police can stun chors (a stun counts as a catch); Chaos rounds on; Landmark hunt and Hill climb off. Heat: hitting pedestrians or traffic adds a star, hitting a cop two; at 3+ stars cops get out and chase on foot, at 4+ they shoot back (cartoon; dodge by rolling and cover). Message budget checked and written in ARCHITECTURE.
  - Accept: 2 tabs: a hit on one shows on the other once; rounds follow their rules; cops shoot at 4 stars; 8 players fighting stay inside the free-plan message budget.
  - Built (2026-11-28): heat stops at 3 stars, so officers get out at 2 and shoot at 3 (DECISIONS). Hits ride on the state message: no extra messages.
- [x] **M.12 Vehicle damage.** Damage from crashes (by speed and weight) and from shots and firecrackers: dents, smoke at half, fire when low, then it stops and can blow up (small blast, knocks people nearby). Vehicle health on the HUD while driving. Traffic and cops take damage too. A shared vehicle's damage is sent to friends; a wrecked shared vehicle comes back at its parked spot after 2 minutes (like R.1).
  - Accept: a car crashed hard several times smokes, then stops; 2 tabs see the same damage on a shared car; it is back after 2 min.
- [ ] **M.13 Phone performance pass (was the R.7 phone check and 7.1).** Low/high quality toggle with a pixel ratio cap on low; drops to low by itself (with a message) when fps stays under 25 for 10 s; everything merged per chunk; low keeps fewer details (borders, props, pedestrians, effects, tracers); chunk culling checked; effects reuse pooled meshes (nothing new per shot or hit). Draw calls and triangles measured at Raj Vihar, on NH44 and in a fight, before and after.
  - Accept: numbers written in PROGRESS.md; no garbage-collection stutter in a fight with the laptop CPU throttled 4x.
  - **Bunny check:** 30+ fps on the phone on low at Raj Vihar, on NH44 and in a 4-player fight; borders look right.
- [ ] **M.14 Guide and friends check.** Guide pages: Controls (new buttons, steering choices, edit layout), Fighting (weapons, health, hospitals, heat, friend rules per mode), Vehicles (damage), plus R.7's pages (dividers, breaking things, footpaths, railway crossings).
  - Accept: every page readable on a 375x812 phone; numbers match the game.
  - **Bunny check:** 20 minutes with friends on phones: controls feel good, fights are fun, nothing desyncs.

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
  - **Bunny check:** do the five feel different on phone and laptop?
- [x] **5.2 Traffic.** Road-graph traffic, left lane, mixed types, density by quality setting.
  - Accept: 20 to 40 traffic vehicles moving without piling up for 5 minutes.
- [x] **5.3 Cops and heat.** Port from demo onto the road graph. Cops path along roads with a shortest-path search.
  - Accept: stealing from traffic gives heat, cops chase without getting stuck at dead ends, bust and escape both work.
- [ ] **5.4 HUD and minimap.** Port from demo. Minimap draws real roads and landmarks.
  - Accept: full game playable on phone with thumbs only.
  - **Bunny check:** play on the phone with thumbs only.

## Phase 6: Races (secondary)
- [ ] **6.1 Pick race routes.** Propose 2 or 3 preset routes from the built map.
  - **Bunny check:** Bunny picks the routes.
- [ ] **6.2 Results table.** Run `supabase/schema.sql`.
  - Accept: insert and select on `race_results` work with the publishable key. Update and delete are refused.
- [ ] **6.3 Races.** Presets, countdown that starts when the start message arrives, checkpoints, finish, DNF for players who leave, late joiners get race state, results table.
  - Accept: 2-player race on a preset route finishes and saves both times.

## Phase 7: Ship
- [ ] **7.1 Performance pass.** Moved into M.13 on 2026-11-28.
- [ ] **7.2 Friends play-test.** Bunny plus 3 or more friends, 20 minutes.
  - **Bunny check:** collect bugs into PROGRESS.md and fix the top ones.
- [ ] **7.3 README + credits.** What it is, how to play, how to run locally, how sync works, OSM credit.
  - Accept: a friend could clone and run it from the README alone.
