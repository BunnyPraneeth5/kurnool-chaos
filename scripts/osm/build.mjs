// Task 2.1: build public/map/kurnool.json from the OSM snapshot (see docs/ARCHITECTURE.md).
// Deterministic: the same snapshot always gives a byte-identical file.
//
// Usage: npm run map:build
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { BBOX, CENTER, project, unproject, loadEarthEngine, DRIVABLE, loadRaw, loadOverture, loadDetails, loadCorrections, MAP_OUT_PATH, TERRAIN_OUT_PATH, MAP_PREVIEW_PATH } from './common.mjs';
import {
  wayLines, polygons, centerOf, allNames, uid, polyLen, ringArea, ringCentroid, pointInRing,
  segDist, segSegDist, selfIntersects, simplify, clipRingToRect, makeRng, hash32,
} from './geo.mjs';
import { contours } from './contour.mjs';
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
const corrections = await loadCorrections();
const details = await loadDetails();
const eeGrids = await loadEarthEngine();
/** Fractional pixel position of local metres on an Earth Engine lat/lon grid (pixel i covers i..i+1). */
const gridPx = (g, x, z) => {
  const [lat, lon] = unproject(x, z);
  return [(lon - g.west) / g.dLon, (g.north - lat) / g.dLat];
};
const gridCell = (g, i, j) => (i >= 0 && j >= 0 && i < g.width && j < g.height ? g.data[j * g.width + i] : 0);
/** Bilinear value of a grid at local metres. */
function gridSample(g, x, z) {
  const [fi, fj] = gridPx(g, x, z);
  const u = fi - 0.5, v = fj - 0.5;
  const i = Math.floor(u), j = Math.floor(v);
  const fx = u - i, fy = v - j;
  return gridCell(g, i, j) * (1 - fx) * (1 - fy) + gridCell(g, i + 1, j) * fx * (1 - fy) + gridCell(g, i, j + 1) * (1 - fx) * fy + gridCell(g, i + 1, j + 1) * fx * fy;
}
const applied = []; // corrections report
const normName = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const main = [...raw.main].sort(byId);
const wide = [...raw.landmarks].sort(byId);
const detailEls = [...details.elements].sort(byId);

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
  const tunnel = t.tunnel === 'yes';
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
    if (!cur) cur = { id: w.id, kind: t.highway, oneway, bridge, tunnel, name: t.name || '', ids: [], xz: [] };
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
const roadTunnel = []; // build-time only: OSM tunnel=yes (underpasses)
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
  roadTunnel.push(r.tunnel);
  roadNames.push(r.name);
}

/* ---------- Flyovers and underpasses (task K.5) ---------- */
// OSM bridges that cross another road or the railway are flyovers: raised FLYOVER_H, with ramps
// down the connecting road ways at RAMP_GRADE. OSM tunnels (roads under the railway) are dug
// UNDERPASS_D into the terrain the same way. Positive lifts go into the map (road.lift, metres
// per point); dips are cut into the terrain grid (see TERRAIN).
const FLYOVER_H = 6.5;
const UNDERPASS_D = 5.5;
const RAMP_GRADE = 0.06;
const railRawLines = main.filter((el) => el.type === 'way' && el.tags?.railway === 'rail').map((el) => wayLines(el)[0].map(P));
function crossesLines(pts, lines) {
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i];
    for (const l of lines) {
      for (let k = 1; k < l.length; k++) {
        const a = l[k - 1], b = l[k];
        const d1x = q[0] - p[0], d1z = q[1] - p[1], d2x = b[0] - a[0], d2z = b[1] - a[1];
        const den = d1x * d2z - d1z * d2x;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((a[0] - p[0]) * d2z - (a[1] - p[1]) * d2x) / den;
        const u = ((a[0] - p[0]) * d1z - (a[1] - p[1]) * d1x) / den;
        if (t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98) return true;
      }
    }
  }
  return false;
}
const groundRoadLines = roads.filter((r) => !r.bridge).map((r) => r.pts);
const lifts = roads.map(() => null); // per road: lift (+ up, - down) at each point, or null
const gStats = { flyovers: 0, underpasses: 0, ramps: 0 };
const setLift = (ri, k, v) => {
  if (!lifts[ri]) lifts[ri] = new Array(roads[ri].pts.length).fill(0);
  const cur = lifts[ri][k];
  lifts[ri][k] = Math.abs(v) > Math.abs(cur) ? v : cur;
};
const samePt = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5;
/** Ramp from road ri's start (atStart) or end, going away from it down the best continuation. */
function ramp(ri, atStart, H, depth) {
  const pts = roads[ri].pts;
  const P0 = atStart ? pts[0] : pts[pts.length - 1];
  const P1 = atStart ? pts[1] : pts[pts.length - 2];
  const ox = P0[0] - P1[0], oz = P0[1] - P1[1];
  const ol = Math.hypot(ox, oz) || 1;
  let best = null;
  roads.forEach((r, j) => {
    if (j === ri || r.bridge || r.pts.length < 2 || r.id === -1) return;
    for (const fromStart of [true, false]) {
      const a = fromStart ? r.pts[0] : r.pts[r.pts.length - 1];
      const b = fromStart ? r.pts[1] : r.pts[r.pts.length - 2];
      if (!samePt(a, P0)) continue;
      const cx = b[0] - a[0], cz = b[1] - a[1];
      const dot = (ox * cx + oz * cz) / (ol * (Math.hypot(cx, cz) || 1));
      if (dot > 0.6 && (!best || dot > best.dot)) best = { j, fromStart, dot };
    }
  });
  if (!best) return;
  const rp = roads[best.j].pts;
  const order = best.fromStart ? rp.map((_, k) => k) : rp.map((_, k) => rp.length - 1 - k);
  const R = Math.abs(H) / RAMP_GRADE;
  let sAt = 0;
  let Lr = R;
  // The ramp ends at the first point at or past R, so it never stops mid-segment.
  for (let n = 1; n < order.length; n++) {
    sAt += Math.hypot(rp[order[n]][0] - rp[order[n - 1]][0], rp[order[n]][1] - rp[order[n - 1]][1]);
    if (sAt >= R) {
      Lr = sAt;
      break;
    }
  }
  let s = 0;
  for (let n = 0; n < order.length; n++) {
    if (n) s += Math.hypot(rp[order[n]][0] - rp[order[n - 1]][0], rp[order[n]][1] - rp[order[n - 1]][1]);
    if (s > Lr) break;
    setLift(best.j, order[n], H * Math.max(0, 1 - s / Lr));
  }
  gStats.ramps++;
  if (s < R && depth < 4) ramp(best.j, !best.fromStart, H * (1 - s / R), depth + 1);
}
roads.forEach((r, ri) => {
  if (r.id === -1 || r.pts.length < 2) return;
  let H = 0;
  if (roadTunnel[ri]) {
    H = -UNDERPASS_D;
    gStats.underpasses++;
  } else if (r.bridge && (crossesLines(r.pts, railRawLines) || crossesLines(r.pts, groundRoadLines))) {
    H = FLYOVER_H;
    gStats.flyovers++;
  }
  if (!H) return;
  r.pts.forEach((_, k) => setLift(ri, k, H));
  ramp(ri, true, H, 0);
  ramp(ri, false, H, 0);
});
roads.forEach((r, ri) => {
  if (lifts[ri] && lifts[ri].some((v) => v > 0.05)) r.lift = lifts[ri].map((v) => r1(Math.max(0, v)));
});

// Road segments for clearance checks.
const segGrid = new Grid(32);
const maxHalfWidth = Math.max(...Object.values(ROAD_WIDTH)) / 2;
for (const [ri, road] of roads.entries()) {
  const hw = road.width / 2;
  for (let i = 1; i < road.pts.length; i++) {
    const a = road.pts[i - 1];
    const b = road.pts[i];
    const s = { a, b, hw, road: ri };
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
  const pin = corrections.landmarkPins[spec.id] ?? MANUAL_PINS[spec.id];
  if (corrections.landmarkPins[spec.id]) applied.push(`landmark pin ${spec.id}`);
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

const SHRINK = [0.85, 0.7, 0.55];
/**
 * Road clean-up shared by every building source: rings that block a road are shrunk toward
 * their centre (85/70/55%). Returns the finished ring, or a reason string when it is dropped.
 */
function fitBuilding(ring, c, stats) {
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
      stats.dropped++;
      return null;
    }
    ring = fixed;
    stats.shrunk++;
  }
  const fr = finishRing(ring);
  if (fr.length < 3 || !fr.every((p) => inPA(p[0], p[1])) || selfIntersects(fr)) {
    stats.broken++;
    return null;
  }
  return fr;
}

const bStats = { osm: 0, outside: 0, tiny: 0, broken: 0, shrunk: 0, dropped: 0, kept: 0 };
const buildings = [];
const osmFootprints = []; // every usable OSM outline before road clean-up, so Overture never re-adds one
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
  osmFootprints.push(ring);
  const fr = fitBuilding(ring, c, bStats);
  if (!fr) continue;
  const levels = parseFloat(t['building:levels']);
  const rng = makeRng(hash32('b', el.type, el.id));
  const floors = Number.isFinite(levels) && levels > 0 && levels < 40 ? levels : floorsFor(rng, c[0], c[1], false);
  const b = { pts: fr, h: r1(floors * FLOOR_H), seed: hash32('b', el.type, el.id), real: floors === levels };
  if (t.building !== 'yes') b.kind = t.building;
  buildings.push(b);
  bStats.kept++;
}

