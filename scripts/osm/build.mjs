// Task 2.1: build public/map/kurnool.json from the OSM snapshot (see docs/ARCHITECTURE.md).
// Deterministic: the same snapshot always gives a byte-identical file.
//
// Usage: npm run map:build
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { BBOX, CENTER, project, DRIVABLE, loadRaw, MAP_OUT_PATH, MAP_PREVIEW_PATH } from './common.mjs';
import {
  wayLines, polygons, allNames, uid, polyLen, ringArea, ringCentroid, pointInRing,
  segDist, segSegDist, selfIntersects, simplify, clipRingToRect, makeRng, hash32,
} from './geo.mjs';
import { SPECS, MANUAL_PINS, rankCandidates, loadLandmarkNames } from './landmarks.mjs';

/* ---------- settings ---------- */
const ROAD_WIDTH = {
  trunk: 14, trunk_link: 14, primary: 14, primary_link: 14,
  secondary: 11, secondary_link: 11, tertiary: 9, tertiary_link: 9,
  residential: 7, unclassified: 7, road: 7, service: 5, living_street: 5,
};
const FLOOR_H = 3.2;
const MIN_BUILDING_AREA = 12; // m2
const ROAD_CLEARANCE = 1; // m kept free beyond half the road width
const SIMPLIFY_TOL = 1; // m
const COMMERCIAL_RADIUS = 350; // m around Rajvihar and the bus stand
const PARK_ROAD_RADIUS = 60; // m either side of Park Road
const CELL = 80; // m, filler grid
const RES = 2; // m, occupancy raster for filler placement
const MAX_FILLER_PER_CELL = 8;

const r1 = (v) => Math.round(v * 10) / 10;
const P = (p) => project(p[0], p[1]);
const byId = (a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.id - b.id);

const raw = await loadRaw();
const names = await loadLandmarkNames();
const main = [...raw.main].sort(byId);
const wide = [...raw.landmarks].sort(byId);

// Play area in metres.
const [paMinX, paMinZ] = project(BBOX.north, BBOX.west);
const [paMaxX, paMaxZ] = project(BBOX.south, BBOX.east);
const PA = { minX: r1(paMinX), minZ: r1(paMinZ), maxX: r1(paMaxX), maxZ: r1(paMaxZ) };
const inPA = (x, z) => x >= PA.minX && x <= PA.maxX && z >= PA.minZ && z <= PA.maxZ;

/** Open ring in metres from a [lat, lon] ring; drops the closing duplicate. */
function toRing(latlon) {
  const r = latlon.map(P);
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  return r;
}
/** Closed outer rings of an element, in metres. Open (broken) rings are skipped. */
function closedRings(el) {
  return polygons(el)
    .filter((l) => l.length > 3 && l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1])
    .map(toRing);
}
/** Rounded to 0.1 m, repeated points removed, positive shoelace area. */
function finishRing(r) {
  const out = [];
  for (const p of r) {
    const q = [r1(p[0]), r1(p[1])];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  if (ringArea(out) < 0) out.reverse();
  return out;
}

/* ---------- simple spatial grid ---------- */
class Grid {
  constructor(cell) {
    this.cell = cell;
    this.map = new Map();
  }
  add(item, x0, z0, x1, z1) {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) {
      for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
        const k = i + ',' + j;
        let list = this.map.get(k);
        if (!list) this.map.set(k, (list = []));
        list.push(item);
      }
    }
  }
  query(x0, z0, x1, z1) {
    const c = this.cell;
    const out = new Set();
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) {
      for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
        const list = this.map.get(i + ',' + j);
        if (list) for (const it of list) out.add(it);
      }
    }
    return out;
  }
}

/* ================= ROADS + GRAPH ================= */
const roadWays = main.filter(
  (el) => el.type === 'way' && el.tags?.highway && DRIVABLE.has(el.tags.highway) && el.geometry && el.nodes,
);

// Split each way into runs that stay inside the play area.
const runs = [];
for (const w of roadWays) {
  const t = w.tags;
  const ids = w.nodes.slice();
  const geo = w.geometry.slice();
  let oneway = ['yes', 'true', '1'].includes(t.oneway) || t.junction === 'roundabout' || t.junction === 'circular';
  if (t.oneway === '-1') {
    ids.reverse();
    geo.reverse();
    oneway = true;
  }
  if (t.oneway === 'no') oneway = false;
  const bridge = !!t.bridge && t.bridge !== 'no';
  let cur = null;
  const flush = () => {
    if (cur && cur.ids.length > 1) runs.push(cur);
    cur = null;
  };
  for (let i = 0; i < ids.length; i++) {
    const g = geo[i];
    const xz = g ? P([g.lat, g.lon]) : null;
    if (!xz || !inPA(xz[0], xz[1])) {
      flush();
      continue;
    }
    if (!cur) cur = { id: w.id, kind: t.highway, oneway, bridge, name: t.name || '', ids: [], xz: [] };
    cur.ids.push(ids[i]);
    cur.xz.push(xz);
  }
  flush();
}

