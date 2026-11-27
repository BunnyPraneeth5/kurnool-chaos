# Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-11-27 | Traffic lights only at junctions with 4+ ways, 3+ of them main roads and one trunk or primary (84); the first rule (192) put lights almost everywhere | Bunny asked for the busiest junctions |
| 2026-11-27 | Light cycle from Date.now() with a per-junction offset, not synced | Friends' clocks are close enough; no extra messages |
| 2026-11-27 | Red-light heat only when a cop is within 120 m or at a traffic policeman's junction | Being seen is the point; chaos points either way |
| 2026-11-27 | Buses stop every 300 m on main roads instead of at OSM bus stops | The map file has no bus stops and is at 5.95 of 6 MB; OSM has only 6 stops in the box |
| 2026-11-27 | Overtaking only on two-way roads 9 m+ wide, with 70 m clear coming the other way | Narrow lanes would put traffic into oncoming vehicles |
| 2026-11-27 | Pedestrians 25 low / 50 high, instanced; heat for racing past them (12 m/s+, within 1.6 m) | Bunny: they dodge and are never hurt; keeps phones fast |
| 2026-11-27 | Roadblocks only at 3 stars, at most one at a time, 40 s apart; bike cops for half the new cops in lanes 7 m wide or less | Escapes must stay possible |
| 2026-11-27 | Chaos points: crash 10 + m/s, near miss 15, drift 10/s, heat 2/star/s, escape 50/star, red light 10, busted -25% (min 50) | Starting values; tune after playtests |
| 2026-11-27 | Chaos round points reported by each player every 3 s and sent with the 4 s keep-alive ('quiet' claims) | Immediate broadcasts would break the 100 msg/s budget with 8 players |
| 2026-11-27 | Radar ping every 12 s, live within 50 m; 2 boosts of 3 s; escape bonus 15; last chor survival x2 | ChatGPT review points Bunny picked; values to tune |
| 2026-11-27 | Hill climb start where the road is 115 m below the summit (2.1 km), found from the road route to Raj Vihar | Found from the map, survives map changes; not too long for a 3 min round |
| 2026-11-27 | Landmark challenges only at Raj Vihar (checkpoints) and the fort (bonus gate) | The two Bunny's plan named |
| 2026-11-27 | Police stations keep their real OSM buildings; a signboard at the road in front instead of a separate model | A model would sit on top of the real building |
| 2026-11-27 | Busted in a shared vehicle: it stays where you were caught (for everyone); a borrowed traffic vehicle is taken away | Sending a shared vehicle home for friends would need a new network message; leaving it is already how getting out works |
| 2026-11-27 | Police quarters and the radio receiving station are left out of police stations (5 of 7 kept) | Busted players should land at a station |
| 2026-11-27 | Riders send `mode: 'ride'` with the driver id and seat; their figure is drawn inside the driver's vehicle on every screen; no rider physics | Cheap, and the vehicle is already synced |
| 2026-11-27 | Seated friends are hidden behind the glass in cars, buses and lorries; seen on bikes and autos | The low-poly glass is opaque; name tags still show who rides |
| 2026-11-27 | Menu pauses solo play; in rooms the world goes on and you stand still | Rooms cannot pause for everyone |
| 2026-11-27 | No sound settings yet; they come with sound in H.7 | No setting that does nothing |
| 2026-11-27 | Telugu font: Noto Sans Telugu Bold TTF from Google's notofonts repo, OFL, 243 KB | Bunny approved; only one weight is needed |
| 2026-11-27 | New Phase H: menu, in-game guide, riding along, police stations, junctions, sound, pedestrians, smarter cops, chaos points and mode, mode upgrades from ChatGPT's review | Bunny's request after Phase 5; friends need to understand the game and have more to do |
| 2026-11-27 | Seats including the driver: bike 2, auto 3, car 4, lorry 3, bus 8; extra seats are for friends in the room (no computer passengers in your own vehicle) | Bunny's pick; a bus holds a full room |
| 2026-11-27 | Riders in rounds: same team only; in Landmark hunt riders score with the driver | Bunny's pick; a chor in a police car would end the mode |
| 2026-11-27 | Busted: on foot at the nearest OSM police station, vehicle taken, chaos points lost | Bunny's pick; being busted must cost something |
| 2026-11-27 | Chaos points always count in free roam, plus a timed Chaos room mode; each player reports their own points | Bunny picked both; host-checked points would need synced cops and traffic |
| 2026-11-27 | Menu screen (Esc / Menu button) holds Resume, Leave, Guide, Settings, Room, Stats, About; the room panel moves into it | Bunny's pick; clears the screen on phones |
| 2026-11-27 | Guide and menu in English, place names also in Telugu | Bunny's pick |
| 2026-11-27 | Pedestrians dodge and are never hurt | Bunny's pick; keeps it light for friends |
| 2026-11-27 | Junctions: traffic lights at the busiest junctions, a traffic policeman at Raj Vihar and C-Camp | Bunny picked both; very Kurnool |
| 2026-11-27 | Basic sound with Web Audio, generated (no sound files, no new dependency) | PRD has basic engine and beeps in scope; horns and sirens need sound |
| 2026-11-27 | Vitest as a dev dependency for gameplay tests | Bunny approved with the review fixes |
| 2026-11-27 | Vehicles collide as circles along the body (bus 4, lorry 3, others 2) with a per-type radius; weight decides who moves when you hit traffic or cops | Long buses need more than one circle; heavy vehicles should shove light ones |
| 2026-11-27 | 14 shared parked vehicles: the first 8 are cars (rooms move them to the lobby, rounds use car = slot), then 2 autos, 2 bikes, a bus and a lorry near Raj Vihar | Everyone in a round gets the same kind; the other types are still near the start |
| 2026-11-27 | Network `mode` is the vehicle type; `car` -2 for a vehicle taken from your own traffic (friends see it in your colour) | Traffic is local, so friends cannot know which one it was |
| 2026-11-27 | Traffic and cops move along road polylines (no wall physics); a knock pushes them up to 2.5 m aside and they drift back | Cheap on phones, and they never get caught on walls |
| 2026-11-27 | Traffic 20 on low, 32 on high, kept 120 to 300 m around you; 30% autos, 32% bikes, 28% cars, 5% buses, 5% lorries | Kurnool street mix; acceptance asks for 20 to 40 |
| 2026-11-27 | Cops may drive against one-way roads (30% extra cost in the path search); new heat gives cops 20 s before it can cool | Without it they took long detours; with the demo's rule they gave up before arriving |
| 2026-11-27 | Busted = heat and cops cleared, vehicle stopped, nothing else | No money or score system in this game yet |
| 2026-11-27 | No local cops during a game round you are in | Chor–Police has its own police; cops would confuse rounds |
| 2026-11-27 | Minimap top right, turning with the camera, tap for the whole city; room panel moved under it | Demo layout; the whole-city view helps find landmarks on phones |
| 2026-11-10 | Name: Kurnool Chaos (was Port Meridian) | Bunny's pick |
| 2026-11-10 | Just for fun with friends, but touch frontend, realtime, database and deploy in a simple way | Bunny's goal |
| 2026-11-10 | Real Kurnool roads from OSM, stylized low-poly look, not identical | Recognizable but buildable |
| 2026-11-10 | Airport pulled in close, drivable, planes "coming soon" | Flying cut from v1 to keep the build at about 2 days |
| 2026-11-10 | Vehicles: cars, autos, bikes/scooters, buses, lorries | Kurnool street feel |
| 2026-11-10 | Supabase Realtime broadcast + presence, no custom server | No server to run, free tier enough for a friend group |
| 2026-11-10 | Cops and traffic are local per player, only players are synced | Keeps v1 simple. A Render game server can come later for synced world state |
| 2026-11-10 | Private room links, nickname only, no login | Fast to join |
| 2026-11-10 | Dusk look like the demo, English + Telugu signboards | Bunny's pick |
| 2026-11-10 | Phones and laptops both, up to 8 players per room | Bunny's friends use both |
| 2026-11-10 | Public GitHub repo, Vercel hosting | Shareable, auto-deploy |
| 2026-11-11 | Build in Claude Code on Bunny's laptop, not the cloud chat | Real terminal, local dev server testable on phone, OSM reachable |
| 2026-11-10 | Accepted risks: phone performance, missing OSM buildings, messy road data | Bunny is fine with imperfect spots |
| 2026-11-11 | Task order: map, driving, then multiplayer (moved up), then landmarks, vehicles, traffic, cops, races last | Core game playable together first; extras get cut if time runs out |
| 2026-11-11 | Main mode is free roam (drive around, mess about). Races are secondary, preset routes picked after the map is built | Bunny's pick |
| 2026-11-11 | Bus and lorry are simple box shapes | Saves time |
| 2026-11-11 | Airport: runway, terminal, parked planes, sign. No taxiway or hangars, no flying | Saves time |
| 2026-11-11 | Telugu signs only at the 10 landmarks | Saves time |
| 2026-11-11 | Empty map areas get parks and simple random buildings, not precise block filling | Simpler than computing city blocks |
| 2026-11-11 | Add unstuck button, parked vehicles near spawn, spread-out spawn, clear error screens | Messy OSM geometry, and no blank screens |
| 2026-11-11 | Build script removes buildings that overlap roads, lets bridges cross water | Keeps narrow lanes drivable, no cut-off areas |
| 2026-11-11 | Network: 5 Hz with idle heartbeat, 200 ms interpolation, relative race countdown, soft 8-player cap | Supabase message limits, mobile data jitter, phone clocks differ |
| 2026-11-11 | Friends' cars are solid but can't be pushed | Pushing needs synced physics. Claude's default, Bunny can change it |
| 2026-11-11 | Versions at scaffold: three 0.187, vite 8.3, typescript 7.0, Node 25 | Latest stable at setup time |
| 2026-11-11 | Lights use Three.js physical light units, so intensities are higher than the demo's (about 2.5 instead of 0.9) | Newer Three.js lights look dim with the demo's numbers |
| 2026-11-11 | Commits use the GitHub noreply email, not Bunny's personal email | Public repo, keeps the email private |
| 2026-11-18 | Play area S15.805 W78.003 N15.870 E78.065 (6.6 x 7.2 km), bigger than the first guess | Bunny's pick, so the NH44 Tungabhadra bridge is inside |
| 2026-11-18 | Bus stand = main APSRTC Bus Station Kurnool (15.8240, 78.0278). The Rajvihar bus station is part of Rajvihar Centre | Two APSRTC stations in OSM; the main one fits "Kurnool Bus Stand" |
| 2026-11-25 | Supabase project `kurnool-chaos` (ref lpafbvfxmbapagjozlvt), free plan, region ap-south-1 Mumbai, created by Claude through Bunny's connected Supabase account | Bunny's pick; Mumbai is the closest region to Kurnool |
| 2026-11-25 | Supabase free-plan Realtime limits (checked 2026-11-25, supabase.com/docs/guides/realtime/limits and /pricing): 2 million messages per month, 100 messages per second, 200 concurrent connections, 20 presence messages per second, 100 channel joins per second, 256 KB per broadcast. One broadcast counts 1 + 1 per receiving client. Over the monthly quota the free plan gets an email and a grace period, no bill | Sets the network budget below |
| 2026-11-25 | Adaptive send rate: 5 Hz up to 4 players, then 80 / N² Hz (about 3.2 Hz at 5, 2.2 at 6, 1.25 at 8); no sending when alone. Remote players drawn one send interval + 100 ms in the past (300 ms at 5 Hz, 900 ms with 8) | N players at f Hz cost f x N² messages/s; fixed 5 Hz with 8 players would be 320/s, over the 100/s limit. Busy rooms get about 7 hours of driving together per month on the free quota. Bunny's pick |
| 2026-11-25 | Realtime uses the new `sb_publishable_...` key, public channels (no RLS on Realtime) | Friends-only game; room codes are hard to guess |
| 2026-11-25 | Start screen without a room link: nickname (remembered per device) + Create room / Join with code / Play alone. A room link goes straight to the nickname box. Creating a room puts `?room=CODE` in the address bar; in-game Share button uses the phone share sheet, else copies the link | Bunny's pick |
| 2026-11-25 | Soft cap: a newcomer who finds 8 others in presence leaves with "Room full" before announcing itself; players already in are never kicked | Simpler and fairer than sorting by phone clocks, which differ |
| 2026-11-25 | Each player takes the lowest free slot 0..7 (sent in presence); the slot sets their colour and their spawn point on a ring about 45 m around Raj Vihar Circle (nearest road point per 45° step, at least 10 m apart). Solo play still starts at the circle | Spread-out spawn without a server |
| 2026-11-25 | Supabase client is code-split and only downloaded when you play in a room (222 KB chunk) | Solo play stays as light as before |
| 2026-11-25 | Interpolation timeline from sender `Date.now()` mapped onto local receive time (fastest message seen, creeping up slowly, reset after 3 messages over 1 s late) | Smooth through jitter and 2 s idle gaps; recovers when a phone clock jumps after sleep |
| 2026-11-25 | Friend's car drawn in the colour of the parked car they took (cars are on the same spots everywhere); our copy is hidden while they drive it and left where they park it | Avoids a ghost parked car under every friend's car |
| 2026-11-25 | After the page was hidden 4 s or more (phone lock, app switch), the room channel is torn down and rejoined with the same id, nickname and slot; "Reconnecting…" shows until it is back. Socket drops retry with backoff (1 s up to 10 s) | A locked phone's socket can look open while dead |
| 2026-11-25 | Background tabs keep sending a heartbeat from a 1 s timer | Animation frames stop in background tabs; friends would see you vanish |
| 2026-11-25 | Env vars renamed to `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (no `VITE_` prefix); `vite.config.ts` injects only these two at build time | Vercel would not save a key-like variable with the `VITE_` public prefix |
| 2026-11-25 | Room controls (task 3.4): Leave/Exit buttons, join/leave notices, Go to, local Block, Rename, host Kick, 8 emotes + 80-char chat with speech bubbles. No report button | Bunny's request; report is useless without logins |
| 2026-11-25 | Host = first to join (earliest `joinedAt`), passes on when they leave. Kick is honoured by every client that agrees who the host is; a modified client can ignore it but is hidden for everyone; kicked players cannot rejoin that room for 10 min (localStorage) | No server, so no hard enforcement; good enough for friends |
| 2026-11-25 | Leave, Kick and Exit ask once more ("Leave?", "Kick?", "Exit?") instead of a dialog | Fast on phones, still hard to hit by accident |
| 2026-11-27 | Signboard Telugu spelling జగన్నాథ గట్టు | Confirmed by Bunny |
| 2026-11-27 | Lobby on the summit, but round start spots stay around Raj Vihar in the city | The summit is about 10 km by road from the city; a 3 min round would be spent driving down |
| 2026-11-27 | Summit found from the terrain (highest point near a lat/lon pin) instead of fixed map coordinates; plaza is a paved disc that follows the ground, not flattened terrain | Survives map box changes; no changes to the terrain pipeline |
| 2026-11-26 | G.1 lobby goes on the real Jagannatha Gattu from the accuracy track's terrain (map box extended south to 15.748), not a separate 35 m model hill; waits for that branch to merge | Bunny's pick; the accuracy track already built the real hill and road |
| 2026-11-26 | Rounds: 3.5 s countdown, results for 10 s, then everyone in the round is put back on foot at their lobby spot. Each player drives parked car number = their slot during a round | Every player needs a car at once; slots are unique per room |
| 2026-11-26 | Landmark hunt: 3/4/5 targets for 3/5/10 min rounds, picked at random from the map's landmarks (not the river pin), at least 400 m apart in a row; reach = within 30 m on your screen, host accepts within 90 m. 1 point per landmark | Simple and readable; the slack covers lag |
| 2026-11-26 | Chor–Police: 1 police (2 with 5+ players), 10 s head start for chors, police start near the lobby and chors about 300 m out; catch = within 4.5 m on the catcher's screen, host accepts within 15 m; caught chors turn police (3 s before they can catch). Points: chors 1 per second free (+60 if never caught), police 30 per catch. Police cars get a flashing light bar with a POLICE sign, police name tags turn blue | PRD: police vehicles say POLICE only |
| 2026-11-26 | Players who drop out briefly count as present for 15 s in rounds | A phone lock must not end the round for everyone |
| 2026-11-26 | Round messages are not signed: a modified client could pretend to be the host. Accepted risk | Friends-only game, no server |
| 2026-11-26 | New Phase G (lobby and game modes): rooms gather in a lobby, host picks a mode, timed rounds, results, back to the lobby. First modes Chor–Police and Landmark hunt; King of the circle later; races (Phase 6) reuse the same round flow | Bunny's idea; free roam alone gets old with friends |
| 2026-11-26 | Lobby will be on a Jagannatha Gattu hill pulled in just past the south map edge (real spot is about 1.9 km further south, IIITDM campus), built in game code; until then the lobby spot is Raj Vihar Circle | Map is flat and Phase K is still changing the south edge; modes do not depend on the map |
| 2026-11-26 | G.2 to G.4 before G.1, and before Phases 4 and 5 | Bunny's pick: modes now, hill after Phase K |
| 2026-11-26 | Game rounds: the host's game is the referee (decides catches and points, broadcasts round state); timers run from received durations, not phone clocks | No server; same rule as the race countdown |
| 2026-11-26 | Map box south edge 15.770 -> 15.748 (now 9.6 x 13.5 km) | Bunny wants Jagannath Gattu hill (and IIITDM) in the map |
| 2026-11-26 | Graph edges stored as one flat number list in kurnool.json | The bigger box made the file 6.3 MB; packed it is 5.95 MB, under the 6 MB limit |
| 2026-11-26 | Airport link now starts from the unnamed NH40 trunk road in the south-east (same rule: biggest road near the east edge) | The bigger box brought NH40 in; the real Kurnool airport (Orvakal) is on NH40 |
| 2026-11-26 | Platforms: OSM platforms plus satellite outlines that are long (25 m+), narrow (15 m or less), 3x longer than wide, parallel to and within 22 m of a track, within 1.2 km of the station | Kurnool City station has only 2 OSM platforms; Google outlines its platform roofs as buildings, which drew houses on the platforms |
| 2026-11-26 | Terrain from Copernicus DEM GLO-30 via Earth Engine, roofs and trees removed with a 45 m opening; separate `terrain.bin` (0.77 MB) instead of inside kurnool.json | Bunny wants the real highs and lows; a DSM has buildings in it; keeps kurnool.json under 6 MB |
| 2026-11-26 | Heights relative to Raj Vihar (281.7 m above sea level) | Spawn at 0; small numbers in the file |
| 2026-11-26 | Rivers from satellite water outlines (Dynamic World) where they touch an OSM river or lake; river lines become a sandy bed | Real river shapes and dry stretches; flooded fields are left out |
| 2026-11-26 | Flyovers: OSM bridges crossing a road or the railway raised 6.5 m with 6% ramps down the connecting ways; underpasses (OSM tunnels) dug 5.5 m into the terrain; height-aware collision | Bunny reported flat bridges and underpasses; a road under a flyover was blocked by its railings |
| 2026-11-26 | Level crossings only from OSM (3), not every geometric road/rail meeting (was 20) | Most meetings are really underpasses or bridges |
| 2026-11-26 | Road points every 16 m (terrain grid is 20 m); street-level triangles on low now avg 81k, max 111k, 45-74 draw calls | Follows the ground without doubling triangles; still inside the 90-115k the phone ran at 60 fps in 2.3 |
| 2026-11-26 | Satellite tree cover downloaded but not used | Dynamic World marks only 0.2% of the box as 50%+ trees; too sparse for Kurnool scattered trees |
| 2026-11-25 | K.5: building heights from Google Open Buildings 2.5D (2023) for 58,902 buildings; OSM building:levels still win | Real heights instead of made-up ones; OSM levels are hand-entered |
| 2026-11-25 | K.5: canal and river widths from Dynamic World at the 50% water edge; widths change a lot with the threshold (KC Canal west reach 35/29/16 m at 40/50/60%), so they are approximate | 10 m pixels are close to the canal's width; 50% is the unbiased edge of a blurred boundary |
| 2026-11-25 | K.5: the KC Canal's city reach keeps 12 m (satellite sees water at only 11 of 201 points); Bunny can set it in corrections.json | Too narrow for 10 m pixels; no silent guess from neighbouring reaches |
| 2026-11-25 | K.5: Earth Engine project id passed in EE_PROJECT, not committed | It is tied to Bunny's Google account; the repo is public |
| 2026-11-25 | K.5: credit adds "Google Open Buildings, Dynamic World"; phones show it at 9 px under the controls | Both are CC BY 4.0; the longer line overlapped the buttons at 11 px |
| 2026-11-25 | K.5 (Bunny's request): railway, KC Canal and rivers drawn from OSM; canal and Handri widths later from Earth Engine water maps | OSM has the right positions but only centre lines for the canal and the Handri |
| 2026-11-25 | K.5: only rail bridges that cross water stand high on piers; other OSM rail bridges stay at ground level | One OSM "bridge" is a 973 m siding beside the station; raising it would look wrong |
| 2026-11-25 | K.5: the OSM rail way "site1" (closed 1.9 km loop, not connected to any track) is skipped and reported | Almost surely mistagged |
| 2026-11-25 | K.5: buildings more than 30% on water are dropped (20 now) | No houses in the canal; keeps working when Earth Engine widens the water |
| 2026-11-25 | Google Earth Engine: free noncommercial Community tier (150 compute-hours a month, no billing), Bunny registers as "Other" (personal hobby project) | Real building heights and water widths; our box needs only a few hours |
| 2026-11-25 | K.4: corrections file in lat/lon (from Google Maps), applied after buildings and props; a correction that matches nothing stops the build | Bunny can copy points straight from Google Maps; typos never pass silently |
| 2026-11-25 | K.3: kerbs, dividers and divider lights built in the game from road shapes; poles, trees, hoardings, worship and auto stands placed by the build | Road-relative details cost nothing in the file; free-ground checks need the build's raster |
| 2026-11-25 | K.3: dividers only on two-way trunk and primary roads, solid, with gaps at junctions and a 12 m U-turn opening every 300 m | Kurnool's main roads have dividers; openings keep U-turns possible. Autopilot drove 8.8 km over 5 routes with 0 times stuck |
| 2026-11-25 | K.3: poles, tree trunks, hoarding posts, temples, mosques, churches and parked autos are solid; kerbs are not | Driving through a pole or temple looks wrong; kerbs are low enough to mount |
| 2026-11-25 | K.3: same tree models on low and high quality | Trees are solid, so every player must see the same trees |
| 2026-11-25 | K.3: a small OSM building under a worship point is replaced by the temple, mosque or church model (31 of 38); big ones (over 1200 m2) are left alone | Keeps the real position and size; avoids a model inside a building |
| 2026-11-25 | K.2: separate OSM details download (`fetch-details.mjs`, `details.json.gz` 85 kB) instead of re-running the main fetch | The main download takes 25 min to hours; details took 10 min |
| 2026-11-25 | K.2: styles from neighbourhood names, density and road frontage more than land use | Kurnool OSM has only 37 residential, 15 industrial and 3 retail land-use areas and 91 shops; 45 named neighbourhoods cover the city |
| 2026-11-25 | K.2: all styles in one texture atlas, row picked in the shader | Keeps buildings at one draw call per chunk instead of one per style |
| 2026-11-25 | K.2: compound walls only where the whole wall box fits (clear of roads, other buildings and walls), gate facing the nearest road; walls are solid | No walls across lanes or through neighbours; a wall you can walk through would look wrong |
| 2026-11-25 | K.2: heights now follow the style when there is no real height (old city 2-3 floors, colony 1-2, market 2-4 or 3-6 in the commercial centres, outskirts mostly 1) | Old seeded heights made colonies too tall |
| 2026-11-25 | K.1: Overture buildings release 2026-11-18.0 pinned; snapshot `overture-buildings.json.gz` (4.1 MB) committed next to `raw.json.gz` | Reproducible build; same idea as the OSM snapshot |
| 2026-11-25 | K.1: Overture downloaded through the `overturemaps` library with the STAC catalog off, not the CLI | The CLI checks the release against stac.overturemaps.org, which kept answering 429 |
| 2026-11-25 | K.1: an Overture building is skipped when more than 20% of it (2 m raster) is on an OSM outline, including OSM outlines later dropped for blocking roads | OSM stays first; a dropped OSM building must not come back from Overture's copy of OSM |
| 2026-11-25 | K.1: credit is now "© OpenStreetMap contributors, Overture Maps Foundation" | Overture buildings are ODbL; this is Overture's own attribution line |
| 2026-11-25 | K.1: map file version 2, building outlines packed as whole-decimetre deltas | 66.6k buildings made the file 7.4 MB; packed it is 5.0 MB (1.4 MB gzipped), under the 6 MB limit without asking for more |
| 2026-11-25 | New Phase K (Kurnool accuracy) runs in parallel with Phase 3 (multiplayer), each in its own session and git branch; the coordinator session merges into `main` | Bunny wants both; separate branches keep the sessions from overwriting each other |
| 2026-11-25 | `overturemaps` Python tool approved for downloading Overture building outlines (dev tool only, not shipped in the game) | Real building positions instead of generated filler |
| 2026-11-25 | Live at https://kurnool-chaos.vercel.app/ with Vercel defaults (Vite preset, no vercel.json) | Static build needs nothing more; map gets brotli and revalidation by default |
| 2026-11-19 | Car collision = two 1.0 m circles 1.2 m ahead of and behind the centre (was one 1.6 m circle in the demo) | Fits narrow Kurnool lanes and stops the nose poking into walls |
| 2026-11-19 | Player exits the car on the right; parked cars sit on the left edge of the road | Indian cars are right-hand drive and park on the left |
| 2026-11-19 | Unstuck snaps to the nearest road centreline, facing the road direction closest to your current heading | Simple and always lands on drivable ground |
| 2026-11-19 | Any drivable road crossing water carves a gap in the bank walls (not only bridge=yes), with railings where the road is over water | OSM often misses bridge/culvert tags on small canal crossings; roads must stay passable |
| 2026-11-19 | Map view (fly-over camera) kept on the C key | Handy for finding places and for checking the map |
| 2026-11-19 | Map expanded south to G. Pulla Reddy College and west to Peddapadu: S15.770 W77.975 N15.870 E78.065 (9.6 x 11.1 km) | Bunny's request |
| 2026-11-19 | Map file limit raised from 3 MB to 6 MB (now 4.08 MB, 0.98 MB gzipped) | Bigger area; cutting detail would hurt more than a 1 MB download |
| 2026-11-19 | Airport link now from Nandikottur Road (the bigger road reaching the new east edge); rule unchanged: trunk, then primary, then secondary | Map expansion changed which road is nearest |
| 2026-11-19 | Far plane stops just past the fog; buildings chunked at 250 m, trees instanced per 500 m chunk | Trees were one always-drawn mesh (180k triangles); street-level triangles fell from ~230k to 40k-66k |
| 2026-11-19 | Quality defaults: phones (coarse pointer) low, laptops high; `?quality=` overrides until the menu toggle in 7.1 | Phones need the cheap path without a menu yet |
| 2026-11-19 | Buildings and roads merged per 500 m chunk (was 250 m for roads) | Fewer draw calls for phones; fog limits the view anyway |
| 2026-11-19 | One building material: window texture with a plain bay column, roofs/parapets/tanks sample the plain column | One draw call per chunk instead of two |
| 2026-11-19 | Road layers 0.08 to 0.16 m above ground by road size, water 0.04 m, bridges +0.5 m; near plane grows with camera height | Small steps keep vehicles looking grounded; dynamic near plane avoids flicker from high up |
| 2026-11-19 | Road colours get lighter with road size; ground darkened | Main routes need to stand out for Kurnool to be recognizable from above |
| 2026-11-19 | Temporary map-style fly-over camera for 2.2/2.3 | Lets Bunny check the city before on-foot and driving cameras exist (2.4) |
| 2026-11-19 | Airport highway linked from MDR090 (superseded by the map expansion, see above) | No trunk or primary road reached the old east edge |
| 2026-11-19 | Buildings that block roads are shrunk toward their centre (85/70/55%), dropped if still blocking | Keeps lanes drivable while keeping most of the city. 2844 shrunk, 1214 dropped |
| 2026-11-19 | Filler: 80 m cells with roads but 3 or fewer OSM buildings; 20% become parks, the rest get up to 8 simple houses along the roads | Simple, seeded, keeps the file under 3 MB |
| 2026-11-19 | River/canal centrelines without OSM polygons become 30 m / 12 m wide quad strips; streams and drains skipped | Drains everywhere would block streets |
| 2026-11-19 | Landmark English/Telugu names read from the MAP-SPEC table at build time | One place for Bunny to fix spellings |
| 2026-11-18 | Overpass server: private.coffee via OVERPASS_URL when overpass-api.de is full | Main public server was at capacity |
| 2026-11-11 | Map data from OpenStreetMap, not Google Maps | Google Maps data can't be downloaded for reuse. OSM is free with credit |