/* ---------- Overture buildings (task K.1): only where OSM has none ---------- */
// A 2 m raster of every OSM outline. An Overture building is skipped if more than
// OV_MAX_COVER of it lies on an OSM building (Overture already merges OSM, Microsoft
// and Google outlines, so its own buildings do not overlap each other).
const OV_RES = 2;
const OV_MAX_COVER = 0.2;
const OV_SIMPLIFY = 0.5; // m
const ovW = Math.ceil((PA.maxX - PA.minX) / OV_RES);
const ovH = Math.ceil((PA.maxZ - PA.minZ) / OV_RES);
const osmOcc = new Uint8Array(ovW * ovH);
/** Calls fn(index) for each raster cell whose centre is inside the ring. */
function scanRing(ring, fn) {
  let z0 = Infinity, z1 = -Infinity;
  for (const p of ring) {
    z0 = Math.min(z0, p[1]);
    z1 = Math.max(z1, p[1]);
  }
  const j0 = Math.max(0, Math.floor((z0 - PA.minZ) / OV_RES));
  const j1 = Math.min(ovH - 1, Math.floor((z1 - PA.minZ) / OV_RES));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const zc = PA.minZ + (j + 0.5) * OV_RES;
    xs.length = 0;
    for (let k = 0, n = ring.length; k < n; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % n];
      if ((a[1] <= zc && b[1] > zc) || (b[1] <= zc && a[1] > zc)) xs.push(a[0] + ((zc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - PA.minX) / OV_RES - 0.5));
      const i1 = Math.min(ovW - 1, Math.floor((xs[k + 1] - PA.minX) / OV_RES - 0.5));
      for (let i = i0; i <= i1; i++) fn(j * ovW + i);
    }
  }
}
for (const r of osmFootprints) scanRing(r, (k) => (osmOcc[k] = 1));
/** Share of a ring's raster cells already on an OSM building (centroid cell for tiny rings). */
function osmCover(ring, c) {
  let n = 0, hit = 0;
  scanRing(ring, (k) => {
    n++;
    hit += osmOcc[k];
  });
  if (n === 0) {
    const i = Math.floor((c[0] - PA.minX) / OV_RES);
    const j = Math.floor((c[1] - PA.minZ) / OV_RES);
    return i >= 0 && j >= 0 && i < ovW && j < ovH ? osmOcc[j * ovW + i] : 0;
  }
  return hit / n;
}

const overture = await loadOverture();
const oStats = { total: 0, outside: 0, tiny: 0, broken: 0, onOsm: 0, shrunk: 0, dropped: 0, kept: 0, realHeight: 0, realFloors: 0 };
const oBySource = {};
for (const f of overture.buildings) {
  oStats.total++;
  let ring = toRing(f.ring.map(([lon, lat]) => [lat, lon]));
  if (ring.length < 3) {
    oStats.broken++;
    continue;
  }
  ring = simplify([...ring, ring[0]], OV_SIMPLIFY).slice(0, -1);
  const c = ringCentroid(ring);
  if (!inPA(c[0], c[1])) {
    oStats.outside++;
    continue;
  }
  if (ring.length < 3 || selfIntersects(ring)) {
    oStats.broken++;
    continue;
  }
  if (Math.abs(ringArea(ring)) < MIN_BUILDING_AREA) {
    oStats.tiny++;
    continue;
  }
  if (osmCover(ring, c) > OV_MAX_COVER) {
    oStats.onOsm++;
    continue;
  }
  const fr = fitBuilding(ring, c, oStats);
  if (!fr) continue;
  let h;
  let real = true;
  if (Number.isFinite(f.h) && f.h >= 2.5 && f.h < 120) {
    h = f.h;
    oStats.realHeight++;
  } else if (Number.isInteger(f.floors) && f.floors > 0 && f.floors < 40) {
    h = f.floors * FLOOR_H;
    oStats.realFloors++;
  } else {
    h = floorsFor(makeRng(hash32('ov', f.id)), c[0], c[1], false) * FLOOR_H;
    real = false;
  }
  const b = { pts: fr, h: r1(h), seed: hash32('ov', f.id), real };
  if (f.class) b.kind = f.class;
  buildings.push(b);
  oStats.kept++;
  const src = f.src.join('+');
  oBySource[src] = (oBySource[src] || 0) + 1;
}

/* ================= WATER, RAIL, PARKS ================= */
const clipPA = (r) => clipRingToRect(r, PA.minX, PA.minZ, PA.maxX, PA.maxZ);
const wStats = { polygons: 0, lineStrips: 0, broken: 0, satellite: 0, satelliteHoles: 0, satelliteSkipped: 0 };
const riverbed = []; // river line strips: sandy bed in the game, no buildings, water only where the satellite sees it
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
// River and canal centrelines (OSM has no outline for the KC Canal or the Handri) become
// strips of quads in `water` (drawn and solid), and are also kept as lines in `waterways`
// for banks and canal walls. Aqueducts (the KC Canal over the Handri) are drawn raised and
// culverts (under roads) are not drawn, so neither goes into `water`.
const LINE_WIDTH = { river: 30, canal: 12 };
// Width from the satellite water map (Dynamic World, 90th percentile over a year): every 20 m,
// look across the line for the wettest spot near it and measure the water there.
const WET = 50; // percent water probability counted as water (halfway across a blurred edge)
const eeWidths = [];
function measureWidth(line, kind) {
  const maxHalf = kind === 'river' ? 150 : 40;
  const search = kind === 'river' ? 40 : 15;
  const widths = [];
  const offsets = [];
  let stations = 0;
  let along = 0;
  let next = 10;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    const nx = -uz, nz = ux;
    while (next <= along + L) {
      const t = next - along;
      const cx = a[0] + ux * t, cz = a[1] + uz * t;
      next += 20;
      stations++;
      const p = (s) => gridSample(eeGrids.water, cx + nx * s, cz + nz * s);
      let best = -1, bs = 0;
      for (let s = -search; s <= search; s++) {
        const v = p(s);
        if (v > best) {
          best = v;
          bs = s;
        }
      }
      if (best < WET) continue;
      let l = bs, r = bs;
      while (l > -maxHalf && p(l - 1) >= WET) l--;
      while (r < maxHalf && p(r + 1) >= WET) r++;
      if (l <= -maxHalf || r >= maxHalf) continue; // runs into a lake or the big river, not a channel width
      widths.push(r - l + 1);
      offsets.push((l + r) / 2);
    }
    along += L;
  }
  const med = (arr) => {
    const v = [...arr].sort((x, y) => x - y);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  const wet = widths.length;
  const ok = wet >= 3 && wet >= stations * 0.3;
  const width = ok ? Math.min(kind === 'river' ? 250 : 60, Math.max(5, Math.round(med(widths) * 2) / 2)) : null;
  return { stations, wet, width, offset: ok ? med(offsets) : null };
}
const waterFixUsed = new Set();
const waterways = [];
const wwStats = { aqueduct: 0, culvert: 0 };
for (const el of main) {
  const t = el.tags || {};
  if (el.type !== 'way' || !LINE_WIDTH[t.waterway]) continue;
  const tagged = parseFloat(t.width);
  const fix = corrections.waterWidths.find((c) => normName(t.name).includes(normName(c.name)) && normName(c.name));
  if (fix) waterFixUsed.add(fix);
  const wDefault = Number.isFinite(tagged) && tagged > 1 && tagged < 300 ? tagged : LINE_WIDTH[t.waterway];
  const part = t.bridge === 'aqueduct' ? 'aqueduct' : t.tunnel === 'culvert' || t.tunnel === 'yes' ? 'culvert' : null;
  if (part) wwStats[part]++;
  // Runs of the line inside the play area.
  const runs = [];
  let cur = [];
  for (const p of wayLines(el)[0].map(P)) {
    if (inPA(p[0], p[1])) cur.push(p);
    else {
      if (cur.length > 1) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) runs.push(cur);
  for (const run of runs) {
    const line = simplify(run, 2).map((q) => [r1(q[0]), r1(q[1])]);
    if (line.length < 2) continue;
    const m = part ? null : measureWidth(line, t.waterway);
    const w = fix ? fix.width : m?.width ?? wDefault;
    if (m) eeWidths.push({ name: t.name || `unnamed ${t.waterway}`, len: Math.round(polyLen(line)), ...m, used: fix ? 'correction' : m.width ? 'satellite' : 'default' });
    const ww = { pts: line, w: r1(w), kind: t.waterway };
    if (t.name) ww.name = t.name;
    if (part) ww.part = part;
    waterways.push(ww);
    if (part) continue;
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
      if (t.waterway === 'river') riverbed.push(finishRing(r));
      else {
        water.push({ pts: finishRing(r) });
        wStats.lineStrips++;
      }
    }
  }
}

for (const c of corrections.waterWidths) {
  if (!waterFixUsed.has(c)) throw new Error(`corrections.json waterWidths: no river or canal line named like "${c.name}"`);
  applied.push(`water width ${c.width} m for "${c.name}"`);
}