// A node shared by two runs (or a run end) splits roads into graph edges.
const uses = new Map();
for (const r of runs) {
  r.ids.forEach((id, i) => {
    const end = i === 0 || i === r.ids.length - 1;
    uses.set(id, (uses.get(id) || 0) + (end ? 2 : 1));
  });
}

const nodes = [];
const nodeIndex = new Map();
const nodeOf = (id, xz) => {
  let k = nodeIndex.get(id);
  if (k === undefined) {
    k = nodes.length;
    nodeIndex.set(id, k);
    nodes.push([r1(xz[0]), r1(xz[1])]);
  }
  return k;
};

const roads = [];
const edges = [];
const roadNames = []; // build-time only (Park Road lookup, airport link log)
for (const r of runs) {
  const roadIdx = roads.length;
  const out = [];
  let start = 0;
  for (let i = 1; i < r.ids.length; i++) {
    if (i !== r.ids.length - 1 && uses.get(r.ids[i]) < 2) continue;
    const seg = simplify(r.xz.slice(start, i + 1), SIMPLIFY_TOL).map((p) => [r1(p[0]), r1(p[1])]);
    const i0 = out.length ? out.length - 1 : 0;
    if (out.length) out.push(...seg.slice(1));
    else out.push(...seg);
    const i1 = out.length - 1;
    const a = nodeOf(r.ids[start], r.xz[start]);
    const b = nodeOf(r.ids[i], r.xz[i]);
    const len = r1(polyLen(seg));
    if (!(a === b && len < 0.5)) edges.push({ a, b, road: roadIdx, len, i0, i1 });
    start = i;
  }
  roads.push({ id: r.id, kind: r.kind, width: ROAD_WIDTH[r.kind], oneway: r.oneway, bridge: r.bridge, pts: out });
  roadNames.push(r.name);
}

// Road segments for clearance checks.
const segGrid = new Grid(32);
const maxHalfWidth = Math.max(...Object.values(ROAD_WIDTH)) / 2;
for (const road of roads) {
  const hw = road.width / 2;
  for (let i = 1; i < road.pts.length; i++) {
    const a = road.pts[i - 1];
    const b = road.pts[i];
    const s = { a, b, hw };
    segGrid.add(s, Math.min(a[0], b[0]) - hw, Math.min(a[1], b[1]) - hw, Math.max(a[0], b[0]) + hw, Math.max(a[1], b[1]) + hw);
  }
}

/** True if a ring comes closer than half width + clearance to any drivable road. */
function overlapsRoad(ring) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of ring) {
    x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]);
    x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]);
  }
  const m = maxHalfWidth + ROAD_CLEARANCE;
  for (const s of segGrid.query(x0 - m, z0 - m, x1 + m, z1 + m)) {
    const need = s.hw + ROAD_CLEARANCE;
    if (pointInRing(s.a[0], s.a[1], ring) || pointInRing(s.b[0], s.b[1], ring)) return true;
    for (let i = 0, n = ring.length; i < n; i++) {
      if (segSegDist(ring[i], ring[(i + 1) % n], s.a, s.b) < need) return true;
    }
  }
  return false;
}

/* ================= LANDMARKS ================= */
const pool = new Map();
for (const el of [...main, ...wide]) if (el.tags) pool.set(uid(el), el);

const landmarks = [];
const missing = [];
for (const spec of SPECS) {
  const nm = names[spec.id];
  const pin = MANUAL_PINS[spec.id];
  if (pin) {
    const [x, z] = P(pin);
    landmarks.push({ id: spec.id, nameEn: nm.en, nameTe: nm.te, type: spec.type, x: r1(x), z: r1(z) });
    continue;
  }
  const best = rankCandidates(spec, pool).find((k) => inPA(k.x, k.z));
  if (!best) {
    missing.push(spec.id);
    continue;
  }
  const lm = { id: spec.id, nameEn: nm.en, nameTe: nm.te, type: spec.type, x: r1(best.x), z: r1(best.z) };
  if (best.el.type !== 'node') {
    const rings = closedRings(best.el).filter((r) => r.length > 2);
    const ring = rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
    if (ring && Math.abs(ringArea(ring)) < 200000 && !selfIntersects(ring)) {
      const fr = finishRing(simplify([...ring, ring[0]], 0.5).slice(0, -1));
      if (fr.length > 2 && fr.every((p) => inPA(p[0], p[1]))) lm.pts = fr;
    }
  }
  landmarks.push(lm);
}

