# PRD: Kurnool Chaos v1

## Problem
Me and my friends want a simple GTA-style game we can open in a browser and mess around in together. Nothing out there is set in our own city.

## User
Bunny and 2 to 8 friends. Mix of Android phones and laptops. Join from a shared link, no install, no login.

## Main mode
Free roam: drive around Kurnool and mess about with friends. Races are a secondary mode.

## v1 features
1. **Real Kurnool map.** Street layout from OpenStreetMap, stylized low-poly buildings, dusk lighting. Not identical, recognizable. Areas with no buildings in the map data get parks and simple random buildings. Not precise.
2. **Landmarks.** Konda Reddy Fort, Tungabhadra river and bridge, railway station, bus stand, C-Camp Centre, Govt. General Hospital and Kurnool Medical College, Rajvihar Centre, Abdullah Khan Estate streets.
3. **Airport.** Shrunk and moved close to the city, linked by a highway. Drivable runway, terminal, a few parked planes and a "Planes coming soon" sign. No flying in v1.
4. **Vehicles.** Cars, auto rickshaws, bikes and scooters with their own models. Buses and lorries as simple box shapes. All drivable, each with different handling. Parked vehicles near the start point.
5. **On foot.** Walk, run, get in and out of vehicles.
6. **Traffic.** Local AI traffic driving on the left, mixed vehicle types.
7. **Cops and heat.** Same system as the demo. Cops are local to each player's screen.
8. **Multiplayer rooms.** Create a room, share the link, friends join with a nickname. See each other's vehicles live with name tags. Friends start spread out. Cars bounce off each other (you can't shove a friend's car).
9. **Races (secondary).** Checkpoint races with a countdown and saved finish times. Routes are picked after the map is built.
10. **Signboards.** English and Telugu boards at the 10 landmarks.
11. **Controls.** Touch controls on phones, keyboard on laptops.
12. **Unstuck button.** Puts you back on the nearest road.
13. **Clear errors.** If the map, the internet or Supabase fails, the game says so plainly. No blank screens.

## Out of scope for v1
- Flying planes
- Airport taxiway, apron and hangars
- Detailed bus and lorry models
- Pushing other players' vehicles (needs synced physics)
- Drawing custom race routes on the minimap
- Synced traffic or synced cops between players
- Weapons, damage models, health
- Accounts, login, persistent profiles
- Pedestrians (add later if time allows)
- Day-night cycle (dusk only)
- Sound beyond basic engine and beeps

## Success
- Bunny opens the link on his phone, recognizes the streets around Rajvihar and the fort.
- 4 friends in one room drive around together for 20 minutes without desync or crashes.
- Runs at 30+ fps on a mid-range Android phone on "low" quality.
- A race on a preset route works end to end with saved times.