const cellAt = (x, z) => {
  const i = Math.floor((x - PA.minX) / OV_RES);
  const j = Math.floor((z - PA.minZ) / OV_RES);
  return i >= 0 && j >= 0 && i < ovW && j < ovH ? j * ovW + i : -1;
};
// Real water outlines from the satellite water map (Dynamic World, 50% edge), kept only where
// they belong to a river or lake OSM knows (so flooded fields and canal blobs are left out).
{
  const g = eeGrids.water;
  const known = new Uint8Array(ovW * ovH); // OSM water polygons and river beds
  for (const w of water) scanRing(w.pts, (k) => (known[k] = 1));
  for (const r of riverbed) scanRing(r, (k) => (known[k] = 1));
  const toMetres = (p) => project(g.north - p[1] * g.dLat, g.west + p[0] * g.dLon);
  const rings = contours(g.data, g.width, g.height, 50).map((c) => {
    const m = c.ring.map(toMetres);
    const simple = simplify([...m, m[0]], 3.5).slice(0, -1);
    return { outer: c.outer, ring: simple };
  });
  const outers = [];
  for (const c of rings) {
    if (!c.outer || c.ring.length < 3) continue;
    const r = clipPA(c.ring);
    if (r.length < 3 || Math.abs(ringArea(r)) < 600) continue;
    const fr = finishRing(r);
    if (fr.length < 3 || selfIntersects(fr)) {
      wStats.broken++;
      continue;
    }
    let n = 0, hit = 0;
    scanRing(fr, (k) => {
      n++;
      hit += known[k];
    });
    if (!n || hit / n < 0.1) {
      wStats.satelliteSkipped++;
      continue;
    }
    outers.push({ pts: fr, holes: [] });
  }
  for (const c of rings) {
    if (c.outer || c.ring.length < 3 || Math.abs(ringArea(c.ring)) < 200) continue;
    const hole = finishRing(c.ring);
    if (hole.length < 3 || selfIntersects(hole)) continue;
    const owner = outers.find((o) => pointInRing(hole[0][0], hole[0][1], o.pts) && hole.every((p) => inPA(p[0], p[1])));
    if (!owner) continue;
    owner.holes.push(hole);
    wStats.satelliteHoles++;
  }
  for (const o of outers) {
    const w = { pts: o.pts };
    if (o.holes.length) w.holes = o.holes;
    water.push(w);
    wStats.satellite++;
  }
}

// No building stands in water or in a river bed: drop any that is more than 30% on them.
const waterOcc = new Uint8Array(ovW * ovH);
for (const w of water) scanRing(w.pts, (k) => (waterOcc[k] = 1));
for (const w of water) for (const h of w.holes || []) scanRing(h, (k) => (waterOcc[k] = 0));
for (const r of riverbed) scanRing(r, (k) => (waterOcc[k] = 1));
let inWater = 0;
{
  const keep = buildings.filter((b) => {
    let n = 0, hit = 0;
    scanRing(b.pts, (k) => {
      n++;
      hit += waterOcc[k];
    });
    const wet = n > 0 && hit / n > 0.3;
    if (wet) inWater++;
    return !wet;
  });
  buildings.length = 0;
  buildings.push(...keep);
}

// Railway: runs inside the play area, keeping OSM's bridge, electrification and siding tags.
// A closed rail loop that shares no node with other rail is a tagging mistake and is skipped.
const railWays = main.filter((el) => el.type === 'way' && el.tags?.railway === 'rail' && el.nodes);
const railNodeUse = new Map();
for (const el of railWays) for (const n of new Set(el.nodes)) railNodeUse.set(n, (railNodeUse.get(n) || 0) + 1);
const rail = [];
const railSkipped = [];
for (const el of railWays) {
  const t = el.tags;
  const loop = el.nodes[0] === el.nodes[el.nodes.length - 1];
  if (loop && !el.nodes.some((n) => railNodeUse.get(n) > 1)) {
    railSkipped.push(`${t.name || 'way ' + el.id} (closed loop, not connected)`);
    continue;
  }
  const flags = {};
  if (t.bridge && t.bridge !== 'no') flags.bridge = true;
  if (t.electrified && t.electrified !== 'no') flags.electric = true;
  if (t.service) flags.service = t.service;
  let cur = [];
  const flush = () => {
    if (cur.length > 1) {
      const run = { pts: simplify(cur, SIMPLIFY_TOL).map((q) => [r1(q[0]), r1(q[1])]), ...flags };
      // Bridges that cross water are drawn high on piers; the rest stay at ground level.
      if (run.bridge) {
        let n = 0, wet = 0;
        for (let i = 1; i < run.pts.length; i++) {
          const a = run.pts[i - 1], b = run.pts[i];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          for (let d = 0; d < L; d += 2) {
            const k = cellAt(a[0] + ((b[0] - a[0]) * d) / L, a[1] + ((b[1] - a[1]) * d) / L);
            n++;
            if (k >= 0 && waterOcc[k]) wet++;
          }
        }
        if (n && wet / n > 0.2) run.overWater = true;
      }
      rail.push(run);
    }
    cur = [];
  };
  for (const p of wayLines(el)[0].map(P)) {
    if (inPA(p[0], p[1])) cur.push(p);
    else flush();
  }
  flush();
}

/* ---------- Railway station and tracks (task K.5) ---------- */
// No building on the tracks: drop any within 3 m of a track centreline. Platforms: OSM's
// railway=platform ways, plus long narrow satellite outlines lying beside and along the tracks
// near Kurnool City station (Google sees the platform roofs as buildings); those become
// platforms with shelters instead of houses.
const railSegGrid = new Grid(32);
for (const run of rail) for (let i = 1; i < run.pts.length; i++) {
  const a = run.pts[i - 1], b = run.pts[i];
  railSegGrid.add({ a, b }, Math.min(a[0], b[0]) - 3, Math.min(a[1], b[1]) - 3, Math.max(a[0], b[0]) + 3, Math.max(a[1], b[1]) + 3);
}
function nearestRail(x, z, r) {
  let best = null;
  for (const sg of railSegGrid.query(x - r, z - r, x + r, z + r)) {
    const d = segDist(x, z, sg.a[0], sg.a[1], sg.b[0], sg.b[1]);
    if (d < r && (!best || d < best.d)) best = { d, sg };
  }
  return best;
}
function onTracks(ring) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of ring) {
    x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]);
    x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]);
  }
  for (const sg of railSegGrid.query(x0 - 3, z0 - 3, x1 + 3, z1 + 3)) {
    if (pointInRing(sg.a[0], sg.a[1], ring) || pointInRing(sg.b[0], sg.b[1], ring)) return true;
    for (let i = 0, n = ring.length; i < n; i++) if (segSegDist(ring[i], ring[(i + 1) % n], sg.a, sg.b) < 3) return true;
  }
  return false;
}
const platforms = [];
const stStats = { onTracks: 0, osmPlatforms: 0, roofs: 0, underPlatform: 0 };
for (const el of detailEls) {
  const t = el.tags || {};
  if (el.type !== 'way' || !(t.railway === 'platform' || (t.public_transport === 'platform' && t.train === 'yes'))) continue;
  const line = wayLines(el)[0].map(P);
  if (line.length < 2) continue;
  const closed = samePt(line[0], line[line.length - 1]) && line.length > 3;
  const w = Number.isFinite(parseFloat(t.width)) ? parseFloat(t.width) : 6;
  const ring = closed ? finishRing(line.slice(0, -1)) : finishRing(orientedBox(line, w / 2));
  if (ring.length < 3 || !ring.every((p) => inPA(p[0], p[1]))) continue;
  platforms.push({ pts: ring, roof: false });
  stStats.osmPlatforms++;
}
const station = lmById.station;
{
  const keep = [];
  for (const b of buildings) {
    if (onTracks(b.pts)) {
      stStats.onTracks++;
      continue;
    }
    const c = ringCentroid(b.pts);
    const host = platforms.find((p) => pointInRing(c[0], c[1], p.pts));
    if (host) {
      host.roof = true; // a satellite outline on an OSM platform is its shelter
      stStats.underPlatform++;
      continue;
    }
    if (station && Math.hypot(c[0] - station.x, c[1] - station.z) < 1200 && b.kind !== 'train_station') {
      const box = orientedBox(b.pts, 0);
      const L = Math.hypot(box[1][0] - box[0][0], box[1][1] - box[0][1]);
      const W = Math.hypot(box[3][0] - box[0][0], box[3][1] - box[0][1]);
      const near = nearestRail(c[0], c[1], 22);
      if (near && L >= 25 && W <= 15 && L / W >= 3) {
        const ux = (box[1][0] - box[0][0]) / L, uz = (box[1][1] - box[0][1]) / L;
        const rl = Math.hypot(near.sg.b[0] - near.sg.a[0], near.sg.b[1] - near.sg.a[1]) || 1;
        const along = Math.abs((ux * (near.sg.b[0] - near.sg.a[0]) + uz * (near.sg.b[1] - near.sg.a[1])) / rl);
        if (along > 0.95) {
          platforms.push({ pts: finishRing(box), roof: true });
          stStats.roofs++;
          continue;
        }
      }
    }
    keep.push(b);
  }
  buildings.length = 0;
  buildings.push(...keep);
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
for (const r of riverbed) fillRing(r);
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
          buildings.push({ pts: fr, h: r1(floors * FLOOR_H), kind: 'filler', seed: hash32('fill', i, j, placed), real: false });
          fillerRings.push(fr);
          placed++;
          fillerBuildings++;
        }
      }
    }
  }
}

/* ================= SATELLITE HEIGHTS (task K.5) ================= */
// Google Open Buildings 2.5D heights (2023, 4 m pixels). A building without an OSM level
// count takes the 80th percentile of the pixels inside its outline, if enough of them show a
// building; otherwise its style height stays.
const hStats = { satellite: 0, osmLevels: 0, notSeen: 0 };
const hFloors = [0, 0, 0, 0, 0, 0]; // 1, 2, 3, 4, 5, 6+ floors
{
  const g = eeGrids.heights;
  for (const b of buildings) {
    if (b.real) {
      hStats.osmLevels++;
      continue;
    }
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of b.pts) {
      x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]);
      x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]);
    }
    const [i0, j0] = gridPx(g, x0, z0); // north-west corner: smallest i and j
    const [i1, j1] = gridPx(g, x1, z1);
    const vals = [];
    let n = 0;
    for (let j = Math.floor(j0); j <= Math.floor(j1); j++) {
      for (let i = Math.floor(i0); i <= Math.floor(i1); i++) {
        const lon = g.west + (i + 0.5) * g.dLon;
        const lat = g.north - (j + 0.5) * g.dLat;
        const [px, pz] = project(lat, lon);
        if (!pointInRing(px, pz, b.pts)) continue;
        n++;
        const v = gridCell(g, i, j);
        if (v > 0) vals.push(v / 2);
      }
    }
    if (n === 0) {
      const c = ringCentroid(b.pts);
      const [ci, cj] = gridPx(g, c[0], c[1]);
      n = 1;
      const v = gridCell(g, Math.floor(ci), Math.floor(cj));
      if (v > 0) vals.push(v / 2);
    }
    if (!vals.length || vals.length < n * 0.3) {
      hStats.notSeen++;
      continue;
    }
    vals.sort((p, q) => p - q);
    const h = Math.min(100, Math.max(3, vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.8))]));
    b.h = r1(h);
    b.real = true;
    hStats.satellite++;
  }
  for (const b of buildings) hFloors[Math.min(5, Math.max(0, Math.round(b.h / FLOOR_H) - 1))]++;
}

