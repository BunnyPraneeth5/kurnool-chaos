// Task 1.3: read the raw OSM download, print counts and the landmark list,
// and write scripts/osm/preview.html (top-down map for the Bunny check).
//
// Usage: npm run osm:report   (uses raw.json, or raw.json.gz if raw.json is missing)
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { BBOX, WIDE, project, inBox, DRIVABLE, RAW_PATH, RAW_GZ_PATH, PREVIEW_PATH } from './common.mjs';

async function loadRaw() {
  if (existsSync(RAW_PATH)) return JSON.parse(await readFile(RAW_PATH, 'utf8'));
  if (existsSync(RAW_GZ_PATH)) return JSON.parse(gunzipSync(await readFile(RAW_GZ_PATH)).toString('utf8'));
  throw new Error('No OSM data found. Run: npm run osm:fetch');
}

const raw = await loadRaw();

/* ---------- geometry helpers ---------- */
const pts = (geom) => (geom || []).filter(Boolean).map((p) => [p.lat, p.lon]);

function wayLines(el) {
  if (el.type === 'way') return el.geometry ? [pts(el.geometry)] : [];
  if (el.type === 'relation') return (el.members || []).filter((m) => m.geometry).map((m) => pts(m.geometry));
  return [];
}

const pkey = (p) => p[0] + ',' + p[1];

