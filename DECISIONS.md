# Decisions

| Date | Decision | Why |
|---|---|---|
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