// Tungabhadra river and its longest road bridge.
const riverPts = [];
for (const el of pool.values()) {
  const t = el.tags;
  if ((t.waterway || t.natural === 'water') && /tungabhadra|తుంగభద్ర/i.test(allNames(t))) {
    for (const line of wayLines(el)) for (const p of line) riverPts.push(P(p));
  }
}
let mainBridge = null;
if (riverPts.length) {
  for (const road of roads) {
    if (!road.bridge) continue;
    const near = road.pts.some(([x, z]) => riverPts.some(([rx, rz]) => Math.hypot(rx - x, rz - z) < 150));
    if (!near) continue;
    const len = polyLen(road.pts);
    if (!mainBridge || len > mainBridge.len) mainBridge = { road, len };
  }
}
if (mainBridge) {
  // Midpoint along the bridge polyline.
  const pts = mainBridge.road.pts;
  let half = mainBridge.len / 2;
  let mid = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (half <= d) {
      const f = d > 0 ? half / d : 0;
      mid = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
      break;
    }
    half -= d;
  }
  landmarks.push({ id: 'bridge', nameEn: names.bridge.en, nameTe: names.bridge.te, type: 'bridge', x: r1(mid[0]), z: r1(mid[1]) });
  // River sign point: nearest river point to the bridge, inside the play area.
  let rp = null;
  let rd = Infinity;
  for (const p of riverPts) {
    if (!inPA(p[0], p[1])) continue;
    const d = Math.hypot(p[0] - mid[0], p[1] - mid[1]);
    if (d > 80 && d < rd) {
      rd = d;
      rp = p;
    }
  }
  if (rp) landmarks.push({ id: 'river', nameEn: names.river.en, nameTe: names.river.te, type: 'river', x: r1(rp[0]), z: r1(rp[1]) });
  else missing.push('river');
} else {
  missing.push('bridge', 'river');
}

const lmById = Object.fromEntries(landmarks.map((l) => [l.id, l]));

/* ================= BUILDINGS ================= */
const commercialCentres = ['rajvihar', 'busstand'].map((id) => lmById[id]).filter(Boolean);
const parkRoadSegs = [];
roads.forEach((road, i) => {
  if (!/park road/i.test(roadNames[i])) return;
  for (let k = 1; k < road.pts.length; k++) parkRoadSegs.push([road.pts[k - 1], road.pts[k]]);
});
function isCommercial(x, z) {
  if (commercialCentres.some((c) => Math.hypot(c.x - x, c.z - z) < COMMERCIAL_RADIUS)) return true;
  return parkRoadSegs.some(([a, b]) => segDist(x, z, a[0], a[1], b[0], b[1]) < PARK_ROAD_RADIUS);
}
function floorsFor(rng, x, z, filler) {
  if (isCommercial(x, z)) return 3 + Math.floor(rng() * 4); // 3..6
  return filler ? 1 + Math.floor(rng() * 3) : 1 + Math.floor(rng() * 4); // 1..3 filler, 1..4 OSM
}

const bStats = { osm: 0, outside: 0, tiny: 0, broken: 0, shrunk: 0, dropped: 0, kept: 0 };
const buildings = [];
const SHRINK = [0.85, 0.7, 0.55];
for (const el of main) {
  const t = el.tags;
  if (!t?.building || (el.type !== 'way' && el.type !== 'relation')) continue;
  bStats.osm++;
  const rings = closedRings(el).filter((r) => r.length > 2);
  if (!rings.length) {
    bStats.broken++;
    continue;
  }
  let ring = rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
  const c = ringCentroid(ring);
  if (!inPA(c[0], c[1])) {
    bStats.outside++;
    continue;
  }
  if (Math.abs(ringArea(ring)) < MIN_BUILDING_AREA) {
    bStats.tiny++;
    continue;
  }
  if (selfIntersects(ring)) {
    bStats.broken++;
    continue;
  }
  if (overlapsRoad(ring)) {
    let fixed = null;
    for (const f of SHRINK) {
      const r = ring.map((p) => [c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f]);
      if (Math.abs(ringArea(r)) >= MIN_BUILDING_AREA && !overlapsRoad(r)) {
        fixed = r;
        break;
      }
    }
    if (!fixed) {
      bStats.dropped++;
      continue;
    }
    ring = fixed;
    bStats.shrunk++;
  }
  const fr = finishRing(ring);
  if (fr.length < 3 || !fr.every((p) => inPA(p[0], p[1])) || selfIntersects(fr)) {
    bStats.broken++;
    continue;
  }
  const levels = parseFloat(t['building:levels']);
  const rng = makeRng(hash32('b', el.type, el.id));
  const floors = Number.isFinite(levels) && levels > 0 && levels < 40 ? levels : floorsFor(rng, c[0], c[1], false);
  const b = { pts: fr, h: r1(floors * FLOOR_H) };
  if (t.building !== 'yes') b.kind = t.building;
  buildings.push(b);
  bStats.kept++;
}