// Join multipolygon member ways into rings by matching shared end nodes.
function joinRings(segs) {
  const open = segs.filter((s) => s.length > 1).map((s) => s.slice());
  const rings = [];
  while (open.length) {
    let ring = open.pop();
    let grew = true;
    while (grew && pkey(ring[0]) !== pkey(ring[ring.length - 1])) {
      grew = false;
      const end = pkey(ring[ring.length - 1]);
      for (let i = 0; i < open.length; i++) {
        const s = open[i];
        if (pkey(s[0]) === end) ring = ring.concat(s.slice(1));
        else if (pkey(s[s.length - 1]) === end) ring = ring.concat(s.slice(0, -1).reverse());
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    rings.push(ring);
  }
  return rings;
}

function polygons(el) {
  if (el.type === 'way') return wayLines(el);
  const outer = (el.members || []).filter((m) => m.geometry && m.role !== 'inner').map((m) => pts(m.geometry));
  return joinRings(outer);
}

function centerOf(el) {
  if (el.lat != null) return [el.lat, el.lon];
  if (el.center) return [el.center.lat, el.center.lon];
  if (el.bounds) return [(el.bounds.minlat + el.bounds.maxlat) / 2, (el.bounds.minlon + el.bounds.maxlon) / 2];
  const all = wayLines(el).flat();
  if (!all.length) return null;
  return [all.reduce((s, p) => s + p[0], 0) / all.length, all.reduce((s, p) => s + p[1], 0) / all.length];
}

function lengthM(line) {
  let len = 0;
  for (let i = 1; i < line.length; i++) {
    const a = project(line[i - 1][0], line[i - 1][1]);
    const b = project(line[i][0], line[i][1]);
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

const allNames = (t) =>
  [t.name, t['name:en'], t['name:te'], t.alt_name, t.old_name, t.official_name].filter(Boolean).join(' | ');
const label = (t) => t.name || t['name:en'] || t['name:te'] || '(no name)';
const uid = (el) => el.type[0] + el.id;
const xz = (c) => project(c[0], c[1]).map((v) => Math.round(v));

/* ---------- sort the play-area data ---------- */
const seen = new Set();
const roadKinds = {};
const skippedKinds = {};
const roads = [];
const buildings = [];
const waterPolys = [];
const waterLines = [];
const rail = [];
const parks = [];
let drivableM = 0;

for (const el of raw.main) {
  seen.add(uid(el));
  const t = el.tags || {};
  if (t.highway && el.type === 'way') {
    const line = wayLines(el)[0] || [];
    const drivable = DRIVABLE.has(t.highway);
    if (drivable) {
      roadKinds[t.highway] = (roadKinds[t.highway] || 0) + 1;
      drivableM += lengthM(line);
    } else {
      skippedKinds[t.highway] = (skippedKinds[t.highway] || 0) + 1;
    }
    roads.push({ line, kind: t.highway, drivable });
  }
  if (t.building) buildings.push(el);
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir') waterPolys.push(el);
  else if (t.waterway && el.type === 'way') waterLines.push(el);
  if (t.railway === 'rail') rail.push(el);
  if (t.leisure || t.landuse === 'grass' || t.landuse === 'recreation_ground') parks.push(el);
}

// Water just outside the play area, from the wider query (for the preview and river checks).
for (const el of raw.landmarks) {
  if (seen.has(uid(el))) continue;
  const t = el.tags || {};
  if (t.natural === 'water' || t.waterway === 'riverbank') waterPolys.push(el);
  else if (t.waterway) waterLines.push(el);
}

// Drivable road bridges in the wide area.
const bridgeMap = new Map();
for (const el of [...raw.main, ...raw.landmarks]) {
  const t = el.tags || {};
  if (el.type === 'way' && t.highway && DRIVABLE.has(t.highway) && t.bridge && t.bridge !== 'no') bridgeMap.set(el.id, el);
}
const bridges = [...bridgeMap.values()].map((el) => {
  const line = wayLines(el)[0] || [];
  return { el, line, len: lengthM(line), c: centerOf(el) };
});

// Everything with tags, for landmark searching.
const pool = new Map();
for (const el of [...raw.main, ...raw.landmarks]) if (el.tags) pool.set(uid(el), el);

/* ---------- print counts ---------- */
const [x0, z0] = project(BBOX.north, BBOX.west);
const [x1, z1] = project(BBOX.south, BBOX.east);
const widthKm = (x1 - x0) / 1000;
const heightKm = (z1 - z0) / 1000;
const areaKm2 = widthKm * heightKm;
const buildingRels = buildings.filter((b) => b.type === 'relation').length;
const drivableCount = Object.values(roadKinds).reduce((a, b) => a + b, 0);
const sortedEntries = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);

console.log('\n================ Kurnool OSM report ================');
console.log(`OSM data as of ${raw.osmBase ?? 'unknown'} (downloaded ${raw.fetchedAt})`);
console.log(
  `Play area: S${BBOX.south} W${BBOX.west} N${BBOX.north} E${BBOX.east} = ${widthKm.toFixed(1)} x ${heightKm.toFixed(1)} km (${areaKm2.toFixed(1)} km2)`,
);
console.log('\nRoads');
console.log(`  drivable ways: ${drivableCount}, total length ${(drivableM / 1000).toFixed(0)} km`);
console.log('  by type: ' + sortedEntries(roadKinds).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('  skipped (not drivable): ' + sortedEntries(skippedKinds).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('\nBuildings');
console.log(
  `  ${buildings.length} footprints (${buildingRels} multipolygons), ${(buildings.length / areaKm2).toFixed(0)} per km2`,
);
console.log('\nOther');
console.log(`  water areas: ${waterPolys.length}, waterway lines: ${waterLines.length}`);
console.log(`  railway lines: ${rail.length}, parks/grounds: ${parks.length}`);
console.log(`  drivable road bridges (wide area): ${bridges.length}`);

/* ---------- landmarks ---------- */
const SPECS = [
  {
    id: 'fort',
    en: 'Konda Reddy Fort',
    score: (t) => (/konda ?reddy|kondareddy|buruju|burj|కొండారెడ్డి|బురుజు/i.test(allNames(t)) ? 10 + (t.historic ? 5 : 0) - (t.highway ? 6 : 0) : 0),
  },
  {
    id: 'station',
    en: 'Kurnool Railway Station',
    score: (t) => {
      if (t.railway === 'station') return 5 + (/kurnool|కర్నూలు/i.test(allNames(t)) ? 5 : 0);
      return /railway station|రైల్వే స్టేషన్/i.test(allNames(t)) && !t.highway ? 4 : 0;
    },
  },
  {
    id: 'busstand',
    en: 'Kurnool Bus Stand',
    score: (t) => {
      if (t.amenity === 'bus_station') return 5 + (/kurnool|apsrtc|new|central|కర్నూలు/i.test(allNames(t)) ? 5 : 0);
      return /bus ?stand|bus station|apsrtc|బస్ ?స్టాండ్/i.test(allNames(t)) && !t.highway ? 4 : 0;
    },
  },
  {
    id: 'ccamp',
    en: 'C-Camp Centre',
    score: (t) => (/\bc[ .-]*camp\b|సి ?క్యాంప్/i.test(allNames(t)) ? (t.highway ? 5 : 10) : 0),
  },
  {
    id: 'ggh',
    en: 'Govt. General Hospital',
    score: (t) => {
      const n = allNames(t);
      if (t.amenity === 'hospital' && /general hospital|\bggh\b|govt|government|సర్వజన/i.test(n)) return 10;
      return /general hospital|\bggh\b/i.test(n) && !t.highway ? 6 : 0;
    },
  },
  {
    id: 'kmc',
    en: 'Kurnool Medical College',
    score: (t) => {
      if (!/medical college|వైద్య కళాశాల/i.test(allNames(t)) || t.highway) return 0;
      if (/hostel|library|canteen|quarters/i.test(allNames(t))) return 4;
      return t.amenity === 'college' ? 12 : t.building === 'college' ? 11 : 10;
    },
  },
  {
    id: 'rajvihar',
    en: 'Rajvihar Centre',
    score: (t) => (/raj ?vihar|రాజ్ ?విహార్/i.test(allNames(t)) ? (t.highway ? 5 : 10) : 0),
  },
  {
    id: 'akestate',
    en: 'Abdullah Khan Estate',
    score: (t) => (/abdul+ah? ?khan|అబ్దుల్లా ?ఖాన్/i.test(allNames(t)) ? (t.highway ? 5 : 10) : 0),
  },
];

function tagHint(t) {
  for (const k of ['historic', 'railway', 'amenity', 'place', 'highway', 'building', 'landuse']) if (t[k]) return `${k}=${t[k]}`;
  return '';
}

const found = [];
console.log('\nLandmarks (best match first; "outside" = outside the play area)');
for (const spec of SPECS) {
  const cands = [];
  for (const el of pool.values()) {
    const s = spec.score(el.tags);
    if (s <= 0) continue;
    const c = centerOf(el);
    if (!c) continue;
    const [x, z] = xz(c);
    cands.push({ el, s, c, x, z, inside: inBox(c[0], c[1]), d: Math.hypot(x, z) });
  }
  cands.sort((a, b) => b.s - a.s || Number(b.inside) - Number(a.inside) || a.d - b.d);
  const head = spec.id.padEnd(9);
  if (!cands.length) {
    console.log(`  ${head} NOT FOUND   (${spec.en})`);
    found.push({ id: spec.id, en: spec.en, found: false });
    continue;
  }
  const show = (k) =>
    `${label(k.el.tags)} [${tagHint(k.el.tags)}] ${k.c[0].toFixed(5)},${k.c[1].toFixed(5)} x=${k.x} z=${k.z}${k.inside ? '' : ' OUTSIDE'}`;
  console.log(`  ${head} FOUND       ${show(cands[0])}`);
  for (const k of cands.slice(1, 4)) console.log(`  ${''.padEnd(9)}   also:    ${show(k)}`);
  found.push({ id: spec.id, en: spec.en, found: true, x: cands[0].x, z: cands[0].z, name: label(cands[0].el.tags), inside: cands[0].inside });
}

/* ---------- rivers, canals, bridges ---------- */
function waterReport(name, re) {
  const els = [...pool.values()].filter(
    (el) => (el.tags.waterway || el.tags.natural === 'water') && re.test(allNames(el.tags)),
  );
  if (!els.length) {
    console.log(`  ${name.padEnd(12)} NOT FOUND in the wider area`);
    return [];
  }
  const P = els.flatMap((el) => wayLines(el).flat());
  const inside = P.filter((p) => inBox(p[0], p[1])).length;
  let best = null;
  let bd = Infinity;
  for (const p of P) {
    const [x, z] = project(p[0], p[1]);
    const d = Math.hypot(x, z);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  const nameList = [...new Set(els.map((e) => label(e.tags)))].slice(0, 3).join(', ');
  const where = inside ? `${Math.round((100 * inside) / P.length)}% of its points inside the play area` : 'ENTIRELY OUTSIDE the play area';
  console.log(`  ${name.padEnd(12)} FOUND  "${nameList}", ${where}`);
  if (best) console.log(`  ${''.padEnd(12)}        nearest to centre: ${Math.round(bd)} m away at ${best[0].toFixed(5)},${best[1].toFixed(5)}`);
  return P;
}

console.log('\nRivers and canals');
const riverPts = waterReport('Tungabhadra', /tungabhadra|తుంగభద్ర/i);
waterReport('Handri', /handri|హంద్రీ/i);
waterReport('KC Canal', /k[.]? ?c[.]? canal|kurnool.?cuddapah|kurnool.?kadapa/i);

console.log('\nBridges');
const riverXZ = riverPts.map((p) => project(p[0], p[1]));
const nearRiver = (line) =>
  line.some((p) => {
    const [x, z] = project(p[0], p[1]);
    return riverXZ.some(([rx, rz]) => Math.hypot(rx - x, rz - z) < 150);
  });
const tbBridges = riverXZ.length ? bridges.filter((b) => nearRiver(b.line)) : [];
if (!riverXZ.length) console.log('  Tungabhadra not found, so no river bridge check');
else if (!tbBridges.length) console.log('  No drivable road bridge found over the Tungabhadra in the wider area');
for (const b of tbBridges) {
  console.log(
    `  over Tungabhadra: ${label(b.el.tags)} (${b.el.tags.highway}), ${Math.round(b.len)} m, at ${b.c[0].toFixed(5)},${b.c[1].toFixed(5)}${inBox(b.c[0], b.c[1]) ? '' : ' OUTSIDE'}`,
  );
}
const longOnes = bridges.filter((b) => b.len > 60 && !tbBridges.includes(b)).sort((a, b) => b.len - a.len);
console.log(`  other road bridges longer than 60 m: ${longOnes.length}`);
for (const b of longOnes.slice(0, 10)) {
  console.log(
    `    ${label(b.el.tags)} (${b.el.tags.highway}), ${Math.round(b.len)} m, at ${b.c[0].toFixed(5)},${b.c[1].toFixed(5)}${inBox(b.c[0], b.c[1]) ? '' : ' OUTSIDE'}`,
  );
}

/* ---------- preview.html ---------- */
const R = (p) => {
  const [x, z] = project(p[0], p[1]);
  return [Math.round(x), Math.round(z)];
};
const flat = (line) => line.flatMap(R);
const ROAD_CLASS = {
  trunk: 0, trunk_link: 0, primary: 0, primary_link: 0,
  secondary: 1, secondary_link: 1, tertiary: 2, tertiary_link: 2,
  residential: 3, unclassified: 3, road: 3, service: 4, living_street: 4,
};
const data = {
  box: [R([BBOX.north, BBOX.west]), R([BBOX.south, BBOX.east])],
  wide: [R([WIDE.north, WIDE.west]), R([WIDE.south, WIDE.east])],
  roads: roads.filter((r) => r.line.length > 1).map((r) => [r.drivable ? ROAD_CLASS[r.kind] : 5, ...flat(r.line)]),
  buildings: buildings.flatMap(polygons).filter((r) => r.length > 2).map(flat),
  water: waterPolys.flatMap(polygons).filter((r) => r.length > 2).map(flat),
  waterLines: waterLines.flatMap(wayLines).filter((l) => l.length > 1).map(flat),
  rail: rail.flatMap(wayLines).filter((l) => l.length > 1).map(flat),
  parks: parks.flatMap(polygons).filter((r) => r.length > 2).map(flat),
  bridges: bridges.filter((b) => b.line.length > 1).map((b) => flat(b.line)),
  landmarks: found,
  stats: {
    osmBase: raw.osmBase,
    roads: drivableCount,
    roadKm: Math.round(drivableM / 1000),
    buildings: buildings.length,
    sizeKm: `${widthKm.toFixed(1)} x ${heightKm.toFixed(1)} km`,
  },
};
const template = await readFile(new URL('./preview-template.html', import.meta.url), 'utf8');
const html = template.replace('__DATA__', () => JSON.stringify(data).replace(/</g, '\\u003c'));
await writeFile(PREVIEW_PATH, html);
console.log(`\nWrote ${PREVIEW_PATH} (${(html.length / 1e6).toFixed(1)} MB)`);
console.log('Open it through the dev server: http://localhost:5173/scripts/osm/preview.html');
