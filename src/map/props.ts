import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapData, Pt, Worship } from './types';
import type { QualitySettings } from '../world/quality';
import { SolidMeshBuilder } from './meshBuilder';
import { roadY } from './roads';
import { makeRng } from '../util/rng';
import { densify, groundY, lowestGround } from './terrain';

// Street details (task K.3): black-and-yellow kerbs and dividers with street lights on
// main roads, electric poles and wires, roadside neem trees, hoardings, temples, mosques
// and churches, and auto stands. Positions of the placed props come from the build
// (map.props); kerbs and dividers follow the road shapes. Everything is merged or
// instanced per 500 m chunk: per chunk one props mesh, one kerb mesh, one tree mesh
// and one set of wires.

export const PROP_CHUNK = 500;
const KERB_ROADS = new Set(['trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link']);
const DIVIDER_ROADS = new Set(['trunk', 'primary']);
const KERB_W = 0.25;
const KERB_H = 0.22;
const DIVIDER_W = 0.9;
const DIVIDER_H = 0.4;
const DIVIDER_OPENING_EVERY = 300; // m, U-turn gaps
const DIVIDER_OPENING = 12; // m
const LIGHT_EVERY = 35; // m
const POLE_H = 8;
const WIRE_Y = 7.55;
const AUTO_GAP = 3.1; // m between parked autos

/* ---------- shared shapes (rendering and collision) ---------- */

interface Junction {
  x: number;
  z: number;
  r: number;
}

/** Junctions with three or more road pieces, with a clearance radius from their widest road. */
function junctions(map: MapData, margin: number): Junction[] {
  const deg = new Map<number, number>();
  const wide = new Map<number, number>();
  for (const e of map.graph.edges) {
    const hw = map.roads[e.road].width / 2;
    for (const n of [e.a, e.b]) {
      deg.set(n, (deg.get(n) ?? 0) + 1);
      wide.set(n, Math.max(wide.get(n) ?? 0, hw));
    }
  }
  const out: Junction[] = [];
  for (const [n, d] of deg) {
    if (d < 3) continue;
    const [x, z] = map.graph.nodes[n];
    out.push({ x, z, r: (wide.get(n) ?? 0) + margin });
  }
  return out;
}

class PointGrid {
  private readonly cells = new Map<string, Junction[]>();
  constructor(list: Junction[], private readonly cell = 50) {
    for (const j of list) {
      const k = `${Math.floor(j.x / cell)},${Math.floor(j.z / cell)}`;
      let l = this.cells.get(k);
      if (!l) this.cells.set(k, (l = []));
      l.push(j);
    }
  }
  near(x: number, z: number): boolean {
    const c = this.cell;
    const i0 = Math.floor(x / c);
    const j0 = Math.floor(z / c);
    for (let i = i0 - 1; i <= i0 + 1; i++) {
      for (let j = j0 - 1; j <= j0 + 1; j++) {
        for (const p of this.cells.get(`${i},${j}`) ?? []) if (Math.hypot(p.x - x, p.z - z) < p.r) return true;
      }
    }
    return false;
  }
}

/** Splits a polyline into the runs where keep(x, z, along) holds, checked every metre. */
export function clipRuns(pts: Pt[], keep: (x: number, z: number, along: number) => boolean): Pt[][] {
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  let lastPinned = false; // the run's last point is a corner or its start, so it must stay
  let along = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(L));
    for (let s = i === 1 ? 0 : 1; s <= steps; s++) {
      const t = s / steps;
      const p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (keep(p[0], p[1], along + L * t)) {
        // Only keep the run's ends and the polyline's corners; in-between points slide the end forward.
        const corner = s === steps;
        if (cur.length && !lastPinned) cur[cur.length - 1] = p;
        else cur.push(p);
        lastPinned = corner || cur.length === 1;
      } else if (cur.length) {
        if (cur.length >= 2) runs.push(cur);
        cur = [];
        lastPinned = false;
      }
    }
    along += L;
  }
  if (cur.length >= 2) runs.push(cur);
  return runs.filter((r) => Math.hypot(r[r.length - 1][0] - r[0][0], r[r.length - 1][1] - r[0][1]) > 1.5);
}

/** A polyline moved sideways by d (positive = left of travel), with mitred corners. */
export function offsetLine(pts: Pt[], d: number): Pt[] {
  const n = pts.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[Math.max(0, i - 1)];
    const q = pts[Math.min(n - 1, i + 1)];
    let nx = 0, nz = 0;
    if (i > 0) {
      const dx = pts[i][0] - p[0], dz = pts[i][1] - p[1];
      const l = Math.hypot(dx, dz) || 1;
      nx += -dz / l;
      nz += dx / l;
    }
    if (i < n - 1) {
      const dx = q[0] - pts[i][0], dz = q[1] - pts[i][1];
      const l = Math.hypot(dx, dz) || 1;
      nx += -dz / l;
      nz += dx / l;
    }
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    // Mitre: divide by the cosine to the segment normal, capped.
    let cos = 1;
    if (i < n - 1) {
      const dx = q[0] - pts[i][0], dz = q[1] - pts[i][1];
      const L = Math.hypot(dx, dz) || 1;
      cos = Math.max(0.4, nx * (-dz / L) + nz * (dx / L));
    }
    out.push([pts[i][0] + (nx * d) / cos, pts[i][1] + (nz * d) / cos]);
  }
  return out;
}

