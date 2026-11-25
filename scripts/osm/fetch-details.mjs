// Tasks K.2/K.3: download the OSM details that pick building styles and street props:
// land use, shops, amenities (places of worship, schools...), offices, place names,
// power poles, street lamps, trees, bus stops, signals and adverts, inside the play area.
// Saves the committed snapshot scripts/osm/details.json.gz (build.mjs reads it), so the
// big main download (fetch.mjs) does not have to be repeated.
//
// Usage: npm run osm:details      (set OVERPASS_URL to use another Overpass server)
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { BBOX, bboxStr, DIR, DETAILS_GZ_PATH } from './common.mjs';
import { ENDPOINT, overpass } from './overpass.mjs';

const b = bboxStr(BBOX);
const QUERY = `[out:json][timeout:300][maxsize:268435456];
(
  way["landuse"](${b});
  relation["landuse"](${b});
  nwr["shop"](${b});
  nwr["amenity"](${b});
  nwr["office"](${b});
  nwr["craft"](${b});
  nwr["tourism"](${b});
  nwr["place"~"^(suburb|neighbourhood|quarter|village|hamlet|locality)$"](${b});
  node["power"~"^(pole|tower)$"](${b});
  way["power"~"^(line|minor_line)$"](${b});
  node["highway"~"^(street_lamp|bus_stop|traffic_signals)$"](${b});
  node["natural"="tree"](${b});
  nwr["advertising"](${b});
  way["barrier"~"^(wall|fence)$"](${b});
);
out geom;`;

const file = join(DIR, '.cache', `details_${b.replace(/,/g, '_')}.json`);
let json;
if (!process.argv.includes('--fresh') && existsSync(file)) {
  console.log('Overpass: details: using cached file (pass --fresh to download again)');
  json = JSON.parse(await readFile(file, 'utf8'));
} else {
  json = await overpass('details (land use, shops, amenities, poles, trees)', QUERY);
  await mkdir(join(DIR, '.cache'), { recursive: true });
  await writeFile(file, JSON.stringify(json));
}

const out = {
  fetchedAt: new Date().toISOString(),
  osmBase: json.osm3s?.timestamp_osm_base ?? null,
  endpoint: ENDPOINT,
  bbox: BBOX,
  elements: json.elements,
};
const text = JSON.stringify(out);
const gz = gzipSync(text, { level: 9 });
await writeFile(DETAILS_GZ_PATH, gz);

const count = {};
for (const el of json.elements) {
  const t = el.tags || {};
  const k = ['landuse', 'shop', 'amenity', 'office', 'place', 'power', 'highway', 'natural', 'advertising', 'barrier', 'craft', 'tourism'].find((x) => t[x]);
  const key = k ? (k === 'shop' || k === 'office' || k === 'craft' ? k : `${k}=${t[k]}`) : 'other';
  count[key] = (count[key] || 0) + 1;
}
console.log(`Saved details.json.gz (${(gz.length / 1e6).toFixed(2)} MB), ${json.elements.length} elements`);
console.log(Object.entries(count).sort((p, q) => q[1] - p[1]).slice(0, 50).map(([k, v]) => `${k} ${v}`).join(', '));
