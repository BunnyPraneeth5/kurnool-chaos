// Shared settings for the OSM map pipeline (scripts/osm/*).
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export const DIR = dirname(fileURLToPath(import.meta.url));
export const RAW_PATH = join(DIR, 'raw.json');
export const RAW_GZ_PATH = join(DIR, 'raw.json.gz');
export const PREVIEW_PATH = join(DIR, 'preview.html');
export const MAP_PREVIEW_PATH = join(DIR, 'map-preview.html');
export const MAP_OUT_PATH = join(DIR, '..', '..', 'public', 'map', 'kurnool.json');

/** The OSM snapshot: raw.json if present, otherwise the committed raw.json.gz. */
export async function loadRaw() {
  if (existsSync(RAW_PATH)) return JSON.parse(await readFile(RAW_PATH, 'utf8'));
  if (existsSync(RAW_GZ_PATH)) return JSON.parse(gunzipSync(await readFile(RAW_GZ_PATH)).toString('utf8'));
  throw new Error('No OSM data found. Run: npm run osm:fetch');
}

// Overture Maps buildings snapshot (task K.1), written by scripts/osm/overture.py.
export const OVERTURE_GZ_PATH = join(DIR, 'overture-buildings.json.gz');

/** The committed Overture buildings snapshot. Fails loudly if it is missing. */
export async function loadOverture() {
  if (!existsSync(OVERTURE_GZ_PATH)) {
    throw new Error('No Overture buildings snapshot (scripts/osm/overture-buildings.json.gz). Run scripts/osm/overture.py, see its header.');
  }
  return JSON.parse(gunzipSync(await readFile(OVERTURE_GZ_PATH)).toString('utf8'));
}

// OSM details snapshot for building styles and street props (tasks K.2/K.3), from fetch-details.mjs.
export const DETAILS_GZ_PATH = join(DIR, 'details.json.gz');

/** The committed OSM details snapshot. Fails loudly if it is missing. */
export async function loadDetails() {
  if (!existsSync(DETAILS_GZ_PATH)) throw new Error('No OSM details snapshot (scripts/osm/details.json.gz). Run: npm run osm:details');
  return JSON.parse(gunzipSync(await readFile(DETAILS_GZ_PATH)).toString('utf8'));
}

// Hand corrections (task K.4), see the _help list inside the file.
export const CORRECTIONS_PATH = join(DIR, 'corrections.json');

/** scripts/osm/corrections.json, checked for shape. Fails loudly if it is missing or malformed. */
export async function loadCorrections() {
  if (!existsSync(CORRECTIONS_PATH)) throw new Error('scripts/osm/corrections.json is missing');
  let c;
  try {
    c = JSON.parse(await readFile(CORRECTIONS_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`scripts/osm/corrections.json is not valid JSON: ${err.message}`);
  }
  const isLatLon = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
  const bad = [];
  for (const k of ['removeBuildings', 'addBuildings', 'waterWidths', 'clearProps']) if (!Array.isArray(c[k])) bad.push(`${k} must be a list`);
  if (!c.landmarkPins || typeof c.landmarkPins !== 'object') bad.push('landmarkPins must be an object');
  if (!bad.length) {
    for (const [id, p] of Object.entries(c.landmarkPins)) if (!isLatLon(p)) bad.push(`landmarkPins.${id}: needs [lat, lon]`);
    c.removeBuildings.forEach((r, i) => !isLatLon(r.at) && bad.push(`removeBuildings[${i}].at: needs [lat, lon]`));
    c.clearProps.forEach((r, i) => (!isLatLon(r.at) || !(r.radius > 0)) && bad.push(`clearProps[${i}]: needs at [lat, lon] and radius > 0`));
    c.addBuildings.forEach((b, i) => (!Array.isArray(b.pts) || b.pts.length < 3 || !b.pts.every(isLatLon) || !(b.floors > 0)) && bad.push(`addBuildings[${i}]: needs 3+ pts [lat, lon] and floors > 0`));
    c.waterWidths.forEach((w, i) => (typeof w.name !== 'string' || !(w.width > 1 && w.width < 300)) && bad.push(`waterWidths[${i}]: needs name and width 1..300`));
  }
  if (bad.length) throw new Error(`scripts/osm/corrections.json:\n  ${bad.join('\n  ')}`);
  return c;
}

// Satellite grids from Google Earth Engine (task K.5), written by scripts/osm/earthengine.py.
export const EARTHENGINE_PATH = join(DIR, 'earthengine.json');

/** Heights (half metres, 4 m) and water probability (percent, 5 m) grids. Fails loudly if missing. */
export async function loadEarthEngine() {
  if (!existsSync(EARTHENGINE_PATH)) throw new Error('No Earth Engine snapshot (scripts/osm/earthengine.json). Run scripts/osm/earthengine.py, see its header.');
  const meta = JSON.parse(await readFile(EARTHENGINE_PATH, 'utf8'));
  const out = { licence: meta.licence };
  for (const k of ['heights', 'water']) {
    const g = meta[k];
    const data = gunzipSync(await readFile(join(DIR, g.file)));
    if (data.length !== g.width * g.height) throw new Error(`Earth Engine ${k} grid is ${data.length} bytes, expected ${g.width} x ${g.height}`);
    out[k] = { ...g, data };
  }
  return out;
}

// Play area from docs/MAP-SPEC.md. Stretched north at task 1.3 so the NH44
// Tungabhadra bridge (about 15.862, 78.010) is inside, then south to G. Pulla Reddy
// College (15.775, 78.057) and west to Peddapadu (15.807, 77.981) on Bunny's request.
export const BBOX = { south: 15.770, west: 77.975, north: 15.870, east: 78.065 };

// Wider box used to look for landmarks, rivers and bridges just outside the play area.
export const PAD = 0.02;
export const WIDE = {
  south: BBOX.south - PAD,
  west: BBOX.west - PAD,
  north: BBOX.north + PAD,
  east: BBOX.east + PAD,
};

export const CENTER = { lat: (BBOX.south + BBOX.north) / 2, lon: (BBOX.west + BBOX.east) / 2 };

// Metres per degree at the map centre. Equirectangular is fine for a few km.
const phi = (CENTER.lat * Math.PI) / 180;
const M_LAT = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
const M_LON = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);

/** lat/lon -> local metres. X = east, Z = south (matches Three.js with Y up). */
export function project(lat, lon) {
  return [(lon - CENTER.lon) * M_LON, (CENTER.lat - lat) * M_LAT];
}

/** Local metres -> [lat, lon] (inverse of project). */
export function unproject(x, z) {
  return [CENTER.lat - z / M_LAT, CENTER.lon + x / M_LON];
}

export const bboxStr = (b) => `${b.south},${b.west},${b.north},${b.east}`;

export function inBox(lat, lon, b = BBOX) {
  return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
}

// OSM highway types we keep as drivable roads (see MAP-SPEC road table).
export const DRIVABLE = new Set([
  'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
  'residential', 'unclassified', 'road', 'service', 'living_street',
]);