/* ================= WATER, RAIL, PARKS ================= */
const clipPA = (r) => clipRingToRect(r, PA.minX, PA.minZ, PA.maxX, PA.maxZ);
const wStats = { polygons: 0, lineStrips: 0, broken: 0 };
const water = [];
for (const el of main) {
  const t = el.tags || {};
  if (!(t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir')) continue;
  for (const ring of closedRings(el)) {
    const r = clipPA(ring);
    if (r.length < 3 || Math.abs(ringArea(r)) < 50) continue;
    const fr = finishRing(r);
    if (fr.length < 3 || selfIntersects(fr)) {
      wStats.broken++;
      continue;
    }
    water.push({ pts: fr });
    wStats.polygons++;
  }
}
// River and canal centrelines become strips of quads (fallback where OSM has no polygon).
const LINE_WIDTH = { river: 30, canal: 12 };
for (const el of main) {
  const t = el.tags || {};
  if (el.type !== 'way' || !LINE_WIDTH[t.waterway]) continue;
  const tagged = parseFloat(t.width);
  const w = Number.isFinite(tagged) && tagged > 1 && tagged < 300 ? tagged : LINE_WIDTH[t.waterway];
  const line = simplify(wayLines(el)[0].map(P), 2);
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1];
    const [bx, bz] = line[i];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.5) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    const nx = -uz * (w / 2), nz = ux * (w / 2);
    const ex = ux * (w / 4), ez = uz * (w / 4); // overlap neighbours at bends
    const quad = [
      [ax - ex + nx, az - ez + nz], [bx + ex + nx, bz + ez + nz],
      [bx + ex - nx, bz + ez - nz], [ax - ex - nx, az - ez - nz],
    ];
    const r = clipPA(quad);
    if (r.length < 3 || Math.abs(ringArea(r)) < 5) continue;
    water.push({ pts: finishRing(r) });
    wStats.lineStrips++;
  }
}

const rail = [];
for (const el of main) {
  if (el.type !== 'way' || el.tags?.railway !== 'rail') continue;
  let cur = [];
  for (const p of wayLines(el)[0].map(P)) {
    if (inPA(p[0], p[1])) cur.push(p);
    else {
      if (cur.length > 1) rail.push({ pts: simplify(cur, SIMPLIFY_TOL).map((q) => [r1(q[0]), r1(q[1])]) });
      cur = [];
    }
  }
  if (cur.length > 1) rail.push({ pts: simplify(cur, SIMPLIFY_TOL).map((q) => [r1(q[0]), r1(q[1])]) });
}

const parks = [];
let osmParks = 0;
for (const el of main) {
  const t = el.tags || {};
  const isPark = /^(park|garden|playground|stadium|pitch)$/.test(t.leisure || '') || /^(grass|recreation_ground)$/.test(t.landuse || '');
  if (!isPark) continue;
  for (const ring of closedRings(el)) {
    const r = clipPA(ring);
    if (r.length < 3 || Math.abs(ringArea(r)) < 50) continue;
    const fr = finishRing(r);
    if (fr.length < 3 || selfIntersects(fr)) continue;
    parks.push({ pts: fr });
    osmParks++;
  }
}

/* ================= FILLER (parks + simple buildings) ================= */
const GW = Math.ceil((PA.maxX - PA.minX) / RES);
const GH = Math.ceil((PA.maxZ - PA.minZ) / RES);
const occ = new Uint8Array(GW * GH);