/* ================= KURNOOL STYLES (task K.2) ================= */
// One style per building from OSM land use, building tags, shops and amenities, named
// neighbourhoods and building density. Ids match STYLE in src/map/buildingStyle.ts.
const STYLE = { plain: 0, old: 1, colony: 2, market: 3, campus: 4, outskirts: 5, industrial: 6 };
const STYLE_NAMES = Object.fromEntries(Object.entries(STYLE).map(([k, v]) => [v, k]));
const centreOf = (el) => {
  const c = centerOf(el);
  return c ? P(c) : null;
};

// Land-use areas (and amenity grounds) that decide a style outright.
const ZONE_OF_LANDUSE = { industrial: 'industrial', garages: 'industrial', commercial: 'market', retail: 'market', residential: 'colony', education: 'campus', institutional: 'campus', military: 'campus', religious: 'campus' };
const CAMPUS_AMENITY = /^(school|college|university|hospital|clinic|townhall|police|library|courthouse|kindergarten|public_building)$/;
const zoneGrid = new Grid(100);
let zoneCount = 0;
for (const el of [...detailEls, ...main]) {
  if (el.type === 'node') continue;
  const t = el.tags || {};
  const zone = ZONE_OF_LANDUSE[t.landuse] || (CAMPUS_AMENITY.test(t.amenity || '') ? 'campus' : null);
  if (!zone) continue;
  for (const ring of closedRings(el)) {
    if (ring.length < 3) continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of ring) {
      x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]);
      x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]);
    }
    zoneGrid.add({ ring, zone, area: Math.abs(ringArea(ring)) }, x0, z0, x1, z1);
    zoneCount++;
  }
}
/** The smallest land-use zone containing a point (smallest wins, so a school inside a residential area is a campus). */
function zoneAt(x, z) {
  let best = null;
  for (const it of zoneGrid.query(x, z, x, z)) {
    if ((!best || it.area < best.area) && pointInRing(x, z, it.ring)) best = it;
  }
  return best?.zone ?? null;
}

// Shops and other street-front businesses, as points.
const shopGrid = new Grid(50);
let shopCount = 0;
for (const el of detailEls) {
  const t = el.tags || {};
  const isShop = t.shop || t.office || t.craft || /^(restaurant|fast_food|cafe|bank|atm|pharmacy|marketplace|fuel|ice_cream|bar|cinema|theatre|doctors|dentist|clinic)$/.test(t.amenity || '') || t.tourism === 'hotel';
  if (!isShop) continue;
  const c = centreOf(el);
  if (!c || !inPA(c[0], c[1])) continue;
  shopGrid.add(c, c[0], c[1], c[0], c[1]);
  shopCount++;
}
const shopsNear = (x, z, r) => {
  let n = 0;
  for (const p of shopGrid.query(x - r, z - r, x + r, z + r)) if (Math.hypot(p[0] - x, p[1] - z) < r) n++;
  return n;
};

// Named neighbourhoods: old-city names, colonies, villages.
const OLD_NAMES = /\b(pet|peta|pura|bagh|qila|beedh|padakhana|marwari|bazaar|bazar|old town|old city|old bus stand)\b/i;
const COLONY_NAMES = /(nagar|colony|estates?|township|camp|residency|layout|enclave|quarters|villas)/i;
const places = [];
for (const el of [...detailEls, ...wide]) {
  const t = el.tags || {};
  if (!t.place || !t.name) continue;
  const c = centreOf(el);
  if (!c) continue;
  let kind = null;
  if (/^(village|hamlet)$/.test(t.place)) kind = 'outskirts';
  if (COLONY_NAMES.test(t.name)) kind = 'colony';
  if (OLD_NAMES.test(t.name) && t.place !== 'village') kind = 'old';
  if (kind && !places.some((p) => p.name === t.name && Math.hypot(p.x - c[0], p.z - c[1]) < 50)) places.push({ name: t.name, kind, x: c[0], z: c[1] });
}
// The fort area is the heart of the old city.
if (lmById.fort) places.push({ name: 'Konda Reddy Fort', kind: 'old', x: lmById.fort.x, z: lmById.fort.z });
const PLACE_RADIUS = { old: 450, colony: 600, outskirts: 700 };
function placeKindAt(x, z) {
  let best = null;
  let bd = Infinity;
  for (const p of places) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < PLACE_RADIUS[p.kind] && d < bd) {
      bd = d;
      best = p;
    }
  }
  return best?.kind ?? null;
}

// Building cover per 50 m cell, smoothed over the 3 x 3 neighbourhood (share of ground under roofs).
const DC = 50;
const DW = Math.ceil((PA.maxX - PA.minX) / DC);
const DH = Math.ceil((PA.maxZ - PA.minZ) / DC);
const cover = new Float32Array(DW * DH);
for (const b of buildings) {
  const c = ringCentroid(b.pts);
  const i = Math.floor((c[0] - PA.minX) / DC);
  const j = Math.floor((c[1] - PA.minZ) / DC);
  if (i >= 0 && j >= 0 && i < DW && j < DH) cover[j * DW + i] += Math.abs(ringArea(b.pts)) / (DC * DC);
}
function coverAt(x, z) {
  const i = Math.floor((x - PA.minX) / DC);
  const j = Math.floor((z - PA.minZ) / DC);
  let s = 0;
  let n = 0;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= DW || jj >= DH) continue;
      s += cover[jj * DW + ii];
      n++;
    }
  }
  return n ? s / n : 0;
}

// Main roads, for shop fronts.
const MAIN_ROAD = new Set(['trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link']);
const MARKET_ROADS = /(park road|bus stand|bazaar|bazar|main road|market|station road|mosque road|sunkesula road|kurnool road|nandyal road)/i;
const mainSegGrid = new Grid(32);
roads.forEach((road, ri) => {
  if (road.id === -1) return;
  const named = MARKET_ROADS.test(roadNames[ri] || '');
  if (!MAIN_ROAD.has(road.kind) && !named) return;
  const hw = road.width / 2;
  for (let k = 1; k < road.pts.length; k++) {
    const a = road.pts[k - 1], b = road.pts[k];
    mainSegGrid.add({ a, b, hw, named, big: road.kind !== 'tertiary' && road.kind !== 'tertiary_link' }, Math.min(a[0], b[0]) - hw, Math.min(a[1], b[1]) - hw, Math.max(a[0], b[0]) + hw, Math.max(a[1], b[1]) + hw);
  }
});
const FRONT = 9; // m from the road edge to the building for a shop front
/** The main road a building fronts (closest edge within FRONT m of the kerb), or null. */
function frontRoad(ring) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of ring) {
    x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]);
    x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]);
  }
  const m = maxHalfWidth + FRONT;
  let best = null;
  for (const s of mainSegGrid.query(x0 - m, z0 - m, x1 + m, z1 + m)) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const d = segSegDist(ring[i], ring[(i + 1) % n], s.a, s.b) - s.hw;
      if (d < FRONT && (!best || d < best.d)) best = { d, s };
    }
  }
  return best?.s ?? null;
}

const CAMPUS_KINDS = /^(school|college|university|hospital|public|government|civic|office|kindergarten|train_station|transportation|dormitory|military|religious|temple|mosque|church)$/;
const INDUSTRIAL_KINDS = /^(industrial|warehouse|shed|factory|garage|garages|hangar|manufacture|storage_tank|service)$/;
const MARKET_KINDS = /^(commercial|retail|shop|supermarket|kiosk|hotel)$/;

function pickStyle(b) {
  const c = ringCentroid(b.pts);
  const k = b.kind && b.kind !== 'filler' ? b.kind : '';
  if (INDUSTRIAL_KINDS.test(k)) return STYLE.industrial;
  if (CAMPUS_KINDS.test(k)) return STYLE.campus;
  const zone = zoneAt(c[0], c[1]);
  if (zone === 'industrial') return STYLE.industrial;
  if (zone === 'campus') return STYLE.campus;
  const cov = coverAt(c[0], c[1]);
  const place = placeKindAt(c[0], c[1]);
  const front = frontRoad(b.pts);
  const shops = shopsNear(c[0], c[1], 60);
  const busy = isCommercial(c[0], c[1]) || zone === 'market' || shops > 0 || place === 'old';
  // Kurnool's main roads are lined with shops wherever the area is built up.
  if (MARKET_KINDS.test(k) || (front && (front.named || busy || (front.big && cov > 0.1) || cov > 0.2))) return STYLE.market;
  if (place === 'old' || (cov > 0.28 && lmById.fort && Math.hypot(c[0] - lmById.fort.x, c[1] - lmById.fort.z) < 2000)) return STYLE.old;
  if (place === 'outskirts' || (cov < 0.07 && place !== 'colony')) return STYLE.outskirts;
  if (place === 'colony' || zone === 'colony' || k === 'house' || k === 'residential' || k === 'detached') return STYLE.colony;
  return STYLE.plain;
}

