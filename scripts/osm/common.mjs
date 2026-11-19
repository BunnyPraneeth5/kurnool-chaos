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