function fillRing(ring) {
  let z0 = Infinity, z1 = -Infinity;
  for (const p of ring) {
    z0 = Math.min(z0, p[1]);
    z1 = Math.max(z1, p[1]);
  }
  const j0 = Math.max(0, Math.floor((z0 - PA.minZ) / RES));
  const j1 = Math.min(GH - 1, Math.floor((z1 - PA.minZ) / RES));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const zc = PA.minZ + (j + 0.5) * RES;
    xs.length = 0;
    for (let k = 0, n = ring.length; k < n; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % n];
      if ((a[1] <= zc && b[1] > zc) || (b[1] <= zc && a[1] > zc)) xs.push(a[0] + ((zc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.floor((xs[k] - PA.minX) / RES));
      const i1 = Math.min(GW - 1, Math.floor((xs[k + 1] - PA.minX) / RES));
      for (let i = i0; i <= i1; i++) occ[j * GW + i] = 1;
    }
  }
}
function fillCapsule(a, b, r) {
  const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - r - PA.minX) / RES));
  const i1 = Math.min(GW - 1, Math.floor((Math.max(a[0], b[0]) + r - PA.minX) / RES));
  const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - r - PA.minZ) / RES));
  const j1 = Math.min(GH - 1, Math.floor((Math.max(a[1], b[1]) + r - PA.minZ) / RES));
  for (let j = j0; j <= j1; j++) {
    const zc = PA.minZ + (j + 0.5) * RES;
    for (let i = i0; i <= i1; i++) {
      const xc = PA.minX + (i + 0.5) * RES;
      if (segDist(xc, zc, a[0], a[1], b[0], b[1]) <= r) occ[j * GW + i] = 1;
    }
  }
}
function rectFree(w, d, cx, cz, ux, uz) {
  const nx = -uz, nz = ux;
  for (let a = -w / 2; a <= w / 2 + 1e-6; a += Math.min(1.5, w / 2)) {
    for (let b = -d / 2; b <= d / 2 + 1e-6; b += Math.min(1.5, d / 2)) {
      const x = cx + ux * a + nx * b;
      const z = cz + uz * a + nz * b;
      const i = Math.floor((x - PA.minX) / RES);
      const j = Math.floor((z - PA.minZ) / RES);
      if (i < 0 || j < 0 || i >= GW || j >= GH || occ[j * GW + i]) return false;
    }
  }
  return true;
}
function rectRing(cx, cz, ux, uz, w, d) {
  const nx = -uz, nz = ux, hw = w / 2, hd = d / 2;
  return [
    [cx - ux * hw - nx * hd, cz - uz * hw - nz * hd],
    [cx + ux * hw - nx * hd, cz + uz * hw - nz * hd],
    [cx + ux * hw + nx * hd, cz + uz * hw + nz * hd],
    [cx - ux * hw + nx * hd, cz - uz * hw + nz * hd],
  ];
}

// Everything already on the ground blocks filler.
for (const b of buildings) fillRing(b.pts);
for (const w of water) fillRing(w.pts);
for (const p of parks) fillRing(p.pts);
for (const lm of landmarks) if (lm.pts) fillRing(lm.pts);
for (const road of roads) {
  const r = road.width / 2 + 1.5;
  for (let i = 1; i < road.pts.length; i++) fillCapsule(road.pts[i - 1], road.pts[i], r);
}
for (const rl of rail) for (let i = 1; i < rl.pts.length; i++) fillCapsule(rl.pts[i - 1], rl.pts[i], 4);
// Keep plazas around point landmarks clear.
for (const lm of landmarks) if (!lm.pts) fillCapsule([lm.x, lm.z], [lm.x, lm.z], 25);