/** Floors for a style when OSM or Overture gave no real height. */
function styleHeight(b, style) {
  const rng = makeRng(b.seed >>> 0);
  const c = ringCentroid(b.pts);
  const area = Math.abs(ringArea(b.pts));
  switch (style) {
    case STYLE.old: return (2 + Math.floor(rng() * 2)) * FLOOR_H; // 2..3
    case STYLE.colony: return (rng() < 0.55 ? 1 : 2) * FLOOR_H + (rng() < 0.3 ? 0.4 : 0);
    case STYLE.market: return (isCommercial(c[0], c[1]) ? 3 + Math.floor(rng() * 4) : 2 + Math.floor(rng() * 3)) * FLOOR_H;
    case STYLE.campus: return (area > 600 ? 3 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * 2)) * FLOOR_H;
    case STYLE.outskirts: return (rng() < 0.8 ? 1 : 2) * FLOOR_H;
    case STYLE.industrial: return 4.5 + rng() * 3.5;
    default: return floorsFor(rng, c[0], c[1], b.kind === 'filler') * FLOOR_H;
  }
}

const styleCount = {};
for (const b of buildings) {
  b.style = pickStyle(b);
  if (!b.real) b.h = r1(styleHeight(b, b.style));
  styleCount[STYLE_NAMES[b.style]] = (styleCount[STYLE_NAMES[b.style]] || 0) + 1;
}

// Compound walls around colony houses where the whole wall fits: clear of roads, other
// buildings and other compound walls. Same box as compoundWall() in src/map/buildingStyle.ts.
const WALL_GAP = 1.8;
const GATE_ROAD_SEARCH = 40;
function orientedBox(ring, pad) {
  let best = 0, ux = 1, uz = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > best) {
      best = L;
      ux = (b[0] - a[0]) / L;
      uz = (b[1] - a[1]) / L;
    }
  }
  const nx = -uz, nz = ux;
  let u0 = Infinity, u1 = -Infinity, n0 = Infinity, n1 = -Infinity;
  for (const [x, z] of ring) {
    const u = x * ux + z * uz, n = x * nx + z * nz;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u);
    n0 = Math.min(n0, n); n1 = Math.max(n1, n);
  }
  u0 -= pad; u1 += pad; n0 -= pad; n1 += pad;
  const at = (u, n) => [u * ux + n * nx, u * uz + n * nz];
  return [at(u0, n0), at(u1, n0), at(u1, n1), at(u0, n1)];
}
const bOcc = new Uint8Array(ovW * ovH);
for (const b of buildings) scanRing(b.pts, (k) => (bOcc[k] = 1));
const wallOcc = new Uint8Array(ovW * ovH);
let walled = 0;
buildings.forEach((b) => {
  if (b.style !== STYLE.colony) return;
  const area = Math.abs(ringArea(b.pts));
  if (area < 40 || area > 350 || b.pts.length > 8) return;
  const box = orientedBox(b.pts, WALL_GAP);
  if (box.some((p) => !inPA(p[0], p[1])) || overlapsRoad(box)) return;
  let clash = false;
  scanRing(box, (k) => {
    if (clash) return;
    if (wallOcc[k]) clash = true;
    else if (bOcc[k]) {
      const i = k % ovW, j = Math.floor(k / ovW);
      if (!pointInRing(PA.minX + (i + 0.5) * OV_RES, PA.minZ + (j + 0.5) * OV_RES, b.pts)) clash = true;
    }
  });
  if (clash) return;
  // Gate on the side facing the nearest road.
  let gate = 0;
  let gd = Infinity;
  for (let s = 0; s < 4; s++) {
    const a = box[s], e = box[(s + 1) % 4];
    const mx = (a[0] + e[0]) / 2, mz = (a[1] + e[1]) / 2;
    for (const seg of segGrid.query(mx - GATE_ROAD_SEARCH, mz - GATE_ROAD_SEARCH, mx + GATE_ROAD_SEARCH, mz + GATE_ROAD_SEARCH)) {
      const d = segDist(mx, mz, seg.a[0], seg.a[1], seg.b[0], seg.b[1]);
      if (d < gd) {
        gd = d;
        gate = s;
      }
    }
  }
  b.gate = gate;
  scanRing(box, (k) => (wallOcc[k] = 1));
  walled++;
});

/* ================= AIRPORT + LINK ROAD ================= */
// Pulled in to about 1.5 km east of the play area (MAP-SPEC), linked from the
// biggest road that reaches the east edge (trunk, then primary, then secondary).
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

/* ================= STREET DETAILS (task K.3) ================= */
// Electric poles with wires, roadside neem trees, hoardings, places of worship and auto
// stands, placed where the ground is free: no building, water or other road. Kerbs,
// dividers and divider lights come from the road shapes in the game (src/map/props.ts).
const dm = (v) => Math.round(v * 10);
const propOcc = new Uint8Array(ovW * ovH); // props already placed
/** True if a disc of radius r is clear of buildings, water, placed props and every road's surface (plus margin). */
const clearZones = corrections.clearProps.map((c) => {
  const [x, z] = P(c.at);
  return { x, z, r: c.radius, used: 0, c };
});
const inClearZone = (x, z, r) => clearZones.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + r && ++q.used);
function spotFree(x, z, r, roadMargin) {
  if (!inPA(x, z) || inClearZone(x, z, r)) return false;
  for (let dz = -r; dz <= r + 1e-6; dz += Math.max(r, 0.5)) {
    for (let dx = -r; dx <= r + 1e-6; dx += Math.max(r, 0.5)) {
      const k = cellAt(x + dx, z + dz);
      if (k < 0 || bOcc[k] || waterOcc[k] || propOcc[k] || wallOcc[k]) return false;
    }
  }
  const m = maxHalfWidth + roadMargin + r;
  for (const s of segGrid.query(x - m, z - m, x + m, z + m)) {
    if (segDist(x, z, s.a[0], s.a[1], s.b[0], s.b[1]) < s.hw + roadMargin + r) return false;
  }
  return true;
}
const markProp = (x, z) => {
  const k = cellAt(x, z);
  if (k >= 0) propOcc[k] = 1;
};
// Junctions (3 or more road pieces): props keep clear of them.
const nodeDeg = new Map();
for (const e of edges) for (const n of [e.a, e.b]) nodeDeg.set(n, (nodeDeg.get(n) || 0) + 1);
const junctionGrid = new Grid(50);
for (const [n, d] of nodeDeg) if (d >= 3) junctionGrid.add(nodes[n], nodes[n][0], nodes[n][1], nodes[n][0], nodes[n][1]);
const nearJunction = (x, z, r) => [...junctionGrid.query(x - r, z - r, x + r, z + r)].some((p) => Math.hypot(p[0] - x, p[1] - z) < r);
/** Walks a polyline, calling fn(x, z, ux, uz) every `step` metres, starting `start` metres in. */
function walkRoad(pts, step, start, fn) {
  let next = start;
  let done = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    while (next <= done + L) {
      const t = next - done;
      fn(a[0] + ux * t, a[1] + uz * t, ux, uz);
      next += step;
    }
    done += L;
  }
}