export interface DividerRun {
  pts: Pt[];
  y: number;
}

/** Centre dividers of two-way trunk and primary roads, with gaps at junctions and U-turn openings. */
export function dividerRuns(map: MapData): DividerRun[] {
  const grid = new PointGrid(junctions(map, 4));
  const out: DividerRun[] = [];
  for (const road of map.roads) {
    if (!DIVIDER_ROADS.has(road.kind) || road.oneway || road.bridge || road.lift || road.width < 12 || road.id === -1) continue;
    const y = roadY(road.kind, road.bridge);
    for (const pts of clipRuns(road.pts, (x, z, along) => !grid.near(x, z) && along % DIVIDER_OPENING_EVERY > DIVIDER_OPENING)) {
      out.push({ pts, y });
    }
  }
  return out;
}

const decode = (flat: number[], stride: number): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i + stride <= flat.length; i += stride) out.push(flat.slice(i, i + stride));
  return out;
};

/** Pole runs in metres. */
function poleRuns(map: MapData): Pt[][] {
  return map.props.poles.map((run) => {
    const pts: Pt[] = [];
    let x = 0;
    let z = 0;
    for (let i = 0; i + 1 < run.length; i += 2) {
      x += run[i];
      z += run[i + 1];
      pts.push([x / 10, z / 10]);
    }
    return pts;
  });
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Corners of a box centred at (x, z), w along heading a (forward = (sin a, cos a)), d across. */
export function boxRing(x: number, z: number, a: number, w: number, d: number): Pt[] {
  const ux = Math.sin(a), uz = Math.cos(a);
  const nx = -uz, nz = ux;
  const hw = w / 2, hd = d / 2;
  return [
    [x - ux * hw - nx * hd, z - uz * hw - nz * hd],
    [x + ux * hw - nx * hd, z + uz * hw - nz * hd],
    [x + ux * hw + nx * hd, z + uz * hw + nz * hd],
    [x - ux * hw + nx * hd, z - uz * hw + nz * hd],
  ];
}
const closed = (r: Pt[]): Pt[] => [...r, r[0]];

/** Auto positions: [x, z, heading] for each parked auto. */
function autoSpots(map: MapData): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const [x, z, deg, n] of decode(map.props.autoStands, 4)) {
    const a = rad(deg);
    for (let k = 0; k < n; k++) {
      const t = (k - (n - 1) / 2) * AUTO_GAP;
      out.push([x / 10 + Math.sin(a) * t, z / 10 + Math.cos(a) * t, a]);
    }
  }
  return out;
}

/** Wall outlines of solid street details, for the collision world. */
export function propWalls(map: MapData): Pt[][] {
  const out: Pt[][] = [];
  for (const run of poleRuns(map)) for (const [x, z] of run) out.push(closed(boxRing(x, z, 0, 0.3, 0.3)));
  for (const [x, z] of decode(map.props.trees, 2)) out.push(closed(boxRing(x / 10, z / 10, 0, 0.5, 0.5)));
  for (const [x, z, deg] of decode(map.props.hoardings, 3)) {
    const a = rad(deg);
    const sx = Math.cos(a), sz = -Math.sin(a); // along the board
    for (const t of [-2.2, 2.2]) out.push(closed(boxRing(x / 10 + sx * t, z / 10 + sz * t, a, 0.35, 0.35)));
  }
  for (const w of map.props.worship) out.push(closed(boxRing(w.x, w.z, w.a, w.w, w.d)));
  for (const pl of map.props.platforms) out.push(closed(pl.pts));
  for (const [x, z, a] of autoSpots(map)) out.push(closed(boxRing(x, z, a, 2.7, 1.4)));
  for (const d of dividerRuns(map)) {
    const l = offsetLine(d.pts, DIVIDER_W / 2);
    const r = offsetLine(d.pts, -DIVIDER_W / 2);
    out.push([...l, ...r.reverse(), l[0]]);
  }
  return out;
}

/* ---------- rendering ---------- */