// Per-cell OSM building counts and road segments.
const CW = Math.ceil((PA.maxX - PA.minX) / CELL);
const CH = Math.ceil((PA.maxZ - PA.minZ) / CELL);
const cellBuildings = new Uint16Array(CW * CH);
const cellSegs = new Map();
const cellOf = (x, z) => {
  const i = Math.floor((x - PA.minX) / CELL);
  const j = Math.floor((z - PA.minZ) / CELL);
  return i >= 0 && j >= 0 && i < CW && j < CH ? j * CW + i : -1;
};
for (const b of buildings) {
  const c = ringCentroid(b.pts);
  const k = cellOf(c[0], c[1]);
  if (k >= 0) cellBuildings[k]++;
}
for (const road of roads) {
  if (road.bridge) continue;
  for (let i = 1; i < road.pts.length; i++) {
    const a = road.pts[i - 1];
    const b = road.pts[i];
    const k = cellOf((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    if (k < 0) continue;
    let list = cellSegs.get(k);
    if (!list) cellSegs.set(k, (list = []));
    list.push({ a, b, hw: road.width / 2 });
  }
}

let fillerBuildings = 0;
let fillerParks = 0;
const fillerRings = []; // for the preview only
for (let j = 0; j < CH; j++) {
  for (let i = 0; i < CW; i++) {
    const k = j * CW + i;
    const segs = cellSegs.get(k);
    if (!segs || cellBuildings[k] > 3) continue;
    const roadLen = segs.reduce((s, g) => s + Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]), 0);
    if (roadLen < 60) continue;
    const rng = makeRng(hash32('cell', i, j));
    const longest = segs.reduce((m, g) => (Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) > Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]) ? g : m));
    const L0 = Math.hypot(longest.b[0] - longest.a[0], longest.b[1] - longest.a[1]);
    const ux0 = (longest.b[0] - longest.a[0]) / L0, uz0 = (longest.b[1] - longest.a[1]) / L0;

    if (rng() < 0.2) {
      // Park cell: one or two green patches aligned with the main road.
      let placed = 0;
      for (let tries = 0; tries < 10 && placed < 2; tries++) {
        const w = 24 + rng() * 20, d = 24 + rng() * 20;
        const cx = PA.minX + (i + rng()) * CELL, cz = PA.minZ + (j + rng()) * CELL;
        if (!rectFree(w, d, cx, cz, ux0, uz0)) continue;
        const ring = rectRing(cx, cz, ux0, uz0, w, d);
        fillRing(ring);
        parks.push({ pts: finishRing(ring) });
        placed++;
        fillerParks++;
      }
      continue;
    }

    // Building cell: a row of simple houses along each road segment.
    let placed = 0;
    for (const g of segs) {
      if (placed >= MAX_FILLER_PER_CELL) break;
      const L = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]);
      if (L < 12) continue;
      const ux = (g.b[0] - g.a[0]) / L, uz = (g.b[1] - g.a[1]) / L;
      const nx = -uz, nz = ux;
      for (let s = 6 + rng() * 6; s < L - 6 && placed < MAX_FILLER_PER_CELL; s += 16 + rng() * 8) {
        for (const side of [-1, 1]) {
          if (placed >= MAX_FILLER_PER_CELL || rng() > 0.7) continue;
          const w = 7 + rng() * 5, d = 8 + rng() * 6;
          const off = g.hw + 2 + d / 2;
          const cx = g.a[0] + ux * s + nx * side * off;
          const cz = g.a[1] + uz * s + nz * side * off;
          if (!rectFree(w, d, cx, cz, ux, uz)) continue;
          const ring = rectRing(cx, cz, ux, uz, w, d);
          fillRing(ring);
          const fr = finishRing(ring);
          const floors = floorsFor(rng, cx, cz, true);
          buildings.push({ pts: fr, h: r1(floors * FLOOR_H), kind: 'filler' });
          fillerRings.push(fr);
          placed++;
          fillerBuildings++;
        }
      }
    }
  }
}

/* ================= AIRPORT + LINK ROAD ================= */
// Pulled in to about 1.5 km east of the play area (MAP-SPEC), linked from the
// biggest road that reaches the east edge (trunk, then primary, then secondary).
// In this snapshot no trunk or primary reaches the east edge, so it is MDR090.
const LINK_PENALTY = { trunk: 0, primary: 150, secondary: 300 };
let linkNode = -1;
let linkScore = Infinity;
let linkRoad = -1;
for (const e of edges) {
  const road = roads[e.road];
  if (!(road.kind in LINK_PENALTY)) continue;
  for (const n of [e.a, e.b]) {
    const s = PA.maxX - nodes[n][0] + LINK_PENALTY[road.kind];
    if (s < linkScore && PA.maxX - nodes[n][0] < 400) {
      linkScore = s;
      linkNode = n;
      linkRoad = e.road;
    }
  }
}
if (linkNode < 0) throw new Error('No trunk, primary or secondary road within 400 m of the east edge to link the airport');
const [lx, lz] = nodes[linkNode];
const RUNWAY_LEN = 1200;
const RUNWAY_W = 30;
const runway = { x: r1(PA.maxX + 1500 + RUNWAY_LEN / 2), z: r1(lz - 250), len: RUNWAY_LEN, w: RUNWAY_W, heading: Math.round((Math.PI / 2) * 1000) / 1000 };
const termCx = runway.x - 300;
const termCz = runway.z + 140;
const terminal = { pts: finishRing(rectRing(termCx, termCz, 1, 0, 140, 40)) };
const linkPts = [
  [lx, lz],
  [r1(PA.maxX + 600), lz],
  [r1(PA.maxX + 1100), r1(termCz + 80)],
  [r1(termCx), r1(termCz + 80)],
];
const linkIdx = roads.length;
roads.push({ id: -1, kind: 'trunk', width: 14, oneway: false, bridge: false, pts: linkPts });
const airportNode = nodes.length;
nodes.push(linkPts[linkPts.length - 1]);
edges.push({ a: linkNode, b: airportNode, road: linkIdx, len: r1(polyLen(linkPts)), i0: 0, i1: linkPts.length - 1 });

