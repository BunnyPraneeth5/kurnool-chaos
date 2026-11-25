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
| 2026-11-25 | Supabase project `kurnool-chaos` (ref lpafbvfxmbapagjozlvt), free plan, region ap-south-1 Mumbai, created by Claude through Bunny's connected Supabase account | Bunny's pick; Mumbai is the closest region to Kurnool |
| 2026-11-25 | Supabase free-plan Realtime limits (checked 2026-11-25, supabase.com/docs/guides/realtime/limits and /pricing): 2 million messages per month, 100 messages per second, 200 concurrent connections, 20 presence messages per second, 100 channel joins per second, 256 KB per broadcast. One broadcast counts 1 + 1 per receiving client. Over the monthly quota the free plan gets an email and a grace period, no bill | Sets the network budget below |
| 2026-11-25 | Adaptive send rate: 5 Hz up to 4 players, then 80 / N² Hz (about 3.2 Hz at 5, 2.2 at 6, 1.25 at 8); no sending when alone. Remote players drawn one send interval + 100 ms in the past (300 ms at 5 Hz, 900 ms with 8) | N players at f Hz cost f x N² messages/s; fixed 5 Hz with 8 players would be 320/s, over the 100/s limit. Busy rooms get about 7 hours of driving together per month on the free quota. Bunny's pick |
| 2026-11-25 | Realtime uses the new `sb_publishable_...` key, public channels (no RLS on Realtime) | Friends-only game; room codes are hard to guess |
| 2026-11-25 | Start screen without a room link: nickname (remembered per device) + Create room / Join with code / Play alone. A room link goes straight to the nickname box. Creating a room puts `?room=CODE` in the address bar; in-game Share button uses the phone share sheet, else copies the link | Bunny's pick |
| 2026-11-25 | Soft cap: a newcomer who finds 8 others in presence leaves with "Room full" before announcing itself; players already in are never kicked | Simpler and fairer than sorting by phone clocks, which differ |
| 2026-11-25 | Each player takes the lowest free slot 0..7 (sent in presence); the slot sets their colour and their spawn point on a ring about 45 m around Raj Vihar Circle (nearest road point per 45° step, at least 10 m apart). Solo play still starts at the circle | Spread-out spawn without a server |
| 2026-11-25 | Supabase client is code-split and only downloaded when you play in a room (222 KB chunk) | Solo play stays as light as before |
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
