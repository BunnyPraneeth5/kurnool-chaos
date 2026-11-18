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
| 2026-11-18 | Overpass server: private.coffee via OVERPASS_URL when overpass-api.de is full | Main public server was at capacity |
| 2026-11-11 | Map data from OpenStreetMap, not Google Maps | Google Maps data can't be downloaded for reuse. OSM is free with credit |