/* ================= SPAWN ================= */
const spawnLm = lmById.rajvihar;
if (!spawnLm) throw new Error('Rajvihar landmark not found, cannot place the spawn point');
let spawnNode = 0;
let sd = Infinity;
nodes.forEach(([x, z], n) => {
  const d = Math.hypot(x - spawnLm.x, z - spawnLm.z);
  if (d < sd) {
    sd = d;
    spawnNode = n;
  }
});
const spawnEdge = edges.find((e) => e.a === spawnNode || e.b === spawnNode);
const sp = roads[spawnEdge.road].pts;
const [sx, sz] = nodes[spawnNode];
const [tx, tz] = spawnEdge.a === spawnNode ? sp[spawnEdge.i0 + 1] : sp[spawnEdge.i1 - 1];
const spawn = { x: sx, z: sz, heading: Math.round(Math.atan2(tx - sx, tz - sz) * 1000) / 1000 };

/* ================= ASSEMBLE + VALIDATE ================= */
const bounds = {
  minX: PA.minX,
  minZ: r1(Math.min(PA.minZ, runway.z - 300)),
  maxX: r1(Math.max(PA.maxX, runway.x + RUNWAY_LEN / 2 + 200)),
  maxZ: r1(Math.max(PA.maxZ, termCz + 300)),
};
const map = {
  version: 1,
  center: { lat: CENTER.lat, lon: CENTER.lon },
  bounds,
  playArea: PA,
  roads,
  graph: { nodes, edges },
  buildings,
  water,
  parks,
  rail,
  landmarks,
  airport: { runway, terminal },
  spawn,
  meta: { osmBase: raw.osmBase, credit: '© OpenStreetMap contributors' },
};

function validate(m) {
  const errs = [];
  const err = (s) => errs.length < 40 && errs.push(s);
  const B = m.bounds;
  const pt = (p, what) => {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) err(`${what}: not a finite point`);
    else if (p[0] < B.minX - 0.05 || p[0] > B.maxX + 0.05 || p[1] < B.minZ - 0.05 || p[1] > B.maxZ + 0.05) err(`${what}: outside bounds (${p})`);
  };
  const poly = (pts, what, checkCross = true) => {
    if (!Array.isArray(pts) || pts.length < 3) return err(`${what}: fewer than 3 points`);
    pts.forEach((p, i) => pt(p, `${what} point ${i}`));
    if (checkCross && selfIntersects(pts)) err(`${what}: self-crossing`);
  };
  if (m.version !== 1) err('version is not 1');
  for (const k of ['minX', 'minZ', 'maxX', 'maxZ']) if (!Number.isFinite(B[k])) err(`bounds.${k} not finite`);
  m.roads.forEach((r, i) => {
    if (!Number.isFinite(r.width) || r.width <= 0) err(`road ${i}: bad width`);
    if (r.pts.length < 2) err(`road ${i}: fewer than 2 points`);
    r.pts.forEach((p, k) => pt(p, `road ${i} point ${k}`));
  });
  m.graph.nodes.forEach((p, i) => pt(p, `graph node ${i}`));
  m.graph.edges.forEach((e, i) => {
    if (!(e.a >= 0 && e.a < m.graph.nodes.length && e.b >= 0 && e.b < m.graph.nodes.length)) err(`edge ${i}: bad node index`);
    const road = m.roads[e.road];
    if (!road) return err(`edge ${i}: bad road index`);
    if (!(e.i0 >= 0 && e.i0 < e.i1 && e.i1 < road.pts.length)) err(`edge ${i}: bad point range`);
    if (!Number.isFinite(e.len) || e.len < 0) err(`edge ${i}: bad length`);
  });
  m.buildings.forEach((b, i) => {
    poly(b.pts, `building ${i}`);
    if (!Number.isFinite(b.h) || b.h <= 0) err(`building ${i}: bad height`);
  });
  m.water.forEach((w, i) => poly(w.pts, `water ${i}`));
  m.parks.forEach((p, i) => poly(p.pts, `park ${i}`));
  m.rail.forEach((r, i) => r.pts.forEach((p, k) => pt(p, `rail ${i} point ${k}`)));
  m.landmarks.forEach((l) => {
    pt([l.x, l.z], `landmark ${l.id}`);
    if (!l.nameEn || !l.nameTe) err(`landmark ${l.id}: missing name`);
    if (l.pts) poly(l.pts, `landmark ${l.id} outline`);
  });
  pt([m.airport.runway.x, m.airport.runway.z], 'runway');
  poly(m.airport.terminal.pts, 'terminal');
  pt([m.spawn.x, m.spawn.z], 'spawn');
  if (!Number.isFinite(m.spawn.heading)) err('spawn heading not finite');
  if (errs.length) throw new Error(`Map validation failed:\n  ${errs.join('\n  ')}`);
}
validate(map);