// Electric poles on the left verge of town roads, every 38 m, wired in runs.
const POLE_ROADS = new Set(['secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'unclassified', 'road', 'living_street']);
const poleRuns = [];
let poleCount = 0;
roads.forEach((road) => {
  if (road.id === -1 || road.bridge || !POLE_ROADS.has(road.kind)) return;
  const off = road.width / 2 + 0.6;
  let run = [];
  const flush = () => {
    if (run.length >= 4) {
      // Stored as [x0, z0, dx1, dz1, ...] in decimetres (poles are close together).
      poleRuns.push(run.map((v, i) => (i < 2 ? v : v - run[i - 2])));
      poleCount += run.length / 2;
    }
    run = [];
  };
  walkRoad(road.pts, 38, 10, (x, z, ux, uz) => {
    const px = x + uz * off, pz = z - ux * off; // left of travel direction
    if (nearJunction(px, pz, 9) || !spotFree(px, pz, 0.3, 0.25)) return flush();
    markProp(px, pz);
    run.push(dm(px), dm(pz));
  });
  flush();
});

// Neem trees on the verges of town and colony roads, alternating sides, every 26 m.
const TREE_ROADS = new Set(['tertiary', 'tertiary_link', 'residential', 'unclassified', 'road', 'secondary', 'secondary_link', 'primary', 'trunk']);
const trees = [];
roads.forEach((road, ri) => {
  if (road.id === -1 || road.bridge || !TREE_ROADS.has(road.kind)) return;
  const rng = makeRng(hash32('trees', ri));
  let side = rng() < 0.5 ? 1 : -1;
  walkRoad(road.pts, 26, 6 + rng() * 14, (x, z, ux, uz) => {
    side = -side;
    if (rng() < 0.35) return;
    const off = road.width / 2 + 2.2 + rng() * 1.2;
    const tx = x + uz * off * side, tz = z - ux * off * side;
    if (nearJunction(tx, tz, 12) || !spotFree(tx, tz, 1.2, 0.8)) return;
    markProp(tx, tz);
    trees.push(dm(tx), dm(tz));
  });
});

// Hoardings facing main roads, every 240 m or so.
const HOARDING_ROADS = new Set(['trunk', 'primary', 'secondary']);
const hoardings = [];
roads.forEach((road, ri) => {
  if (road.id === -1 || road.bridge || !HOARDING_ROADS.has(road.kind)) return;
  const rng = makeRng(hash32('hoarding', ri));
  walkRoad(road.pts, 240, 60 + rng() * 120, (x, z, ux, uz) => {
    const side = rng() < 0.5 ? 1 : -1;
    const off = road.width / 2 + 3.5;
    const hx = x + uz * off * side, hz = z - ux * off * side;
    // Board 6 m wide along the road: check both ends and the middle.
    const ends = [-2.6, 0, 2.6].map((t) => [hx + ux * t, hz + uz * t]);
    if (nearJunction(hx, hz, 15) || !ends.every(([px, pz]) => spotFree(px, pz, 0.6, 1.5))) return;
    for (const [px, pz] of ends) markProp(px, pz);
    // Board faces the road: its front normal points from the board to the road.
    const a = Math.round((Math.atan2(-uz * side, ux * side) * 180) / Math.PI);
    hoardings.push(dm(hx), dm(hz), a);
  });
});

// Places of worship: OSM points and outlines. A small building under the point becomes
// the temple, mosque or church; otherwise a small one is placed on free ground, facing the road.
const RELIGION = { hindu: 'h', muslim: 'm', christian: 'c' };
const worship = [];
const removeBuilding = new Set();
let worshipSkipped = 0;
const worshipEls = [...detailEls, ...main].filter((el) => el.tags?.amenity === 'place_of_worship' || /^(temple|mosque|church|chapel|shrine)$/.test(el.tags?.building || ''));
const seenWorship = [];
for (const el of worshipEls) {
  const t = el.tags;
  const c = centreOf(el);
  if (!c || !inPA(c[0], c[1])) continue;
  if (seenWorship.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) < 25)) continue;
  seenWorship.push(c);
  const kindByBuilding = { mosque: 'm', church: 'c', chapel: 'c', temple: 'h', shrine: 'h' };
  const r = RELIGION[t.religion] || kindByBuilding[t.building] || (/masjid|mosque|dargah|idgah/i.test(t.name || '') ? 'm' : /church|chapel/i.test(t.name || '') ? 'c' : 'h');
  // The building under the point, if any.
  let host = -1;
  for (let i = 0; i < buildings.length && host < 0; i++) {
    const b = buildings[i];
    const p0 = b.pts[0];
    if (Math.abs(p0[0] - c[0]) > 80 || Math.abs(p0[1] - c[1]) > 80) continue;
    if (pointInRing(c[0], c[1], b.pts)) host = i;
  }
  let rec;
  if (inClearZone(c[0], c[1], 5)) {
    worshipSkipped++;
    continue;
  }
  if (host >= 0) {
    const b = buildings[host];
    if (Math.abs(ringArea(b.pts)) > 1200 || removeBuilding.has(host)) {
      worshipSkipped++;
      continue;
    }
    const box = orientedBox(b.pts, 0);
    const w = Math.hypot(box[1][0] - box[0][0], box[1][1] - box[0][1]);
    const d = Math.hypot(box[3][0] - box[0][0], box[3][1] - box[0][1]);
    const cx = (box[0][0] + box[2][0]) / 2, cz = (box[0][1] + box[2][1]) / 2;
    const a = Math.atan2(box[1][0] - box[0][0], box[1][1] - box[0][1]);
    rec = { x: r1(cx), z: r1(cz), a: Math.round(a * 1000) / 1000, w: r1(Math.max(4, w)), d: r1(Math.max(4, d)), r };
    removeBuilding.add(host);
  } else {
    const size = r === 'm' ? 12 : 9;
    if (!spotFree(c[0], c[1], size / 2, 1)) {
      worshipSkipped++;
      continue;
    }
    // Face the nearest road.
    let best = null;
    for (const s of segGrid.query(c[0] - 60, c[1] - 60, c[0] + 60, c[1] + 60)) {
      const d = segDist(c[0], c[1], s.a[0], s.a[1], s.b[0], s.b[1]);
      if (!best || d < best.d) best = { d, s };
    }
    const a = best ? Math.atan2(best.s.b[0] - best.s.a[0], best.s.b[1] - best.s.a[1]) : 0;
    rec = { x: r1(c[0]), z: r1(c[1]), a: Math.round(a * 1000) / 1000, w: size, d: size, r };
  }
  if (t.name) rec.name = t.name;
  worship.push(rec);
  for (let dx = -rec.w / 2; dx <= rec.w / 2; dx += 2) for (let dz = -rec.d / 2; dz <= rec.d / 2; dz += 2) markProp(rec.x + dx, rec.z + dz);
}
const keptBuildings = buildings.filter((_, i) => !removeBuilding.has(i));
buildings.length = 0;
buildings.push(...keptBuildings);

// Auto stands: a row of parked autos at the kerb of a main road near busy landmarks.
const autoStands = [];
const STAND_AT = ['busstand', 'station', 'rajvihar', 'ccamp', 'ggh', 'kmc', 'fort'];
for (const id of STAND_AT) {
  const lm = lmById[id];
  if (!lm) continue;
  let best = null;
  roads.forEach((road) => {
    if (road.id === -1 || road.bridge || road.width < 7) return;
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 30) continue;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      const d = Math.hypot(mx - lm.x, mz - lm.z);
      if (d > 200 || Math.hypot(mx - spawn.x, mz - spawn.z) < 70 || nearJunction(mx, mz, 18)) continue;
      const score = d - road.width * 4;
      if (!best || score < best.score) best = { score, a, b, L, hw: road.width / 2 };
    }
  });
  if (!best) continue;
  const ux = (best.b[0] - best.a[0]) / best.L, uz = (best.b[1] - best.a[1]) / best.L;
  const off = best.hw - 1.3;
  const x = (best.a[0] + best.b[0]) / 2 + uz * off, z = (best.a[1] + best.b[1]) / 2 - ux * off;
  autoStands.push(dm(x), dm(z), Math.round((Math.atan2(ux, uz) * 180) / Math.PI), 4);
}

// Level crossings: only where OSM marks one (railway=level_crossing), on the road through it.
const crossings = [];
for (const el of detailEls) {
  if (el.type !== 'node' || el.tags?.railway !== 'level_crossing') continue;
  const [x, z] = P([el.lat, el.lon]);
  if (!inPA(x, z)) continue;
  let best = null;
  roads.forEach((r, ri) => {
    if (r.bridge || r.lift || (lifts[ri] && lifts[ri].some((v) => v < -0.05))) return;
    for (let k = 1; k < r.pts.length; k++) {
      const a = r.pts[k - 1], b = r.pts[k];
      const d = segDist(x, z, a[0], a[1], b[0], b[1]);
      if (d < 15 && (!best || d < best.d)) best = { d, a, b, hw: r.width / 2 };
    }
  });
  if (!best) continue;
  const L = Math.hypot(best.b[0] - best.a[0], best.b[1] - best.a[1]) || 1;
  crossings.push({ x: r1(x), z: r1(z), a: Math.round(Math.atan2(best.b[0] - best.a[0], best.b[1] - best.a[1]) * 1000) / 1000, hw: best.hw });
  void L;
}

