// Geometry helpers shared by report.mjs and build.mjs.
// OSM shapes come in as [lat, lon]; planar shapes are [x, z] in metres.
import { project } from './common.mjs';

/* ---------- OSM element helpers ---------- */
export const pts = (geom) => (geom || []).filter(Boolean).map((p) => [p.lat, p.lon]);

/** All polylines of a way or relation, as [lat, lon][] each. */
export function wayLines(el) {
  if (el.type === 'way') return el.geometry ? [pts(el.geometry)] : [];
  if (el.type === 'relation') return (el.members || []).filter((m) => m.geometry).map((m) => pts(m.geometry));
  return [];
}

const pkey = (p) => p[0] + ',' + p[1];

/** Join multipolygon member ways into rings by matching shared end nodes. */
export function joinRings(segs) {
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

/** Outer rings of a closed way or multipolygon relation, as [lat, lon][] each. */
export function polygons(el) {
  if (el.type === 'way') return wayLines(el);
  const outer = (el.members || []).filter((m) => m.geometry && m.role !== 'inner').map((m) => pts(m.geometry));
  return joinRings(outer);
}

export function centerOf(el) {
  if (el.lat != null) return [el.lat, el.lon];
  if (el.center) return [el.center.lat, el.center.lon];
  if (el.bounds) return [(el.bounds.minlat + el.bounds.maxlat) / 2, (el.bounds.minlon + el.bounds.maxlon) / 2];
  const all = wayLines(el).flat();
  if (!all.length) return null;
  return [all.reduce((s, p) => s + p[0], 0) / all.length, all.reduce((s, p) => s + p[1], 0) / all.length];
}

/** Length in metres of a [lat, lon] polyline. */
export function lengthM(line) {
  let len = 0;
  for (let i = 1; i < line.length; i++) {
    const a = project(line[i - 1][0], line[i - 1][1]);
    const b = project(line[i][0], line[i][1]);
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

export const allNames = (t) =>
  [t.name, t['name:en'], t['name:te'], t.alt_name, t.old_name, t.official_name].filter(Boolean).join(' | ');
export const label = (t) => t.name || t['name:en'] || t['name:te'] || '(no name)';
export const uid = (el) => el.type[0] + el.id;

/* ---------- planar helpers on [x, z] ---------- */

/** Length of an [x, z] polyline. */
export function polyLen(line) {
  let len = 0;
  for (let i = 1; i < line.length; i++) len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return len;
}

/** Signed shoelace area of an open ring. */
export function ringArea(r) {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const p = r[i];
    const q = r[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function ringCentroid(r) {
  const A = ringArea(r);
  if (Math.abs(A) < 1e-6) {
    return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const p = r[i];
    const q = r[(i + 1) % n];
    const f = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * f;
    cz += (p[1] + q[1]) * f;
  }
  return [cx / (6 * A), cz / (6 * A)];
}

export function pointInRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i];
    const b = r[j];
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Distance from point p to segment ab. */
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** True if segments ab and cd properly cross (touching or collinear overlap does not count). */
export function segsCross(a, b, c, d) {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function segSegDist(a, b, c, d) {
  if (segsCross(a, b, c, d)) return 0;
  return Math.min(
    segDist(a[0], a[1], c[0], c[1], d[0], d[1]),
    segDist(b[0], b[1], c[0], c[1], d[0], d[1]),
    segDist(c[0], c[1], a[0], a[1], b[0], b[1]),
    segDist(d[0], d[1], a[0], a[1], b[0], b[1]),
  );
}

/** True if any two non-adjacent edges of an open ring cross. */
export function selfIntersects(r) {
  const n = r.length;
  if (n < 4) return false;
  const box = [];
  for (let i = 0; i < n; i++) {
    const a = r[i];
    const b = r[(i + 1) % n];
    box.push([Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])]);
  }
  const order = [...box.keys()].sort((i, j) => box[i][0] - box[j][0]);
  for (let oi = 0; oi < n; oi++) {
    const i = order[oi];
    for (let oj = oi + 1; oj < n; oj++) {
      const j = order[oj];
      if (box[j][0] > box[i][1]) break;
      if (box[j][2] > box[i][3] || box[j][3] < box[i][2]) continue;
      if (Math.abs(i - j) === 1 || Math.abs(i - j) === n - 1) continue;
      if (segsCross(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** Douglas-Peucker simplification of an [x, z] polyline. Endpoints are kept. */
export function simplify(line, tol) {
  if (line.length <= 2) return line.slice();
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let md = 0;
    let mi = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(line[i][0], line[i][1], line[s][0], line[s][1], line[e][0], line[e][1]);
      if (d > md) {
        md = d;
        mi = i;
      }
    }
    if (md > tol) {
      keep[mi] = 1;
      stack.push([s, mi], [mi, e]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

/** Sutherland-Hodgman clip of an open ring to an axis-aligned rectangle. */
export function clipRingToRect(ring, minX, minZ, maxX, maxZ) {
  const inside = [
    (p) => p[0] >= minX,
    (p) => p[0] <= maxX,
    (p) => p[1] >= minZ,
    (p) => p[1] <= maxZ,
  ];
  const cut = [
    (a, b) => [minX, a[1] + ((minX - a[0]) / (b[0] - a[0])) * (b[1] - a[1])],
    (a, b) => [maxX, a[1] + ((maxX - a[0]) / (b[0] - a[0])) * (b[1] - a[1])],
    (a, b) => [a[0] + ((minZ - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), minZ],
    (a, b) => [a[0] + ((maxZ - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), maxZ],
  ];
  let out = ring;
  for (let e = 0; e < 4 && out.length; e++) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i];
      const prev = inp[(i + inp.length - 1) % inp.length];
      const cIn = inside[e](cur);
      const pIn = inside[e](prev);
      if (cIn) {
        if (!pIn) out.push(cut[e](prev, cur));
        out.push(cur);
      } else if (pIn) {
        out.push(cut[e](prev, cur));
      }
    }
  }
  return out;
}

/* ---------- deterministic randomness ---------- */
export function hash32(...parts) {
  let h = 2166136261;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: small seeded PRNG, returns floats in [0, 1). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