const json = JSON.stringify(map);
await mkdir(dirname(MAP_OUT_PATH), { recursive: true });
await writeFile(MAP_OUT_PATH, json);
const gzBytes = gzipSync(json, { level: 9 }).length;
const sha = createHash('sha256').update(json).digest('hex').slice(0, 16);

/* ================= REPORT ================= */
console.log('\n================ Kurnool map build ================');
console.log(`Wrote public/map/kurnool.json: ${(json.length / 1e6).toFixed(2)} MB (gzip ${(gzBytes / 1e6).toFixed(2)} MB), sha256 ${sha}`);
console.log(`Roads: ${roads.length - 1} from OSM + 1 airport link, graph ${nodes.length} nodes / ${edges.length} edges`);
console.log(
  `Buildings: ${bStats.kept} from OSM (${bStats.shrunk} shrunk off roads) + ${fillerBuildings} filler = ${buildings.length}. ` +
    `Dropped: ${bStats.dropped} on roads, ${bStats.tiny} tiny, ${bStats.broken} broken, ${bStats.outside} outside`,
);
console.log(`Parks: ${osmParks} from OSM + ${fillerParks} filler. Water: ${wStats.polygons} polygons + ${wStats.lineStrips} river/canal strips (${wStats.broken} broken dropped). Rail: ${rail.length}`);
console.log(`Landmarks: ${landmarks.map((l) => l.id).join(', ')}`);
if (missing.length) console.log(`MISSING landmarks (need a pin from Bunny in scripts/osm/landmarks.mjs MANUAL_PINS): ${missing.join(', ')}`);
console.log(`Airport link from "${roadNames[linkRoad] || 'unnamed ' + roads[linkRoad].kind}" at x=${lx} z=${lz}; runway at x=${runway.x} z=${runway.z}`);
console.log(`Spawn: x=${spawn.x} z=${spawn.z} heading=${spawn.heading} (${Math.round(sd)} m from Rajvihar)`);

/* ================= PREVIEW ================= */
const ROAD_CLASS = {
  trunk: 0, trunk_link: 0, primary: 0, primary_link: 0,
  secondary: 1, secondary_link: 1, tertiary: 2, tertiary_link: 2,
  residential: 3, unclassified: 3, road: 3, service: 4, living_street: 4,
};
const flat = (pts) => pts.flatMap((p) => [Math.round(p[0]), Math.round(p[1])]);
const runwayRing = rectRing(runway.x, runway.z, 1, 0, RUNWAY_LEN, RUNWAY_W);
const preview = {
  box: [[PA.minX, PA.minZ], [PA.maxX, PA.maxZ]],
  wide: [[bounds.minX, bounds.minZ], [bounds.maxX, bounds.maxZ]],
  roads: roads.map((r) => [ROAD_CLASS[r.kind], ...flat(r.pts)]),
  buildings: [...buildings.filter((b) => b.kind !== 'filler').map((b) => flat(b.pts)), flat(runwayRing), flat(terminal.pts)],
  filler: fillerRings.map(flat),
  water: water.map((w) => flat(w.pts)),
  waterLines: [],
  rail: rail.map((r) => flat(r.pts)),
  parks: parks.map((p) => flat(p.pts)),
  bridges: roads.filter((r) => r.bridge).map((r) => flat(r.pts)),
  landmarks: [
    ...landmarks.map((l) => ({ id: l.id, en: l.nameEn, found: true, inside: true, x: l.x, z: l.z })),
    ...missing.map((id) => ({ id, en: names[id]?.en ?? id, found: false })),
  ],
  stats: {
    title: 'Kurnool map preview (built map)',
    osmBase: raw.osmBase,
    roads: roads.length,
    roadKm: Math.round(roads.reduce((s, r) => s + polyLen(r.pts), 0) / 1000),
    buildings: buildings.length,
    sizeKm: `${((PA.maxX - PA.minX) / 1000).toFixed(1)} x ${((PA.maxZ - PA.minZ) / 1000).toFixed(1)} km`,
  },
};
const template = await readFile(new URL('./preview-template.html', import.meta.url), 'utf8');
await writeFile(MAP_PREVIEW_PATH, template.replace('__DATA__', () => JSON.stringify(preview).replace(/</g, '\\u003c')));
console.log(`Preview: scripts/osm/map-preview.html`);