const ADS = [
  ['SILKS & SAREES', '#b3123a', '#ffd84a'],
  ['GOLD JEWELLERY', '#6a1b4d', '#ffcf5a'],
  ['MOBILES', '#1d4fa8', '#ffffff'],
  ['CEMENT', '#5b5b5b', '#ffde3b'],
  ['ADMISSIONS OPEN', '#0f7a4a', '#ffffff'],
  ['BIRYANI HOUSE', '#e2571e', '#fff4d6'],
  ['TILES & GRANITE', '#3b3f8f', '#f4f1ea'],
  ['MOTORS', '#c41e1e', '#ffffff'],
  ['HOSPITAL 24x7', '#ffffff', '#0d6eaf'],
  ['FURNITURE', '#7a4b23', '#ffe6b0'],
  ['TEXTILES', '#d81b78', '#ffffff'],
  ['SWEETS', '#ffb000', '#7a1f1f'],
  ['COACHING CENTRE', '#14213d', '#fca311'],
  ['PAINTS', '#00a6a6', '#ffffff'],
  ['AUTO STAND', '#ffd400', '#111111'],
];
const AD_COLS = 4;
const AD_ROWS = 4;
const AUTO_STAND_AD = 14;
// The last cell (index 15) is plain white: plain-coloured surfaces sample it.
const WHITE_U = (3 + 0.5) / AD_COLS;
const WHITE_V = 0.5 / AD_ROWS; // bottom row in texture space

