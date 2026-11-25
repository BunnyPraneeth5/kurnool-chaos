// Task 1.3: download the Kurnool OSM data once from the Overpass API.
// Saves scripts/osm/raw.json (gitignored) and raw.json.gz (committed snapshot),
// then runs report.mjs to print counts, landmarks and write preview.html.
//
// Usage: npm run osm:fetch        (set OVERPASS_URL to use another Overpass server)
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { BBOX, WIDE, bboxStr, DIR, RAW_PATH, RAW_GZ_PATH } from './common.mjs';
import { ENDPOINT, overpass, sleep } from './overpass.mjs';

const b = bboxStr(BBOX);
const w = bboxStr(WIDE);

// Everything the map build needs, inside the play area.
const MAIN_QUERY = `[out:json][timeout:300][maxsize:536870912];
(
  way["highway"](${b});
  way["building"](${b});
  relation["building"](${b});
  way["natural"="water"](${b});
  relation["natural"="water"](${b});
  way["waterway"](${b});
  relation["waterway"="riverbank"](${b});
  way["landuse"="reservoir"](${b});
  way["railway"="rail"](${b});
  way["leisure"~"^(park|garden|playground|stadium|pitch)$"](${b});
  way["landuse"~"^(grass|recreation_ground)$"](${b});
);
out geom;`;

// Landmarks, rivers, canals and road bridges in a wider box, geometry clipped to it.
const NAME_KEYS = '^(name|name:en|name:te|alt_name|old_name|official_name)$';
const NAME_RE = [
  'konda ?reddy', 'kondareddy', 'buruju', 'burj',
  'tungabhadra', 'handri', 'k[.]? ?c[.]? canal', 'cuddapah', 'kadapa',
  'railway station', 'bus stand', 'bus station', 'apsrtc',
  'c[ .-]*camp', 'general hospital', 'ggh', 'medical college',
  'raj ?vihar', 'abdul+ah? ?khan',
  'కొండారెడ్డి', 'బురుజు', 'తుంగభద్ర', 'హంద్రీ', 'రాజ్ ?విహార్', 'క్యాంప్', 'అబ్దుల్లా',
].join('|');

const LANDMARK_QUERY = `[out:json][timeout:300];
(
  nwr[~"${NAME_KEYS}"~"${NAME_RE}",i](${w});
  nwr["railway"="station"](${w});
  nwr["amenity"~"^(bus_station|hospital|college|university)$"](${w});
  nwr["historic"](${w});
  node["place"](${w});
  way["natural"="water"](${w});
  relation["natural"="water"](${w});
  way["waterway"~"^(river|canal|riverbank)$"](${w});
  relation["waterway"~"^(river|riverbank)$"](${w});
  way["highway"]["bridge"](${w});
);
out geom(${w});`;

// Each download is cached in scripts/osm/.cache/ as soon as it arrives, so a failure
// only repeats the part that failed. Pass --fresh to ignore the cache.
const CACHE_DIR = join(DIR, '.cache');
const fresh = process.argv.includes('--fresh');

async function cached(name, label, query) {
  // Cache name includes the box, so changing BBOX never reuses an old download.
  const file = join(CACHE_DIR, `${name}_${bboxStr(name === 'main' ? BBOX : WIDE).replace(/,/g, '_')}.json`);
  if (!fresh && existsSync(file)) {
    console.log(`Overpass: ${label}: using cached ${name}.json (pass --fresh to download again)`);
    return JSON.parse(await readFile(file, 'utf8'));
  }
  const json = await overpass(label, query);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(json));
  return json;
}

const main = await cached('main', 'play area (roads, buildings, water, rail, parks)', MAIN_QUERY);
await sleep(3000); // be polite to the public server
const landmarks = await cached('wide', 'wider area (landmarks, rivers, bridges)', LANDMARK_QUERY);

const raw = {
  fetchedAt: new Date().toISOString(),
  osmBase: main.osm3s?.timestamp_osm_base ?? null,
  endpoint: ENDPOINT,
  bbox: BBOX,
  wide: WIDE,
  main: main.elements,
  landmarks: landmarks.elements,
};
const json = JSON.stringify(raw);
await writeFile(RAW_PATH, json);
const gz = gzipSync(json, { level: 9 });
await writeFile(RAW_GZ_PATH, gz);
console.log(`Saved raw.json (${(json.length / 1e6).toFixed(1)} MB) and raw.json.gz (${(gz.length / 1e6).toFixed(1)} MB)`);

await import('./report.mjs');