// Speed breakers (task R.3): on the smaller roads next to schools, colleges, hospitals and
// clinics (OSM amenities), and on some colony roads. Across the road: [x, z, headingDeg, halfWidth] in decimetres.
const bumps = [];
const bumpAt = [];
const BUMP_ROADS = /^(secondary|tertiary|residential|unclassified|living_street)$/;
const addBump = (x, z) => {
  let best = null;
  for (const s of segGrid.query(x - 60, z - 60, x + 60, z + 60)) {
    const road = roads[s.road];
    if (!road || !BUMP_ROADS.test(road.kind) || road.bridge || road.lift) continue;
    const d = segDist(x, z, s.a[0], s.a[1], s.b[0], s.b[1]);
    if (d < 60 && (!best || d < best.d)) best = { d, s };
  }
  if (!best) return;
  const { a, b, hw } = best.s;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0.15, Math.min(0.85, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
  const px = a[0] + dx * t, pz = a[1] + dz * t;
  if (nearJunction(px, pz, 15) || bumpAt.some((p) => Math.hypot(p[0] - px, p[1] - pz) < 60)) return;
  bumpAt.push([px, pz]);
  bumps.push(dm(px), dm(pz), Math.round((Math.atan2(dx, dz) * 180) / Math.PI), dm(hw));
};
for (const el of [...detailEls, ...main].filter((e) => /^(school|college|hospital|clinic|kindergarten)$/.test(e.tags?.amenity || ''))) {
  const c = centreOf(el);
  if (c && inPA(c[0], c[1])) addBump(c[0], c[1]);
}
roads.forEach((road, ri) => {
  if (road.kind !== 'residential' || road.bridge || road.lift || road.id === -1) return;
  const rng = makeRng(hash32('bump', ri));
  if (rng() > 0.06) return;
  const m = road.pts[Math.floor(road.pts.length / 2)];
  addBump(m[0], m[1]);
});

const props = { poles: poleRuns, trees, hoardings, worship, autoStands, crossings, platforms, bumps };
for (const q of clearZones) applied.push(`props cleared around ${q.c.at} (${q.r} m)${q.c.note ? ': ' + q.c.note : ''}`);

// Hand corrections to buildings (K.4).
for (const rb of corrections.removeBuildings) {
  const [x, z] = P(rb.at);
  const r = rb.radius || 0;
  const before = buildings.length;
  const keep = buildings.filter((b) => {
    if (r > 0) {
      const c = ringCentroid(b.pts);
      return Math.hypot(c[0] - x, c[1] - z) > r;
    }
    return !pointInRing(x, z, b.pts);
  });
  if (keep.length === before) throw new Error(`corrections.json removeBuildings: no building at ${rb.at}${r ? ' within ' + r + ' m' : ''}`);
  buildings.length = 0;
  buildings.push(...keep);
  applied.push(`removed ${before - keep.length} building(s) at ${rb.at}${rb.note ? ': ' + rb.note : ''}`);
}
for (const ab of corrections.addBuildings) {
  let ring = ab.pts.map(P);
  if (ringArea(ring) < 0) ring = ring.reverse();
  const c = ringCentroid(ring);
  const st = { dropped: 0, shrunk: 0, broken: 0 };
  const fr = fitBuilding(ring, c, st);
  if (!fr) throw new Error(`corrections.json addBuildings: the building at ${ab.pts[0]} blocks a road or is broken`);
  if (ab.style !== undefined && !(ab.style in STYLE)) throw new Error(`corrections.json addBuildings: unknown style "${ab.style}"`);
  buildings.push({ pts: fr, h: r1(ab.floors * FLOOR_H), style: STYLE[ab.style ?? 'plain'], seed: 0, real: true });
  applied.push(`added a ${ab.floors}-floor ${ab.style ?? 'plain'} building at ${ab.pts[0]}${st.shrunk ? ' (shrunk off a road)' : ''}${ab.note ? ': ' + ab.note : ''}`);
}

/* ================= ASSEMBLE + VALIDATE ================= */
const bounds = {
  minX: PA.minX,
  minZ: r1(Math.min(PA.minZ, runway.z - 300)),
  maxX: r1(Math.max(PA.maxX, runway.x + RUNWAY_LEN / 2 + 200)),
  maxZ: r1(Math.max(PA.maxZ, termCz + 300)),
};
/* ================= TERRAIN (task K.5) ================= */
// Ground heights from the Copernicus DEM (roofs and trees taken off), on a 20 m grid over the
// whole map plus a margin, in metres relative to Raj Vihar (the spawn). Under rivers, canals and
// lakes the ground is lowered to the lowest point within 60 m, so water lies flat on it.
// Written as public/map/terrain.bin: Int16 decimetres, row by row (z), little-endian.
const TER_CELL = 20;
const TER_MARGIN = 300;
const tgrid = eeGrids.terrain;
function elevAt(x, z) {
  const [fi, fj] = gridPx(tgrid, x, z);
  const u = Math.min(tgrid.width - 1.001, Math.max(0, fi - 0.5));
  const v = Math.min(tgrid.height - 1.001, Math.max(0, fj - 0.5));
  const i = Math.floor(u), j = Math.floor(v);
  const fx = u - i, fy = v - j;
  const c = (a, b) => tgrid.data[b * tgrid.width + a];
  const raw = c(i, j) * (1 - fx) * (1 - fy) + c(i + 1, j) * fx * (1 - fy) + c(i, j + 1) * (1 - fx) * fy + c(i + 1, j + 1) * fx * fy;
  return raw / 10 + tgrid.base;
}
const terrainRef = r1(elevAt(spawn.x, spawn.z));
const terX0 = Math.floor((bounds.minX - TER_MARGIN) / TER_CELL) * TER_CELL;
const terZ0 = Math.floor((bounds.minZ - TER_MARGIN) / TER_CELL) * TER_CELL;
const terW = Math.ceil((bounds.maxX + TER_MARGIN - terX0) / TER_CELL) + 1;
const terH = Math.ceil((bounds.maxZ + TER_MARGIN - terZ0) / TER_CELL) + 1;
const terRaw = new Float32Array(terW * terH);
for (let j = 0; j < terH; j++) for (let i = 0; i < terW; i++) terRaw[j * terW + i] = elevAt(terX0 + i * TER_CELL, terZ0 + j * TER_CELL) - terrainRef;
const terOut = Float32Array.from(terRaw);
let terFlat = 0;
{
  const R = 3; // vertices (60 m)
  for (let j = 0; j < terH; j++) {
    for (let i = 0; i < terW; i++) {
      const x = terX0 + i * TER_CELL, z = terZ0 + j * TER_CELL;
      if (!inPA(x, z)) continue;
      const k = cellAt(x, z);
      if (k < 0 || !waterOcc[k]) continue;
      let lo = Infinity;
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < terW && jj < terH) lo = Math.min(lo, terRaw[jj * terW + ii]);
      }
      terOut[j * terW + i] = lo;
      terFlat++;
    }
  }
}
// Underpasses: dig each tunnel road and its ramps into the ground (full depth across the road,
// easing out over 12 m beyond its edge).
let terDug = 0;
roads.forEach((r, ri) => {
  const L = lifts[ri];
  if (!L || !L.some((v) => v < -0.05)) return;
  const hw = r.width / 2;
  const reach = hw + 13;
  for (let k = 1; k < r.pts.length; k++) {
    const a = r.pts[k - 1], b = r.pts[k];
    const la = Math.min(0, L[k - 1]), lb = Math.min(0, L[k]);
    if (la === 0 && lb === 0) continue;
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach - terX0) / TER_CELL));
    const i1 = Math.min(terW - 1, Math.ceil((Math.max(a[0], b[0]) + reach - terX0) / TER_CELL));
    const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach - terZ0) / TER_CELL));
    const j1 = Math.min(terH - 1, Math.ceil((Math.max(a[1], b[1]) + reach - terZ0) / TER_CELL));
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz || 1;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = terX0 + i * TER_CELL, z = terZ0 + j * TER_CELL;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
        const d = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
        if (d > reach) continue;
        const w = d <= hw + 1 ? 1 : Math.max(0, 1 - (d - hw - 1) / 12);
        const v = terRaw[j * terW + i] + (la + (lb - la) * t) * w;
        if (v < terOut[j * terW + i]) {
          terOut[j * terW + i] = v;
          terDug++;
        }
      }
    }
  }
});
// The railway keeps the undug ground under it (it crosses underpasses on its bridges): heights
// every 20 m from the DEM, so tracks never sag into a cutting.
for (const run of rail) {
  const dense = [];
  for (let i = 0; i < run.pts.length; i++) {
    if (i) {
      const a = run.pts[i - 1], b = run.pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 20));
      for (let k = 1; k < n; k++) dense.push([r1(a[0] + ((b[0] - a[0]) * k) / n), r1(a[1] + ((b[1] - a[1]) * k) / n)]);
    }
    dense.push(run.pts[i]);
  }
  run.pts = dense;
  run.y = dense.map(([x, z]) => r1(elevAt(x, z) - terrainRef));
}

const terBin = Buffer.alloc(terW * terH * 2);
let terMin = Infinity, terMax = -Infinity;
for (let k = 0; k < terW * terH; k++) {
  const v = Math.max(-32767, Math.min(32767, Math.round(terOut[k] * 10)));
  terBin.writeInt16LE(v, k * 2);
  terMin = Math.min(terMin, v / 10);
  terMax = Math.max(terMax, v / 10);
}
const terrain = { file: 'terrain.bin', x0: terX0, z0: terZ0, cell: TER_CELL, w: terW, h: terH, ref: terrainRef };

// Police stations (task H.5): OSM amenity=police. Each gets a spot at the edge of the nearest
// road in front of it (busted players are put there) and the way a signboard there faces.
const police = [];
const seenPolice = [];
for (const el of [...detailEls, ...main].filter((e) => e.tags?.amenity === 'police')) {
  // Housing and radio masts are police places but not stations.
  if (/quart|quater|receiving/i.test(el.tags.name || '')) continue;
  const c = centreOf(el);
  if (!c || !inPA(c[0], c[1])) continue;
  if (seenPolice.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) < 40)) continue;
  seenPolice.push(c);
  let best = null;
  for (const sg of segGrid.query(c[0] - 120, c[1] - 120, c[0] + 120, c[1] + 120)) {
    const d = segDist(c[0], c[1], sg.a[0], sg.a[1], sg.b[0], sg.b[1]);
    if (!best || d < best.d) best = { d, sg };
  }
  if (!best || best.d > 120) continue;
  const { a, b, hw } = best.sg;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dz) / L2));
  const px = a[0] + dx * t, pz = a[1] + dz * t;
  // From the road centre towards the station, just past the road edge.
  const ox = c[0] - px, oz = c[1] - pz;
  const ol = Math.hypot(ox, oz) || 1;
  const k = Math.min(hw + 1.5, ol);
  police.push({ name: el.tags.name || 'Police Station', x: r1(px + (ox / ol) * k), z: r1(pz + (oz / ol) * k), a: Math.round(Math.atan2(-ox, -oz) * 1000) / 1000 });
}
police.sort((p, q) => p.x - q.x || p.z - q.z);

// Hospitals (task M.7): OSM amenity=hospital. Players whose health runs out get up at the
// nearest one: a spot at the edge of the road in front of it, facing away from the building,
// worked out the same way as the police stations.
const hospitals = [];
const seenHosp = [];
for (const el of [...detailEls, ...main].filter((e) => e.tags?.amenity === 'hospital')) {
  const c = centreOf(el);
  if (!c || !inPA(c[0], c[1])) continue;
  if (seenHosp.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) < 60)) continue;
  seenHosp.push(c);
  let best = null;
  for (const sg of segGrid.query(c[0] - 120, c[1] - 120, c[0] + 120, c[1] + 120)) {
    const d = segDist(c[0], c[1], sg.a[0], sg.a[1], sg.b[0], sg.b[1]);
    if (!best || d < best.d) best = { d, sg };
  }
  if (!best || best.d > 120) continue;
  const { a, b, hw } = best.sg;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dz) / L2));
  const px = a[0] + dx * t, pz = a[1] + dz * t;
  const ox = c[0] - px, oz = c[1] - pz;
  const ol = Math.hypot(ox, oz) || 1;
  const k = Math.min(hw + 1.5, ol);
  hospitals.push({ name: (el.tags.name || 'Hospital').slice(0, 60), x: r1(px + (ox / ol) * k), z: r1(pz + (oz / ol) * k), a: Math.round(Math.atan2(-ox, -oz) * 1000) / 1000 });
}
hospitals.sort((p, q) => p.x - q.x || p.z - q.z);

