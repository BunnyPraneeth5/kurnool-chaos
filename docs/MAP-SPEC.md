# Map spec: Kurnool

## Area
- Centre around the old city, between the Tungabhadra on the north and the railway station on the south.
- Bounding box: south 15.770, west 77.975, north 15.870, east 78.065. About 9.6 x 11.1 km. Stretched north at task 1.3 so the NH44 Tungabhadra bridge is inside, then (Bunny, after task 2.3) south to include G. Pulla Reddy College (15.775, 78.057) and west to include Peddapadu village (15.807, 77.981).
- Play area is bigger than the first 4 x 4 km target, to fit the river bridge. Chunk culling and the quality setting have to keep phones at 30+ fps.
- Real scale, 1 unit = 1 metre. Do not shrink the city itself, only the airport distance.
- At task 1.3, also check whether the Handri river and the KC Canal fall inside the area. Water blocks driving everywhere except on bridges.

## Landmarks
Find each one in the OSM data (by name tag) or with Nominatim. If not found, ask Bunny for a pin location. Telugu names below are drafts, Bunny verifies spelling.

| id | English | Telugu (verify) | Treatment |
|---|---|---|---|
| fort | Konda Reddy Fort | కొండారెడ్డి బురుజు | Custom model: stone tower with battlements on a mound, small plaza around it |
| river | Tungabhadra River | తుంగభద్ర నది | Water along the north edge, river banks, blocks driving |
| bridge | Tungabhadra Bridge | తుంగభద్ర వంతెన | Custom bridge model with railings and lamp posts. Other OSM bridges (`bridge=yes`) stay drivable as plain road over water |
| station | Kurnool Railway Station | కర్నూలు రైల్వే స్టేషన్ | Station building, platform shed, rail lines with a parked train |
| busstand | Kurnool Bus Stand | కర్నూలు బస్ స్టాండ్ | Big covered bays, parked buses you can drive |
| ccamp | C-Camp Centre | సి క్యాంప్ సెంటర్ | Junction sign, roundabout or wide junction |
| ggh | Govt. General Hospital | ప్రభుత్వ సర్వజన ఆసుపత్రి | Large white hospital blocks |
| kmc | Kurnool Medical College | కర్నూలు వైద్య కళాశాల | Campus blocks next to GGH, entrance arch |
| rajvihar | Rajvihar Centre | రాజ్ విహార్ సెంటర్ | Busy junction, signboard, default spawn point |
| akestate | Abdullah Khan Estate | అబ్దుల్లా ఖాన్ ఎస్టేట్ | Keep the real narrow streets, dense low buildings, entrance sign |

## Airport
- The real Kurnool Airport is at Orvakal, about 20 km east of the city along the Nandyal road. In the game it is pulled in.
- Place it about 1.5 km east of the play area's east edge, on flat open ground.
- Highway link: extend the main eastbound road (the Nandyal road direction) out of the city to the airport. 4 lanes, divider, street lights.
- Contents: one runway (about 1.2 km x 30 m, roughly east-west), a terminal building with a "Kurnool Airport / కర్నూలు విమానాశ్రయం" sign, 2 or 3 parked planes (static low-poly), and a big sign: "Planes coming soon". No taxiway, apron or hangars in v1. No flying.
- Everything at the airport is drivable. Racing down the runway should feel good.

## Roads
| OSM highway | Width (m) | Notes |
|---|---|---|
| trunk, primary | 14 | Divider strip, lane markings |
| secondary | 11 | Lane markings |
| tertiary | 9 | Centre line |
| residential, unclassified | 7 | No markings |
| service, living_street | 5 | Narrow, old-city feel |
| track, path, footway, steps | skip | |

- Keep left. Traffic AI uses the left lane.
- Junctions: fill with a simple polygon so ribbons don't show gaps.

## Buildings
- Use OSM footprints. Remove or shrink any that overlap a drivable road (half road width + 1 m), so narrow lanes stay drivable.
- Where an area has almost no buildings, fill it with a mix of parks (green patches, a few trees) and simple random buildings along the roads. No need to be precise.
- Random choices (heights, colours, filler) are seeded by OSM id or position, so every build gives the same city.
- Heights: 1 to 4 floors at 3.2 m per floor. Commercial areas around Rajvihar, Park Road and the bus stand get 3 to 6 floors.
- Colours: warm Indian city palette. Cream, pale yellow, light blue, pink, mint, white, some unpainted grey. Flat roofs with a parapet edge, water tanks on some roofs.

## Look
- Dusk lighting, fog and sky from the reference demo.
- On-screen credit: "© OpenStreetMap contributors" (bottom corner, always visible).