function propAtlas(anisotropy: number): THREE.CanvasTexture {
  const cw = 128;
  const ch = 64;
  const c = document.createElement('canvas');
  c.width = cw * AD_COLS;
  c.height = ch * AD_ROWS;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas not available for hoardings');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  const rng = makeRng(311);
  ADS.forEach(([text, bg, fg], i) => {
    const x = (i % AD_COLS) * cw;
    const y = Math.floor(i / AD_COLS) * ch;
    g.fillStyle = bg;
    g.fillRect(x, y, cw, ch);
    g.fillStyle = fg;
    if (i !== AUTO_STAND_AD) {
      // A picture block and a stripe, like a printed flex banner.
      g.globalAlpha = 0.35;
      g.beginPath();
      g.arc(x + cw - 22, y + 24, 16 + rng() * 6, 0, Math.PI * 2);
      g.fill();
      g.fillRect(x, y + ch - 12, cw, 6);
      g.globalAlpha = 1;
    }
    g.font = `bold ${text.length > 11 ? 15 : 20}px sans-serif`;
    g.textBaseline = 'middle';
    g.fillText(text, x + 8, y + ch / 2 - 4, cw - 16);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 3;
    g.strokeRect(x + 1.5, y + 1.5, cw - 3, ch - 3);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

/** Black-and-yellow stripes (bottom half) and divider green (top half), repeating every 2 m. */
function stripeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas not available for kerbs');
  g.fillStyle = '#4f7a3a';
  g.fillRect(0, 0, 64, 8);
  g.fillStyle = '#1d1d1f';
  g.fillRect(0, 8, 32, 8);
  g.fillStyle = '#f2c21b';
  g.fillRect(32, 8, 32, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}
const STRIPE_V = 0.25;
const GREEN_V = 0.75;

const col = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);

/** Box without a bottom, centred at (x, z), w along heading a, d across, from y0 to y1. */
export function box(mb: SolidMeshBuilder, x: number, z: number, a: number, w: number, d: number, y0: number, y1: number, c: THREE.Color, front?: [number, number, number, number]): void {
  const r = boxRing(x, z, a, w, d);
  for (let k = 0; k < 4; k++) {
    const p = r[k];
    const q = r[(k + 1) % 4];
    const dx = q[0] - p[0], dz = q[1] - p[1];
    const L = Math.hypot(dx, dz) || 1;
    // boxRing has positive shoelace area, so the outward normal of edge (dx, dz) is (dz, -dx).
    const nx = dz / L, nz = -dx / L;
    // Face 2 (corner 2 to 3) is w wide and faces +n = (-cos a, sin a); it carries the picture, if any.
    const uv = front && k === 2 ? front : null;
    const cc = uv ? WHITE : c;
    const u0 = uv ? uv[0] : WHITE_U, u1 = uv ? uv[2] : WHITE_U;
    const v0 = uv ? uv[1] : WHITE_V, v1 = uv ? uv[3] : WHITE_V;
    const i0 = mb.vertex(p[0], y0, p[1], nx, 0, nz, u1, v0, cc);
    const i1 = mb.vertex(q[0], y0, q[1], nx, 0, nz, u0, v0, cc);
    const i2 = mb.vertex(q[0], y1, q[1], nx, 0, nz, u0, v1, cc);
    const i3 = mb.vertex(p[0], y1, p[1], nx, 0, nz, u1, v1, cc);
    mb.tri(i0, i1, i2);
    mb.tri(i0, i2, i3);
  }
  const t = r.map(([px, pz]) => mb.vertex(px, y1, pz, 0, 1, 0, WHITE_U, WHITE_V, c));
  mb.tri(t[0], t[1], t[2]);
  mb.tri(t[0], t[2], t[3]);
}

/** Pyramid (four sides) from a square base at y0 to a point at y1. */
function pyramid(mb: SolidMeshBuilder, x: number, z: number, a: number, s: number, y0: number, y1: number, c: THREE.Color): void {
  const r = boxRing(x, z, a, s, s);
  for (let k = 0; k < 4; k++) {
    const p = r[k];
    const q = r[(k + 1) % 4];
    const mx = (p[0] + q[0]) / 2 - x, mz = (p[1] + q[1]) / 2 - z;
    const L = Math.hypot(mx, mz) || 1;
    const h = y1 - y0;
    const ny = (L / Math.hypot(L, h));
    const k2 = h / Math.hypot(L, h);
    const nx = (mx / L) * k2, nz = (mz / L) * k2;
    mb.tri(mb.vertex(p[0], y0, p[1], nx, ny, nz, WHITE_U, WHITE_V, c), mb.vertex(q[0], y0, q[1], nx, ny, nz, WHITE_U, WHITE_V, c), mb.vertex(x, y1, z, nx, ny, nz, WHITE_U, WHITE_V, c));
  }
}

/** Upright prism with `sides` faces and an optional cone cap. */
function prism(mb: SolidMeshBuilder, x: number, z: number, rr: number, sides: number, y0: number, y1: number, c: THREE.Color): void {
  for (let s = 0; s < sides; s++) {
    const t0 = (s / sides) * Math.PI * 2;
    const t1 = ((s + 1) / sides) * Math.PI * 2;
    const tm = (t0 + t1) / 2;
    const nx = Math.cos(tm), nz = Math.sin(tm);
    const p0 = mb.vertex(x + Math.cos(t0) * rr, y0, z + Math.sin(t0) * rr, nx, 0, nz, WHITE_U, WHITE_V, c);
    const p1 = mb.vertex(x + Math.cos(t1) * rr, y0, z + Math.sin(t1) * rr, nx, 0, nz, WHITE_U, WHITE_V, c);
    const p2 = mb.vertex(x + Math.cos(t1) * rr, y1, z + Math.sin(t1) * rr, nx, 0, nz, WHITE_U, WHITE_V, c);
    const p3 = mb.vertex(x + Math.cos(t0) * rr, y1, z + Math.sin(t0) * rr, nx, 0, nz, WHITE_U, WHITE_V, c);
    mb.tri(p0, p1, p2);
    mb.tri(p0, p2, p3);
  }
}

/** Low-poly dome (half sphere) of radius rr sitting at y0. */
function dome(mb: SolidMeshBuilder, x: number, z: number, rr: number, y0: number, c: THREE.Color, sides = 8, rings = 3): void {
  const at = (s: number, k: number): [number, number, number] => {
    const t = (s / sides) * Math.PI * 2;
    const p = (k / rings) * (Math.PI / 2);
    return [Math.cos(t) * Math.cos(p), Math.sin(p), Math.sin(t) * Math.cos(p)];
  };
  for (let k = 0; k < rings; k++) {
    for (let s = 0; s < sides; s++) {
      const q = [at(s, k), at(s + 1, k), at(s + 1, k + 1), at(s, k + 1)];
      const idx = q.map(([nx, ny, nz]) => mb.vertex(x + nx * rr, y0 + ny * rr, z + nz * rr, nx, ny, nz, WHITE_U, WHITE_V, c));
      mb.tri(idx[0], idx[1], idx[2]);
      if (k < rings - 1) mb.tri(idx[0], idx[2], idx[3]);
    }
  }
}

const C = (hex: number): THREE.Color => col.setHex(hex);

function temple(mb: SolidMeshBuilder, w: Worship): void {
  const { x, z, a } = w;
  const ux = Math.sin(a), uz = Math.cos(a);
  const s = Math.min(w.w, w.d);
  box(mb, x, z, a, w.w, w.d, 0, 0.6, C(0xb8ad9a)); // stone platform
  // Mandapa (hall) at the front half, sanctum tower at the back.
  box(mb, x - ux * w.w * 0.18, z - uz * w.w * 0.18, a, w.w * 0.55, w.d * 0.75, 0.6, 3.8, C(0xf1e6cf));
  const tx = x + ux * w.w * 0.22, tz = z + uz * w.w * 0.22;
  let side = s * 0.5;
  box(mb, tx, tz, a, side, side, 0.6, 4.4, C(0xf4efe4));
  const tiers = [0xe0a33a, 0xf4efe4, 0xc8553d, 0xe0a33a];
  let y = 4.4;
  for (const hex of tiers) {
    side *= 0.78;
    box(mb, tx, tz, a, side, side, y, y + 1.1, C(hex));
    y += 1.1;
  }
  pyramid(mb, tx, tz, a, side * 0.8, y, y + 1.2, C(0xc8553d));
  box(mb, tx, tz, a, 0.35, 0.35, y + 1.1, y + 1.7, C(0xe8c34a)); // kalasha
  // Flag post (dhwaja stambham) in front.
  const fx = x - ux * (w.w / 2 - 0.6), fz = z - uz * (w.w / 2 - 0.6);
  box(mb, fx, fz, a, 0.25, 0.25, 0.6, 7.5, C(0xd9b440));
}

function mosque(mb: SolidMeshBuilder, w: Worship): void {
  const { x, z, a } = w;
  const ux = Math.sin(a), uz = Math.cos(a);
  const nx = -uz, nz = ux;
  const s = Math.min(w.w, w.d);
  box(mb, x, z, a, w.w * 0.85, w.d * 0.8, 0, 4.6, C(0xeef2ea));
  box(mb, x, z, a, w.w * 0.87, w.d * 0.82, 4.6, 5.0, C(0x2f8f5b)); // green band
  dome(mb, x, z, s * 0.28, 5.0, C(0x3a9a64));
  box(mb, x, z, a, 0.15, 0.15, 5.0 + s * 0.28, 6.0 + s * 0.28, C(0xe8c34a));
  // Two minarets at the front corners.
  for (const side of [-1, 1]) {
    const mx = x - ux * w.w * 0.45 + nx * side * w.d * 0.42;
    const mz = z - uz * w.w * 0.45 + nz * side * w.d * 0.42;
    prism(mb, mx, mz, 0.55, 8, 0, 11, C(0xeef2ea));
    prism(mb, mx, mz, 0.75, 8, 8, 8.5, C(0x2f8f5b)); // balcony
    dome(mb, mx, mz, 0.55, 11, C(0x3a9a64), 6, 2);
  }
}

function church(mb: SolidMeshBuilder, w: Worship): void {
  const { x, z, a } = w;
  const ux = Math.sin(a), uz = Math.cos(a);
  box(mb, x + ux * w.w * 0.1, z + uz * w.w * 0.1, a, w.w * 0.8, w.d * 0.6, 0, 5.5, C(0xf2efe8));
  // Gable roof as a long pyramid-ish ridge: two sloped boxes would cost more, so a low pyramid row.
  box(mb, x + ux * w.w * 0.1, z + uz * w.w * 0.1, a, w.w * 0.82, w.d * 0.62, 5.5, 6.0, C(0x9b3b2e));
  const tx = x - ux * w.w * 0.38, tz = z - uz * w.w * 0.38;
  const ts = Math.min(w.d * 0.35, 3.2);
  box(mb, tx, tz, a, ts, ts, 0, 11, C(0xf2efe8));
  pyramid(mb, tx, tz, a, ts, 11, 14, C(0x9b3b2e));
  box(mb, tx, tz, a, 0.15, 0.15, 14, 15.6, C(0xf4f1ea)); // cross post
  box(mb, tx, tz, a + Math.PI / 2, 0.9, 0.15, 15, 15.2, C(0xf4f1ea)); // cross arm
}

function auto(mb: SolidMeshBuilder, x: number, z: number, a: number, tint: number): void {
  const ux = Math.sin(a), uz = Math.cos(a);
  box(mb, x, z, a, 2.6, 1.3, 0.3, 1.0, C(tint)); // body
  box(mb, x - ux * 0.25, z - uz * 0.25, a, 1.9, 1.32, 1.0, 1.85, C(0x1f1f22)); // canopy
  box(mb, x + ux * 1.15, z + uz * 1.15, a, 0.2, 1.1, 1.0, 1.55, C(0x9fb6c8)); // windscreen
  for (const t of [1.0, -0.9]) box(mb, x + ux * t, z + uz * t, a, 0.5, 1.36, 0, 0.42, C(0x151515)); // wheels
}

function neemGeometry(): THREE.BufferGeometry {
  const paint = (g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry => {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.deleteAttribute('uv');
    const c = new THREE.Color(hex);
    const cols = new Float32Array(ng.attributes.position.count * 3);
    for (let i = 0; i < cols.length; i += 3) {
      cols[i] = c.r;
      cols[i + 1] = c.g;
      cols[i + 2] = c.b;
    }
    ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return ng;
  };
  const trunk = paint(new THREE.CylinderGeometry(0.2, 0.28, 3, 3, 1, true).translate(0, 1.5, 0), 0x5e4532);
  // Neem: a wide, dense rounded crown.
  const crown = paint(new THREE.IcosahedronGeometry(2.6, 0).scale(1.15, 0.8, 1.15).translate(0, 4.6, 0), 0x3f6e38);
  const merged = mergeGeometries([trunk, crown]);
  if (!merged) throw new Error('Could not build the neem tree model');
  return merged;
}

export function buildProps(map: MapData, quality: QualitySettings, anisotropy: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'street details';
  const key = (x: number, z: number): string => `${Math.floor(x / PROP_CHUNK)},${Math.floor(z / PROP_CHUNK)}`;
  const props = new Map<string, SolidMeshBuilder>();
  const kerbs = new Map<string, SolidMeshBuilder>();
  const wires = new Map<string, number[]>();
  const trees = new Map<string, Pt[]>();
  const get = <T>(m: Map<string, T>, k: string, make: () => T): T => {
    let v = m.get(k);
    if (!v) m.set(k, (v = make()));
    return v;
  };
  const propMb = (x: number, z: number): SolidMeshBuilder => get(props, key(x, z), () => new SolidMeshBuilder());
  const kerbMb = (x: number, z: number): SolidMeshBuilder => get(kerbs, key(x, z), () => new SolidMeshBuilder());

  /* Kerbs and dividers: a strip with stripes on its sides (u = metres / 2) and a top. */
  const strip = (line: Pt[], halfW: number, base: (x: number, z: number) => number, h: number, topV: number): void => {
    const l = offsetLine(line, halfW);
    const r = offsetLine(line, -halfW);
    const yl = l.map(([x, z]) => base(x, z));
    const yr = r.map(([x, z]) => base(x, z));
    let along = 0;
    col.setHex(0xffffff);
    for (let i = 1; i < line.length; i++) {
      const L = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      const u0 = along / 2, u1 = (along + L) / 2;
      along += L;
      const mb = kerbMb((line[i][0] + line[i - 1][0]) / 2, (line[i][1] + line[i - 1][1]) / 2);
      const dx = line[i][0] - line[i - 1][0], dz = line[i][1] - line[i - 1][1];
      const nl = Math.hypot(dx, dz) || 1;
      for (const [E, Y, sgn] of [[l, yl, 1], [r, yr, -1]] as const) {
        const nx = (-dz / nl) * sgn, nz = (dx / nl) * sgn;
        const a = E[i - 1], b = E[i];
        const i0 = mb.vertex(a[0], Y[i - 1], a[1], nx, 0, nz, u0, STRIPE_V, col);
        const i1 = mb.vertex(b[0], Y[i], b[1], nx, 0, nz, u1, STRIPE_V, col);
        const i2 = mb.vertex(b[0], Y[i] + h, b[1], nx, 0, nz, u1, STRIPE_V, col);
        const i3 = mb.vertex(a[0], Y[i - 1] + h, a[1], nx, 0, nz, u0, STRIPE_V, col);
        mb.tri(i0, i1, i2);
        mb.tri(i0, i2, i3);
      }
      const t0 = mb.vertex(l[i - 1][0], yl[i - 1] + h, l[i - 1][1], 0, 1, 0, u0, topV, col);
      const t1 = mb.vertex(l[i][0], yl[i] + h, l[i][1], 0, 1, 0, u1, topV, col);
      const t2 = mb.vertex(r[i][0], yr[i] + h, r[i][1], 0, 1, 0, u1, topV, col);
      const t3 = mb.vertex(r[i - 1][0], yr[i - 1] + h, r[i - 1][1], 0, 1, 0, u0, topV, col);
      mb.tri(t0, t1, t2);
      mb.tri(t0, t2, t3);
    }
  };

  const kerbGrid = new PointGrid(junctions(map, 2.5));
  for (const road of map.roads) {
    if (!KERB_ROADS.has(road.kind) || road.bridge || road.lift || road.id === -1) continue;
    const hw = road.width / 2;
    const y = roadY(road.kind, road.bridge);
    for (const run of clipRuns(road.pts, (x, z) => !kerbGrid.near(x, z))) {
      for (const side of [1, -1]) strip(offsetLine(densify(run, 16), side * (hw + KERB_W / 2)), KERB_W / 2, (x, z) => groundY(x, z) + y - 0.05, KERB_H + 0.05, STRIPE_V);
    }
  }
  const lightC = new THREE.Color(0x8d9096);
  const lampC = new THREE.Color(0xfff1b8);
  for (const d of dividerRuns(map)) {
    strip(densify(d.pts, 16), DIVIDER_W / 2, (x, z) => groundY(x, z) + d.y - 0.05, DIVIDER_H + 0.05, GREEN_V);
    // Street lights on the divider, arms across the road.
    let along = 0;
    let next = LIGHT_EVERY / 2;
    for (let i = 1; i < d.pts.length; i++) {
      const a = d.pts[i - 1], b = d.pts[i];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / (L || 1), uz = (b[1] - a[1]) / (L || 1);
      while (next <= along + L) {
        const t = next - along;
        const x = a[0] + ux * t, z = a[1] + uz * t;
        const h = Math.atan2(ux, uz);
        const mb = propMb(x, z);
        const g0 = mb.count;
        box(mb, x, z, h, 0.2, 0.2, d.y, d.y + 9, lightC);
        box(mb, x, z, h + Math.PI / 2, 3.6, 0.12, d.y + 8.8, d.y + 9, lightC);
        for (const s of [-1.75, 1.75]) box(mb, x - uz * s, z + ux * s, h, 0.6, 0.3, d.y + 8.6, d.y + 8.85, lampC);
        mb.lift(g0, groundY(x, z));
        next += LIGHT_EVERY;
      }
      along += L;
    }
  }

  /* Electric poles and wires. */
  const poleC = new THREE.Color(0x9c9a94);
  for (const run of poleRuns(map)) {
    for (let i = 0; i < run.length; i++) {
      const [x, z] = run[i];
      const p = run[Math.max(0, i - 1)];
      const q = run[Math.min(run.length - 1, i + 1)];
      const h = Math.atan2(q[0] - p[0], q[1] - p[1]);
      const mb = propMb(x, z);
      const g0 = mb.count;
      const gy = groundY(x, z);
      box(mb, x, z, h, 0.22, 0.22, -0.3, POLE_H, poleC);
      box(mb, x, z, h + Math.PI / 2, 1.6, 0.12, WIRE_Y - 0.1, WIRE_Y + 0.05, poleC);
      mb.lift(g0, gy);
      if (i > 0) {
        const nx = Math.cos(h) * 0.7, nz = -Math.sin(h) * 0.7; // arm ends, across the road direction
        const list = get(wires, key(x, z), () => [] as number[]);
        const py = groundY(p[0], p[1]);
        for (const s of [-1, 1]) list.push(p[0] + nx * s, py + WIRE_Y, p[1] + nz * s, x + nx * s, gy + WIRE_Y, z + nz * s);
      }
    }
  }

  /* Hoardings: two posts and a board, the ad on the side facing the road. */
  const postC = new THREE.Color(0x5d5a58);
  const backC = new THREE.Color(0x77736f);
  decode(map.props.hoardings, 3).forEach(([xd, zd, deg], i) => {
    const x = xd / 10, z = zd / 10, a = rad(deg);
    const sx = Math.cos(a), sz = -Math.sin(a);
    const mb = propMb(x, z);
    const g0 = mb.count;
    for (const t of [-2.2, 2.2]) box(mb, x + sx * t, z + sz * t, a, 0.3, 0.3, -0.5, 4.2, postC);
    const ad = i % AUTO_STAND_AD; // every ad except the auto stand board
    const u0 = (ad % AD_COLS) / AD_COLS, u1 = u0 + 1 / AD_COLS;
    const v1 = 1 - Math.floor(ad / AD_COLS) / AD_ROWS, v0 = v1 - 1 / AD_ROWS;
    // box(): w along heading, d across. The board is 6 m along (sx, sz) and 0.3 m deep along the heading.
    box(mb, x, z, a + Math.PI / 2, 6, 0.3, 4.2, 7.2, backC, [u0, v0, u1, v1]);
    mb.lift(g0, Math.min(groundY(x + sx * 2.2, z + sz * 2.2), groundY(x - sx * 2.2, z - sz * 2.2)));
  });

  /* Places of worship. */
  for (const w of map.props.worship) {
    const mb = propMb(w.x, w.z);
    const g0 = mb.count;
    if (w.r === 'm') mosque(mb, w);
    else if (w.r === 'c') church(mb, w);
    else temple(mb, w);
    mb.lift(g0, lowestGround(boxRing(w.x, w.z, w.a, w.w, w.d)));
  }

  /* Railway platforms: a raised concrete slab with a yellow edge, and a sheet roof on columns. */
  const slabC = new THREE.Color(0xb9b2a6);
  const slabTop = new THREE.Color(0xcfc9be);
  const edgeC = new THREE.Color(0xe8c22a);
  const roofC = new THREE.Color(0x7a3b2e);
  const colC = new THREE.Color(0x8a8f93);
  for (const pl of map.props.platforms) {
    const ring = pl.pts;
    let cx = 0, cz = 0;
    for (const [x, z] of ring) {
      cx += x;
      cz += z;
    }
    cx /= ring.length;
    cz /= ring.length;
    const mb = propMb(cx, cz);
    const g = groundY(cx, cz);
    const top = g + 0.85;
    // Sides.
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const L = Math.hypot(dx, dz) || 1;
      const nx = dz / L, nz = -dx / L;
      const q = [mb.vertex(a[0], g - 0.5, a[1], nx, 0, nz, WHITE_U, WHITE_V, slabC), mb.vertex(b[0], g - 0.5, b[1], nx, 0, nz, WHITE_U, WHITE_V, slabC), mb.vertex(b[0], top, b[1], nx, 0, nz, WHITE_U, WHITE_V, edgeC), mb.vertex(a[0], top, a[1], nx, 0, nz, WHITE_U, WHITE_V, edgeC)];
      mb.tri(q[0], q[1], q[2]);
      mb.tri(q[0], q[2], q[3]);
    }
    // Top.
    const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
    const ti = ring.map(([x, z]) => mb.vertex(x, top, z, 0, 1, 0, WHITE_U, WHITE_V, slabTop));
    for (const [a, b, c] of tris) mb.tri(ti[a], ti[b], ti[c]);
    if (!pl.roof) continue;
    // Shelter along the platform's long axis: columns every 9 m and a roof slightly narrower than the slab.
    let best = 0, ux = 1, uz = 0;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L > best) {
        best = L;
        ux = (b[0] - a[0]) / L;
        uz = (b[1] - a[1]) / L;
      }
    }
    let u0 = Infinity, u1 = -Infinity, n0 = Infinity, n1 = -Infinity;
    for (const [x, z] of ring) {
      const u = (x - cx) * ux + (z - cz) * uz, n = (x - cx) * -uz + (z - cz) * ux;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u);
      n0 = Math.min(n0, n); n1 = Math.max(n1, n);
    }
    const len = u1 - u0 - 2, wid = Math.max(2, n1 - n0 - 1.5);
    const mu = (u0 + u1) / 2, mn = (n0 + n1) / 2;
    const ox = cx + ux * mu - uz * mn, oz = cz + uz * mu + ux * mn;
    const head = Math.atan2(ux, uz);
    const g0 = mb.count;
    for (let s = -len / 2; s <= len / 2 + 0.01; s += 9) box(mb, ox + ux * s, oz + uz * s, head, 0.3, 0.3, 0.85, 4.6, colC);
    box(mb, ox, oz, head, len + 1, wid, 4.6, 4.85, roofC);
    mb.lift(g0, g);
  }

  /* Auto stands: parked autos and a sign. */
  const AUTO_TINTS = [0x2f8f4a, 0xf2c21b, 0x2f8f4a, 0x2f8f4a];
  autoSpots(map).forEach(([x, z, a], i) => {
    const mb = propMb(x, z);
    const g0 = mb.count;
    auto(mb, x, z, a, AUTO_TINTS[i % AUTO_TINTS.length]);
    mb.lift(g0, groundY(x, z) + 0.12);
  });
  for (const [xd, zd, deg, n] of decode(map.props.autoStands, 4)) {
    const a = rad(deg);
    const x = xd / 10 + Math.sin(a) * ((n / 2) * AUTO_GAP + 1.5);
    const z = zd / 10 + Math.cos(a) * ((n / 2) * AUTO_GAP + 1.5);
    const mb = propMb(x, z);
    const g0 = mb.count;
    box(mb, x, z, a, 0.15, 0.15, -0.3, 2.6, postC);
    const u0 = (AUTO_STAND_AD % AD_COLS) / AD_COLS, v1 = 1 - Math.floor(AUTO_STAND_AD / AD_COLS) / AD_ROWS;
    // Board 1.6 m along the kerb, facing the road (right of the heading = +n).
    box(mb, x, z, a, 1.6, 0.08, 2.2, 3.0, backC, [u0, v1 - 1 / AD_ROWS, u0 + 1 / AD_COLS, v1]);
    mb.lift(g0, groundY(x, z));
  }

  /* Roadside neem trees. */
  for (const [xd, zd] of decode(map.props.trees, 2)) {
    const x = xd / 10, z = zd / 10;
    get(trees, key(x, z), () => [] as Pt[]).push([x, z]);
  }

  // Meshes.
  const propMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: propAtlas(anisotropy) });
  for (const [k, mb] of props) {
    if (mb.empty) continue;
    const m = new THREE.Mesh(mb.build(), propMat);
    m.name = `props ${k}`;
    group.add(m);
  }
  const kerbMat = new THREE.MeshLambertMaterial({ map: stripeTexture() });
  for (const [k, mb] of kerbs) {
    if (mb.empty) continue;
    const m = new THREE.Mesh(mb.build(), kerbMat);
    m.name = `kerbs ${k}`;
    group.add(m);
  }
  const wireMat = new THREE.LineBasicMaterial({ color: 0x2a2730 });
  for (const [k, list] of wires) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
    g.computeBoundingSphere();
    const lines = new THREE.LineSegments(g, wireMat);
    lines.name = `wires ${k}`;
    group.add(lines);
  }
  const neem = neemGeometry();
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const tint = new THREE.Color();
  for (const [k, list] of trees) {
    const mesh = new THREE.InstancedMesh(neem, treeMat, list.length);
    const rng = makeRng(list.length * 7919 + Math.round(list[0][0]));
    list.forEach(([x, z], i) => {
      q.setFromAxisAngle(up, rng() * Math.PI * 2);
      const s = 0.8 + rng() * 0.45;
      mesh.setMatrixAt(i, m4.compose(pos.set(x, groundY(x, z), z), q, scl.set(s, s * (0.9 + rng() * 0.25), s)));
      mesh.setColorAt(i, tint.setHSL(0.27 + rng() * 0.05, 0.3, 0.75 + rng() * 0.35));
    });
    mesh.computeBoundingSphere();
    mesh.name = `neem ${k}`;
    group.add(mesh);
  }
  void quality;
  return group;
}