const map = {
  version: 2,
  center: { lat: CENTER.lat, lon: CENTER.lon },
  bounds,
  playArea: PA,
  roads,
  graph: { nodes, edges },
  buildings,
  water,
  parks,
  rail,
  waterways,
  landmarks,
  props,
  airport: { runway, terminal },
  terrain,
  police,
  hospitals,
  spawn,
  meta: { osmBase: raw.osmBase, overtureRelease: overture.release, credit: '© OpenStreetMap contributors, Overture Maps Foundation, Google Open Buildings, Dynamic World, Copernicus DEM' },
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
  if (m.version !== 2) err('version is not 2');
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
  m.water.forEach((w, i) => {
    poly(w.pts, `water ${i}`);
    (w.holes || []).forEach((h, k) => poly(h, `water ${i} hole ${k}`));
  });
  m.parks.forEach((p, i) => poly(p.pts, `park ${i}`));
  m.rail.forEach((r, i) => r.pts.forEach((p, k) => pt(p, `rail ${i} point ${k}`)));
  m.waterways.forEach((w, i) => {
    if (!(w.w > 0) || w.pts.length < 2) err(`waterway ${i}: bad width or too short`);
    w.pts.forEach((p, k) => pt(p, `waterway ${i} point ${k}`));
  });
  m.landmarks.forEach((l) => {
    pt([l.x, l.z], `landmark ${l.id}`);
    if (!l.nameEn || !l.nameTe) err(`landmark ${l.id}: missing name`);
    if (l.pts) poly(l.pts, `landmark ${l.id} outline`);
  });
  const flatPts = (arr, stride, what) => {
    if (!Array.isArray(arr) || arr.length % stride) return err(`${what}: bad flat array`);
    for (let i = 0; i < arr.length; i += stride) pt([arr[i] / 10, arr[i + 1] / 10], `${what} ${i / stride}`);
  };
  if (!m.props) err('props missing');
  else {
    m.props.poles.forEach((run, i) => {
      const abs = run.slice();
      for (let k = 2; k < abs.length; k++) abs[k] += abs[k - 2];
      flatPts(abs, 2, `pole run ${i}`);
    });
    flatPts(m.props.trees, 2, 'tree');
    flatPts(m.props.hoardings, 3, 'hoarding');
    flatPts(m.props.autoStands, 4, 'auto stand');
    flatPts(m.props.bumps, 4, 'speed breaker');
    m.props.worship.forEach((w, i) => {
      pt([w.x, w.z], `worship ${i}`);
      if (!(w.w > 0 && w.d > 0 && Number.isFinite(w.a) && 'hmc'.includes(w.r))) err(`worship ${i}: bad shape`);
    });
  }
  pt([m.airport.runway.x, m.airport.runway.z], 'runway');
  poly(m.airport.terminal.pts, 'terminal');
  pt([m.spawn.x, m.spawn.z], 'spawn');
  if (!Number.isFinite(m.spawn.heading)) err('spawn heading not finite');
  if (errs.length) throw new Error(`Map validation failed:\n  ${errs.join('\n  ')}`);
}
validate(map);

// Building outlines go into the file as whole-decimetre deltas (src/map/loadMap.ts unpacks them).
function packBuilding(b) {
  const p = [];
  let px = 0, pz = 0;
  for (const [x, z] of b.pts) {
    const X = Math.round(x * 10), Z = Math.round(z * 10);
    p.push(X - px, Z - pz);
    px = X;
    pz = Z;
  }
  const o = { p, h: b.h };
  if (b.kind) o.k = b.kind;
  if (b.style) o.s = b.style;
  if (b.gate !== undefined) o.w = b.gate;
  return o;
}
// Graph edges go into the file as one flat list [a, b, road, len in decimetres, i0, i1, ...]
// (src/map/loadMap.ts unpacks them).
const packedEdges = edges.flatMap((e) => [e.a, e.b, e.road, Math.round(e.len * 10), e.i0, e.i1]);
const json = JSON.stringify({ ...map, graph: { nodes, edges: packedEdges }, buildings: buildings.map(packBuilding) });
await mkdir(dirname(MAP_OUT_PATH), { recursive: true });
await writeFile(MAP_OUT_PATH, json);
await writeFile(TERRAIN_OUT_PATH, terBin);
const terSha = createHash('sha256').update(terBin).digest('hex').slice(0, 16);
const gzBytes = gzipSync(json, { level: 9 }).length;
const sha = createHash('sha256').update(json).digest('hex').slice(0, 16);

/* ================= REPORT ================= */
console.log('\n================ Kurnool map build ================');
console.log(`Wrote public/map/kurnool.json: ${(json.length / 1e6).toFixed(2)} MB (gzip ${(gzBytes / 1e6).toFixed(2)} MB), sha256 ${sha}`);
console.log(`Speed breakers (R.3): ${bumps.length / 4}`);
console.log(`Police stations (H.5): ${police.length} (${police.map((p) => p.name).join(', ')})`);
console.log(`Hospitals (M.7): ${hospitals.length} (${hospitals.map((p) => p.name).join(', ')})`);
console.log(`Roads: ${roads.length - 1} from OSM + 1 airport link, graph ${nodes.length} nodes / ${edges.length} edges`);
console.log(
  `Buildings: ${bStats.kept} from OSM (${bStats.shrunk} shrunk off roads) + ${fillerBuildings} filler = ${buildings.length}. ` +
    `Dropped: ${bStats.dropped} on roads, ${bStats.tiny} tiny, ${bStats.broken} broken, ${bStats.outside} outside`,
);
console.log(
  `Overture (${overture.release}): ${oStats.kept} added (${oStats.shrunk} shrunk off roads; real height ${oStats.realHeight}, real floors ${oStats.realFloors}) of ${oStats.total}. ` +
    `Skipped: ${oStats.onOsm} already in OSM, ${oStats.dropped} on roads, ${oStats.tiny} tiny, ${oStats.broken} broken, ${oStats.outside} outside`,
);
console.log(`  Overture added by source: ${Object.entries(oBySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`Buildings total: ${buildings.length} = OSM ${bStats.kept} + Overture ${oStats.kept} + filler ${fillerBuildings} - ${inWater} in water - ${removeBuilding.size} replaced by temples, mosques, churches (corrections listed below)`);
console.log(`Styles (K.2): ${Object.entries(styleCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}; ${walled} colony houses with compound walls`);
console.log(`  from ${zoneCount} land-use/amenity areas, ${shopCount} shops and businesses, ${places.length} named places (${places.filter((p) => p.kind === 'old').map((p) => p.name).join(', ')} = old city)`);
console.log(
  `Street details (K.3): ${poleCount} electric poles in ${poleRuns.length} wired runs, ${trees.length / 2} roadside trees, ${hoardings.length / 3} hoardings, ` +
    `${worship.length} places of worship (${['h', 'm', 'c'].map((r) => `${worship.filter((w) => w.r === r).length} ${{ h: 'temples', m: 'mosques', c: 'churches' }[r]}`).join(', ')}; ${removeBuilding.size} replace a building, ${worshipSkipped} skipped), ${autoStands.length / 4} auto stands`,
);
console.log(`Heights (K.5): ${hStats.satellite} from Google Open Buildings 2.5D, ${hStats.osmLevels} from OSM levels, ${hStats.notSeen} not seen by the satellite (style height). Floors 1/2/3/4/5/6+: ${hFloors.join('/')}`);
console.log(`Water widths (K.5, Dynamic World): ${eeWidths.map((e) => `${e.name} ${e.len} m: ${e.wet}/${e.stations} wet, ${e.width ?? '-'} m${e.offset != null ? ' (centre ' + e.offset + ' m off OSM)' : ''} [${e.used}]`).join('; ')}`);
console.log(`Terrain (K.5, Copernicus DEM): public/map/terrain.bin ${terW} x ${terH} at ${TER_CELL} m, ${(terBin.length / 1e6).toFixed(2)} MB, sha256 ${terSha}. Raj Vihar = ${terrainRef} m above sea level; ground from ${terMin} to ${terMax} m relative to it; ${terFlat} points under water lowered to the water level, ${terDug} dug for underpasses`);
console.log(`Station (K.5): ${stStats.osmPlatforms} OSM platforms (${stStats.underPlatform} satellite outlines on them became their shelters), ${stStats.roofs} platform roofs from satellite outlines beside the tracks, ${stStats.onTracks} buildings on the tracks dropped`);
console.log(`Grade separation (K.5): ${gStats.flyovers} flyover ways raised ${FLYOVER_H} m, ${gStats.underpasses} underpass ways dug ${UNDERPASS_D} m, ${gStats.ramps} ramp ways; ${crossings.length} level crossings (OSM)`);
console.log(`Corrections (K.4, scripts/osm/corrections.json): ${applied.length ? applied.join('; ') : 'none'}`);
console.log(
  `Rail (K.5): ${rail.length} runs, ${rail.filter((r) => r.bridge).length} bridges (${rail.filter((r) => r.overWater).length} over water, drawn high), ${rail.filter((r) => r.electric).length} electrified${railSkipped.length ? '; skipped ' + railSkipped.join(', ') : ''}. ` +
    `Waterways: ${waterways.length} canal/river lines (${waterways.filter((w) => w.part === 'aqueduct').length} aqueduct, ${waterways.filter((w) => w.part === 'culvert').length} culvert). ${inWater} buildings dropped for standing in water`,
);
console.log(`Parks: ${osmParks} from OSM + ${fillerParks} filler. Water: ${wStats.polygons} OSM polygons + ${wStats.lineStrips} canal strips + ${wStats.satellite} satellite outlines (${wStats.satelliteHoles} islands; ${wStats.satelliteSkipped} not on any OSM river or lake, left out) + ${riverbed.length} river-bed strips (${wStats.broken} broken dropped). Rail: ${rail.length}`);
console.log(`Landmarks: ${landmarks.map((l) => l.id).join(', ')}`);
if (missing.length) console.log(`MISSING landmarks (need a pin from Bunny in scripts/osm/corrections.json landmarkPins): ${missing.join(', ')}`);
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
