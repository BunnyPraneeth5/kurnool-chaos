import type { MapData, Pt, Road } from './types';
import { groundY, densify } from './terrain';
import { roadY, roadProfile } from './roads';
import { clipRuns, offsetLine, junctions, PointGrid, kerbLines, KERB_ROAD_KINDS } from './props';
import { pointInRing, makeRng } from '../util/rng';
import { junctionsOf } from '../ai/junctions';

// Roads and borders (Phase R): dividers, kerbs, footpaths, junction islands, speed breakers,
// railway walls and fences, canal railings, river embankments and ghats, stone edges by the
// water, bridge railings, barricades and cones. Everything is worked out here from the map's
// shapes, once per map (cached), so the collision world and the meshes agree and every screen
// gives the breakable pieces the same ids.

/* ---------- tuning ---------- */
const MAJOR = /^(trunk|primary|secondary)$/;
const BUSY_ROADS = /^(trunk|primary)$/; // dividers here get a railing on top
export const MEDIAN_H = 0.35; // concrete base under a railing (mountable at speed)
export const PLANTER_H = 0.5; // planted divider (solid)
const MEDIAN_W = 0.9; // centre divider of a two-way road
const TWIN_MAX_GAP = 14; // m between twin one-way roads to fill with a divider
const TWIN_RAIL_GAP = 3; // narrower twin dividers get a railing
const OPENING_EVERY = 300; // U-turn openings on two-way dividers
const OPENING = 12;
const LIGHT_EVERY = 35;
const RAIL_PANEL = 4;
const FENCE_PANEL = 4;
const FENCE_OFF = 3.6; // m from the track centre
const STATION_R = 700; // walls instead of fences this close to the station
const FOOTPATH_WIDE = 1.4;
const FOOTPATH_NARROW = 0.8;
const KERB_W = 0.25;
const BUND_OFF = 3; // embankment centre this far from the water's edge
const BUND_HW = 2.6;
const BUND_H = 0.9;
const BUMP_HW = 0.7; // speed breaker: half length along the road
const BUMP_H = 0.13;
const WORKS = 6; // road-works spots
const WORKS_LEN = 24;
const CHECKPOSTS = 4;

export type BreakKind = 'rail' | 'fence' | 'barrier' | 'cone';

/** A piece that breaks when hit hard (Phase R.1). */
export interface BreakItem {
  id: number;
  kind: BreakKind;
  /** centre and heading along its length (forward = (sin a, cos a)) */
  x: number;
  z: number;
  a: number;
  len: number;
  /** base height (absolute) */
  y: number;
  /** blocks vehicles until broken; false = looks only (a wall behind it already blocks) */
  solid: boolean;
}

/** A raised surface for heightAt: a strip along a segment (flat or a smooth hump), or a ring. */
export interface Raised {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  hw: number;
  /** height above the ground */
  h: number;
  bump: boolean;
  ring?: Pt[];
}

export interface Median {
  l: Pt[];
  r: Pt[];
  y: number;
  planter: boolean;
}

export interface Borders {
  /** solid walls (blocking between lo and hi; lo/hi undefined = always) */
  walls: { pts: Pt[]; lo?: number; hi?: number; top?: number }[];
  /** kerb-like walls: stop slow vehicles, mounted above about 25 km/h, walked over */
  kerbs: Pt[][];
  breakables: BreakItem[];
  raised: Raised[];
  medians: Median[];
  lights: { x: number; z: number; y: number; h: number }[];
  /** flyover and bridge centre barriers, with deck heights */
  barriers: { pts: Pt[]; y: number[] }[];
  footpaths: { l: Pt[]; r: Pt[]; y: number }[];
  islands: { ring: Pt[]; y: number }[];
  bumps: { x: number; z: number; a: number; hw: number }[];
  stationWalls: Pt[][];
  bridgeRails: { pts: Pt[]; y: number[] }[];
  stoneEdges: [Pt, Pt][];
  bunds: [Pt, Pt][];
  ghats: { x: number; z: number; a: number }[];
  works: Pt[][];
  booths: { x: number; z: number; a: number }[];
  /** roads with a centre divider (no overtaking across it) */
  dividedRoads: Set<number>;
}

/* ---------- small helpers ---------- */

const key = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);

class Grid<T> {
  private readonly cells = new Map<number, T[]>();
  constructor(private readonly cell: number) {}
  add(item: T, x0: number, z0: number, x1: number, z1: number): void {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) {
      for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
        const k = key(i, j);
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(item);
      }
    }
  }
  /** True if fn holds for any item in the cells within r (items may repeat; no allocation). */
  some(x: number, z: number, r: number, fn: (t: T) => boolean): boolean {
    for (let i = Math.floor((x - r) / this.cell); i <= Math.floor((x + r) / this.cell); i++) {
      for (let j = Math.floor((z - r) / this.cell); j <= Math.floor((z + r) / this.cell); j++) {
        const l = this.cells.get(key(i, j));
        if (l) for (const t of l) if (fn(t)) return true;
      }
    }
    return false;
  }

  /** Calls fn for each item in the cells within r (items may repeat). */
  each(x: number, z: number, r: number, fn: (t: T) => void): void {
    for (let i = Math.floor((x - r) / this.cell); i <= Math.floor((x + r) / this.cell); i++) {
      for (let j = Math.floor((z - r) / this.cell); j <= Math.floor((z + r) / this.cell); j++) {
        const l = this.cells.get(key(i, j));
        if (l) for (const t of l) fn(t);
      }
    }
  }

  near(x: number, z: number, r = 0): T[] {
    if (r <= 0) return this.cells.get(key(Math.floor(x / this.cell), Math.floor(z / this.cell))) ?? [];
    const out = new Set<T>();
    for (let i = Math.floor((x - r) / this.cell); i <= Math.floor((x + r) / this.cell); i++) {
      for (let j = Math.floor((z - r) / this.cell); j <= Math.floor((z + r) / this.cell); j++) for (const t of this.cells.get(key(i, j)) ?? []) out.add(t);
    }
    return [...out];
  }
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function polyLen(pts: Pt[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

/** Cut a polyline into pieces of about `len` metres: [start, end] of each piece. */
function pieces(pts: Pt[], len: number): [Pt, Pt][] {
  const total = polyLen(pts);
  const n = Math.max(1, Math.round(total / len));
  const step = total / n;
  const at = (s: number): Pt => {
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (s <= l && l > 0) {
        const t = s / l;
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
      }
      s -= l;
    }
    return pts[pts.length - 1];
  };
  const out: [Pt, Pt][] = [];
  for (let k = 0; k < n; k++) out.push([at(k * step), at((k + 1) * step)]);
  return out;
}

/* ---------- the map's surroundings ---------- */

class Context {
  readonly buildings = new Grid<Pt[]>(25);
  private readonly count = new Map<number, number>();
  private readonly busyCount = new Map<number, number>();
  readonly roadSegs = new Grid<{ ax: number; az: number; bx: number; bz: number; hw: number; road: number }>(32);
  readonly water = new Grid<{ pts: Pt[]; holes: Pt[][] }>(64);
  readonly rail = new Grid<Pt>(16);
  readonly hubs: Pt[];

  constructor(readonly map: MapData) {
    for (const b of map.buildings) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, cx = 0, cz = 0;
      for (const [x, z] of b.pts) {
        x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
        cx += x; cz += z;
      }
      this.buildings.add(b.pts, x0, z0, x1, z1);
      const k = key(Math.floor(cx / b.pts.length / 50), Math.floor(cz / b.pts.length / 50));
      this.count.set(k, (this.count.get(k) ?? 0) + 1);
      if (b.style === 1 || b.style === 3) this.busyCount.set(k, (this.busyCount.get(k) ?? 0) + 1);
    }
    map.roads.forEach((road, ri) => {
      const hw = road.width / 2;
      for (let i = 1; i < road.pts.length; i++) {
        const [ax, az] = road.pts[i - 1];
        const [bx, bz] = road.pts[i];
        this.roadSegs.add({ ax, az, bx, bz, hw, road: ri }, Math.min(ax, bx) - hw, Math.min(az, bz) - hw, Math.max(ax, bx) + hw, Math.max(az, bz) + hw);
      }
    });
    for (const w of map.water) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of w.pts) {
        x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
      }
      this.water.add({ pts: w.pts, holes: w.holes ?? [] }, x0, z0, x1, z1);
    }
    for (const run of map.rail) for (const p of densify(run.pts, 3)) this.rail.add(p, p[0], p[1], p[0], p[1]);
    this.hubs = ['station', 'busstand'].map((id) => map.landmarks.find((l) => l.id === id)).filter((l): l is NonNullable<typeof l> => !!l).map((l) => [l.x, l.z]);
  }

  private sum(m: Map<number, number>, x: number, z: number): number {
    const i = Math.floor(x / 50), j = Math.floor(z / 50);
    let n = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) n += m.get(key(i + a, j + b)) ?? 0;
    return n;
  }

  /** Built-up: houses close by. */
  city(x: number, z: number): boolean {
    return this.sum(this.count, x, z) >= 8;
  }

  /** Busy: market streets and the old city, and round the station and the bus stand. */
  busy(x: number, z: number): boolean {
    return this.sum(this.busyCount, x, z) >= 5 || this.hubs.some(([hx, hz]) => Math.hypot(hx - x, hz - z) < 450);
  }

  inBuilding(x: number, z: number): boolean {
    return this.buildings.some(x, z, 0, (r) => pointInRing(x, z, r));
  }

  inWater(x: number, z: number): boolean {
    return this.water.some(x, z, 0, (w) => pointInRing(x, z, w.pts) && !w.holes.some((h) => pointInRing(x, z, h)));
  }

  /** Within `extra` metres of any road's edge. */
  nearRoad(x: number, z: number, extra: number, except = -1): boolean {
    return this.roadSegs.some(x, z, extra + 8, (s) => s.road !== except && segDist(x, z, s.ax, s.az, s.bx, s.bz) < s.hw + extra);
  }

  /** Distance to the nearest track point (sampled every 3 m). */
  trackDist(x: number, z: number): number {
    let d = Infinity;
    this.rail.each(x, z, 8, ([px, pz]) => {
      d = Math.min(d, Math.hypot(px - x, pz - z));
    });
    return d;
  }
}

/* ---------- building it ---------- */

function build(map: MapData): Borders {
  const ctx = new Context(map);
  const out: Borders = {
    walls: [], kerbs: [], breakables: [], raised: [], medians: [], lights: [], barriers: [], footpaths: [], islands: [], bumps: [],
    stationWalls: [], bridgeRails: [], stoneEdges: [], bunds: [], ghats: [], works: [], booths: [], dividedRoads: new Set(),
  };
  const jGrid = new PointGrid(junctions(map, 4));
  const addBreak = (kind: BreakKind, a: Pt, b: Pt, y: number, solid: boolean): void => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.3 && kind !== 'cone') return;
    out.breakables.push({ id: out.breakables.length, kind, x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, a: Math.atan2(b[0] - a[0], b[1] - a[1]), len, y, solid });
  };
  const addItem = (kind: BreakKind, x: number, z: number, a: number, len: number, y: number): void => {
    out.breakables.push({ id: out.breakables.length, kind, x, z, a, len, y, solid: true });
  };
  const railings = (line: Pt[], y: (x: number, z: number) => number, solid: boolean): void => {
    for (const [a, b] of pieces(line, RAIL_PANEL)) addBreak('rail', a, b, y((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), solid);
  };
  const lightsAlong = (line: Pt[], y: number): void => {
    let along = 0;
    let next = LIGHT_EVERY / 2;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (next <= along + L && L > 0) {
        const t = (next - along) / L;
        out.lights.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, y, h: Math.atan2(b[0] - a[0], b[1] - a[1]) });
        next += LIGHT_EVERY;
      }
      along += L;
    }
  };
  const ring = (l: Pt[], r: Pt[]): Pt[] => [...l, ...r.slice().reverse(), l[0]];
  /** Divider between two edge lines: kerb-like base with a railing, or a solid planter. */
  const median = (l: Pt[], r: Pt[], y: number, withRail: boolean, centre: Pt[]): void => {
    out.medians.push({ l, r, y, planter: !withRail });
    if (withRail) {
      out.kerbs.push(ring(l, r));
      railings(centre, (x, z) => groundY(x, z) + y + MEDIAN_H, true);
    } else out.walls.push({ pts: ring(l, r), top: PLANTER_H + 0.15 }); // jumpable (task M.6)
  };

  /* R.2 (b): two-way main roads. */
  const openings: { x: number; z: number; a: number; y: number }[] = [];
  map.roads.forEach((road, ri) => {
    if (!MAJOR.test(road.kind) || road.oneway || road.bridge || road.lift || road.id === -1) return;
    if (road.width < (road.kind === 'secondary' ? 11 : 12)) return;
    out.dividedRoads.add(ri);
    const y = roadY(road.kind, road.bridge);
    const rail = BUSY_ROADS.test(road.kind);
    // U-turn openings (some get barricades in R.6).
    const total = polyLen(road.pts);
    for (let s = OPENING_EVERY; s + OPENING < total; s += OPENING_EVERY) {
      const p = pointAt(road.pts, s + OPENING / 2);
      if (!jGrid.near(p[0], p[1])) openings.push({ x: p[0], z: p[1], a: headingAt(road.pts, s + OPENING / 2), y });
    }
    for (const run of clipRuns(road.pts, (x, z, along) => !jGrid.near(x, z) && along % OPENING_EVERY > OPENING)) {
      const c = densify(run, 12);
      median(offsetLine(c, MEDIAN_W / 2), offsetLine(c, -MEDIAN_W / 2), y, rail, c);
      lightsAlong(c, y);
    }
  });

  /* R.2 (a): twin one-way roads side by side (NH44, NH40, ...). */
  const twinRoads = map.roads.map((r, i) => ({ r, i })).filter(({ r }) => r.oneway && MAJOR.test(r.kind) && !r.bridge && !r.lift && r.id !== -1);
  const samples = new Grid<{ road: number; x: number; z: number; dx: number; dz: number }>(24);
  const sampleOf = new Map<number, { x: number; z: number; dx: number; dz: number }[]>();
  for (const { r, i } of twinRoads) {
    const pts = densify(r.pts, 6);
    const list: { x: number; z: number; dx: number; dz: number }[] = [];
    for (let k = 0; k < pts.length; k++) {
      const p = pts[Math.max(0, k - 1)], q = pts[Math.min(pts.length - 1, k + 1)];
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const s = { x: pts[k][0], z: pts[k][1], dx: (q[0] - p[0]) / l, dz: (q[1] - p[1]) / l };
      list.push(s);
      samples.add({ road: i, ...s }, s.x, s.z, s.x, s.z);
    }
    sampleOf.set(i, list);
  }
  for (const { r, i } of twinRoads) {
    const hwA = r.width / 2;
    const list = sampleOf.get(i)!;
    // For each sample: the closest opposite-direction sample of another twin road (higher index, so each pair once).
    let curL: Pt[] = [], curR: Pt[] = [], curC: Pt[] = [], curGap = 0, partner = -1;
    const flush = (): void => {
      if (curL.length >= 3) {
        const withRail = BUSY_ROADS.test(r.kind) && curGap / curL.length < TWIN_RAIL_GAP;
        median(curL, curR, roadY(r.kind, false), withRail, curC);
        if (curGap / curL.length < 8) lightsAlong(curC, roadY(r.kind, false));
        out.dividedRoads.add(i);
        if (partner >= 0) out.dividedRoads.add(partner);
      }
      curL = []; curR = []; curC = []; curGap = 0; partner = -1;
    };
    for (const s of list) {
      let best: { road: number; x: number; z: number; d: number } | null = null;
      for (const o of samples.near(s.x, s.z, TWIN_MAX_GAP + 10)) {
        if (o.road <= i || o.dx * s.dx + o.dz * s.dz > -0.85) continue;
        const d = Math.hypot(o.x - s.x, o.z - s.z);
        if (!best || d < best.d) best = { road: o.road, x: o.x, z: o.z, d };
      }
      const hwB = best ? map.roads[best.road].width / 2 : 0;
      const gap = best ? best.d - hwA - hwB : -1;
      if (!best || gap < 0.5 || gap > TWIN_MAX_GAP || jGrid.near(s.x, s.z) || (partner >= 0 && best.road !== partner)) {
        flush();
        if (!best || gap < 0.5 || gap > TWIN_MAX_GAP || jGrid.near(s.x, s.z)) continue;
      }
      partner = best.road;
      const ux = (best.x - s.x) / best.d, uz = (best.z - s.z) / best.d;
      const a: Pt = [s.x + ux * (hwA + 0.15), s.z + uz * (hwA + 0.15)];
      const b: Pt = [best.x - ux * (hwB + 0.15), best.z - uz * (hwB + 0.15)];
      curL.push(a);
      curR.push(b);
      curC.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      curGap += gap;
    }
    flush();
  }

  /* R.2 (c): centre barriers on two-way flyovers and big bridges. */
  for (const road of map.roads) {
    if (!(road.bridge || road.lift) || road.oneway || road.width < 11 || road.id === -1) continue;
    const p = roadProfile(road);
    out.barriers.push({ pts: p.pts, y: p.y });
    for (let k = 1; k < p.pts.length; k++) {
      const lo = Math.min(p.y[k - 1], p.y[k]) - 0.8;
      const hi = Math.max(p.y[k - 1], p.y[k]) + 2;
      const l = offsetLine([p.pts[k - 1], p.pts[k]], 0.3);
      const rr = offsetLine([p.pts[k - 1], p.pts[k]], -0.3);
      out.walls.push({ pts: ring(l, rr), lo, hi, top: 1.0 });
    }
  }

  /* R.3: kerbs, footpaths, islands, speed breakers. */
  for (const k of kerbLines(map)) out.kerbs.push(k.pts);
  const kerbGrid = new PointGrid(junctions(map, 5));
  map.roads.forEach((road, ri) => {
    if (!KERB_ROAD_KINDS.has(road.kind) || road.bridge || road.lift || road.id === -1) return;
    const hw = road.width / 2;
    const y = roadY(road.kind, road.bridge);
    // Skip roads nowhere near a busy area; check busy-and-clear once per 3 m.
    if (!densify(road.pts, 25).some(([x, z]) => ctx.busy(x, z))) return;
    const baseMemo = new Map<number, boolean>();
    const base = (x: number, z: number, along: number): boolean => {
      const slot = Math.floor(along / 3);
      let v = baseMemo.get(slot);
      if (v === undefined) baseMemo.set(slot, (v = !kerbGrid.near(x, z) && ctx.busy(x, z)));
      return v;
    };
    for (const side of [1, -1]) {
      for (const width of [FOOTPATH_WIDE, FOOTPATH_NARROW]) {
        const inner = hw + KERB_W;
        const free = (x: number, z: number, dx: number, dz: number, w: number): boolean => {
          // Left of travel (dx, dz) is (-dz, dx)... sample the outer edge and the middle.
          for (const f of [w, w / 2]) {
            const px = x - dz * side * (inner + f), pz = z + dx * side * (inner + f);
            if (ctx.inBuilding(px, pz) || ctx.inWater(px, pz) || ctx.nearRoad(px, pz, 0.2, ri)) return false;
          }
          return true;
        };
        const memo = new Map<number, boolean>();
        const keep = (x: number, z: number, along: number): boolean => {
          if (!base(x, z, along)) return false;
          // The building checks are the slow part: once per 3 m is enough.
          const slot = Math.floor(along / 3);
          const known = memo.get(slot);
          if (known !== undefined) return known;
          const v = keepSlow(x, z, along);
          memo.set(slot, v);
          return v;
        };
        const keepSlow = (x: number, z: number, along: number): boolean => {
          const h = headingAt(road.pts, along);
          const dx = Math.sin(h), dz = Math.cos(h);
          if (!free(x, z, dx, dz, width)) return false;
          return width === FOOTPATH_WIDE || !free(x, z, dx, dz, FOOTPATH_WIDE);
        };
        for (const run of clipRuns(road.pts, keep)) {
          const c = densify(run, 10);
          const l = offsetLine(c, side * inner);
          const r = offsetLine(c, side * (inner + width));
          out.footpaths.push({ l, r, y });
          const mid = offsetLine(c, side * (inner + width / 2));
          for (let k = 1; k < mid.length; k++) out.raised.push({ ax: mid[k - 1][0], az: mid[k - 1][1], bx: mid[k][0], bz: mid[k][1], hw: width / 2, h: y + 0.2, bump: false });
        }
      }
    }
  });
  // Roundabout centres: lit junctions whose nodes sit round a circle.
  for (const j of junctionsOf(map).list) {
    if (j.nodes.size < 3) continue;
    let minD = Infinity;
    let widest = 0;
    for (const n of j.nodes) {
      const [nx, nz] = map.graph.nodes[n];
      minD = Math.min(minD, Math.hypot(nx - j.x, nz - j.z));
    }
    for (const e of map.graph.edges) if (j.nodes.has(e.a) && j.nodes.has(e.b)) widest = Math.max(widest, map.roads[e.road].width / 2);
    const rad = minD - widest - 0.6;
    if (rad < 2.2 || widest === 0) continue;
    const rr: Pt[] = [];
    for (let k = 0; k < 20; k++) rr.push([j.x + Math.sin((k / 20) * Math.PI * 2) * rad, j.z + Math.cos((k / 20) * Math.PI * 2) * rad]);
    out.islands.push({ ring: rr, y: 0.12 });
    out.kerbs.push([...rr, rr[0]]);
    out.raised.push({ ax: j.x, az: j.z, bx: j.x, bz: j.z, hw: 0, h: 0.32, bump: false, ring: rr });
  }
  const bumps = map.props.bumps ?? [];
  for (let i = 0; i + 3 < bumps.length; i += 4) {
    const x = bumps[i] / 10, z = bumps[i + 1] / 10, a = (bumps[i + 2] * Math.PI) / 180, hw = bumps[i + 3] / 10;
    out.bumps.push({ x, z, a, hw });
    // Across the road: right of forward (sin a, cos a) is (-cos a, sin a).
    out.raised.push({ ax: x - Math.cos(a) * hw, az: z + Math.sin(a) * hw, bx: x + Math.cos(a) * hw, bz: z - Math.sin(a) * hw, hw: BUMP_HW, h: BUMP_H, bump: true });
  }

  /* R.4: railway walls round the station, fences along the line in the city. */
  const station = map.landmarks.find((l) => l.id === 'station');
  const crossings = map.props.crossings;
  const platforms = map.props.platforms;
  for (const run of map.rail) {
    if (run.bridge && run.overWater) continue;
    const line = densify(run.pts, 3);
    for (const side of [1, -1]) {
      const edge = offsetLine(line, side * FENCE_OFF);
      const keep = (x: number, z: number): boolean =>
        ctx.city(x, z) &&
        ctx.trackDist(x, z) > FENCE_OFF - 0.8 &&
        !ctx.nearRoad(x, z, 2.5) &&
        !crossings.some((c) => Math.hypot(c.x - x, c.z - z) < c.hw + 5) &&
        !platforms.some((p) => pointInRing(x, z, p.pts)) &&
        !ctx.inBuilding(x, z) &&
        !ctx.inWater(x, z);
      for (const r of clipRuns(edge, keep)) {
        const mid = r[Math.floor(r.length / 2)];
        const nearStation = station && Math.hypot(mid[0] - station.x, mid[1] - station.z) < STATION_R;
        if (nearStation) {
          out.stationWalls.push(r);
          out.walls.push({ pts: r });
        } else for (const [a, b] of pieces(r, FENCE_PANEL)) addBreak('fence', a, b, groundY((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), true);
      }
    }
  }

  /* R.5: canal railings, river embankments and ghats, stone edges, bridge railings. */
  const canals = map.waterways.filter((w) => w.kind === 'canal' && !w.part);
  const canalSegs = new Grid<{ a: Pt; b: Pt; r: number }>(32);
  for (const c of canals) {
    for (let i = 1; i < c.pts.length; i++) {
      const a = c.pts[i - 1], b = c.pts[i], r = c.w / 2 + 6;
      canalSegs.add({ a, b, r }, Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r);
    }
  }
  const canalNear = (x: number, z: number): boolean => canalSegs.near(x, z).some((c) => segDist(x, z, c.a[0], c.a[1], c.b[0], c.b[1]) < c.r);
  for (const c of canals) {
    for (const side of [1, -1]) {
      const edge = offsetLine(densify(c.pts, 8), side * (c.w / 2 + 0.125));
      const keep = (x: number, z: number): boolean => ctx.city(x, z) && !ctx.nearRoad(x, z, 2) && ctx.nearRoad(x, z, 25);
      for (const r of clipRuns(edge, keep)) railings(r, (x, z) => groundY(x, z) + 0.7, false);
    }
  }
  // Water edges in 4 m pieces (like the collision banks): stone edge by roads, embankment elsewhere on the rivers.
  const bankSpots: { x: number; z: number; nx: number; nz: number }[] = [];
  for (const w of map.water) {
    for (const rng of [w.pts, ...(w.holes ?? [])]) {
      for (let i = 0; i < rng.length; i++) {
        const p = rng[i], q = rng[(i + 1) % rng.length];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const n = Math.max(1, Math.ceil(len / 4));
        for (let k = 0; k < n; k++) {
          const a: Pt = [p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n];
          const b: Pt = [p[0] + ((q[0] - p[0]) * (k + 1)) / n, p[1] + ((q[1] - p[1]) * (k + 1)) / n];
          const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
          if (!ctx.city(mx, mz) || ctx.nearRoad(mx, mz, 1)) continue; // roads crossing: gaps, as the banks
          if (ctx.nearRoad(mx, mz, 8)) {
            out.stoneEdges.push([a, b]);
            continue;
          }
          if (canalNear(mx, mz)) continue;
          // Embankment on the land side.
          const dx = (b[0] - a[0]) / (len / n), dz = (b[1] - a[1]) / (len / n);
          let nx = -dz, nz = dx;
          if (ctx.inWater(mx + nx * 2, mz + nz * 2)) {
            nx = -nx;
            nz = -nz;
          }
          if (ctx.inWater(mx + nx * 2, mz + nz * 2) || ctx.inBuilding(mx + nx * BUND_OFF, mz + nz * BUND_OFF)) continue;
          bankSpots.push({ x: mx, z: mz, nx, nz });
          const a2: Pt = [a[0] + nx * BUND_OFF, a[1] + nz * BUND_OFF], b2: Pt = [b[0] + nx * BUND_OFF, b[1] + nz * BUND_OFF];
          out.bunds.push([a2, b2]);
          out.raised.push({ ax: a2[0], az: a2[1], bx: b2[0], bz: b2[1], hw: BUND_HW, h: BUND_H, bump: true });
        }
      }
    }
  }
  // Ghats on the real water's edge; no embankment right there.
  out.ghats.push(...pickGhats(map, bankSpots));
  const clear = (x: number, z: number): boolean => !out.ghats.some((g) => Math.hypot(g.x - x, g.z - z) < 10);
  out.bunds = out.bunds.filter(([a, c]) => clear((a[0] + c[0]) / 2, (a[1] + c[1]) / 2));
  out.raised = out.raised.filter((r) => !r.bump || r.hw !== BUND_HW || clear((r.ax + r.bx) / 2, (r.az + r.bz) / 2));
  for (const road of map.roads) {
    if (!road.bridge || road.id === -1) continue;
    const p = roadProfile(road);
    const hw = road.width / 2 + 0.3;
    for (const side of [1, -1]) out.bridgeRails.push({ pts: offsetLine(p.pts, side * hw), y: p.y });
  }

  /* R.6: barricades and cones. */
  const rng = makeRng(20261127);
  for (const j of junctionsOf(map).list) {
    if (j.police) continue; // the stand is enough: barricades round it would block the junction
    // Channel the widest way in: a short row on its centre line before the stop line.
    const ap = j.approaches.reduce((p, q) => (q.hw > p.hw ? q : p), j.approaches[0]);
    if (!ap) continue;
    const road = roadOfEdge(map, ap.edge);
    if (!road || road.oneway || out.dividedRoads.has(map.roads.indexOf(road))) continue;
    const off = road.width * 0.25; // the stop point is on the left lane; the centre is this far right
    const cx = ap.stop[0] - Math.cos(ap.heading) * off, cz = ap.stop[1] + Math.sin(ap.heading) * off;
    for (let k = 0; k < 3; k++) {
      const x = cx - Math.sin(ap.heading) * (2 + k * 3), z = cz - Math.cos(ap.heading) * (2 + k * 3);
      addItem('barrier', x, z, ap.heading, 1.4, groundY(x, z) + 0.12);
    }
  }
  // Road works: one lane closed for 24 m.
  const worksSpots: Pt[] = [];
  const candidates = map.roads.map((r, i) => ({ r, i })).filter(({ r }) => MAJOR.test(r.kind) && !r.oneway && !r.bridge && !r.lift && r.width >= 9 && r.id !== -1 && polyLen(r.pts) > 120);
  for (let tries = 0; tries < 400 && worksSpots.length < WORKS && candidates.length; tries++) {
    const { r } = candidates[Math.floor(rng() * candidates.length)];
    const s = 40 + rng() * (polyLen(r.pts) - 80);
    const [x, z] = pointAt(r.pts, s);
    if (!ctx.city(x, z) || jGrid.near(x, z) || worksSpots.some((w) => Math.hypot(w[0] - x, w[1] - z) < 800)) continue;
    worksSpots.push([x, z]);
    const h = headingAt(r.pts, s);
    const ux = Math.sin(h), uz = Math.cos(h);
    const lx = Math.cos(h), lz = -Math.sin(h); // left of travel
    const lane = r.width * 0.25;
    const y = groundY(x, z) + roadY(r.kind, false);
    const c = (t: number, off: number): Pt => [x + ux * t + lx * off, z + uz * t + lz * off];
    out.works.push([c(-WORKS_LEN / 2 + 2, lane - 1.6), c(WORKS_LEN / 2 - 2, lane - 1.6), c(WORKS_LEN / 2 - 2, lane + 1.6), c(-WORKS_LEN / 2 + 2, lane + 1.6)]);
    for (let t = -WORKS_LEN / 2; t <= WORKS_LEN / 2; t += 3) {
      const [px, pz] = c(t, 0.4);
      addItem('cone', px, pz, h, 0.4, y);
    }
    for (const t of [-WORKS_LEN / 2, WORKS_LEN / 2]) {
      const [px, pz] = c(t, lane);
      addItem('barrier', px, pz, h + Math.PI / 2, 1.4, y);
    }
  }
  // Police checkposts: at the stations and where the highways leave the city.
  for (const st of map.police ?? []) {
    for (const t of [-2.5, 2.5]) {
      const x = st.x + Math.cos(st.a) * t, z = st.z - Math.sin(st.a) * t;
      addItem('barrier', x, z, st.a + Math.PI / 2, 1.4, groundY(x, z) + 0.12);
    }
  }
  const exits: { x: number; z: number; h: number; road: Road; d: number }[] = [];
  for (const road of map.roads) {
    if (!/^trunk$/.test(road.kind) || road.bridge || road.lift || road.id === -1) continue;
    const pts = densify(road.pts, 20);
    for (let k = 1; k < pts.length; k++) {
      const inA = ctx.city(pts[k - 1][0], pts[k - 1][1]);
      const inB = ctx.city(pts[k][0], pts[k][1]);
      if (inA === inB) continue;
      const [x, z] = inA ? pts[k - 1] : pts[k];
      exits.push({ x, z, h: Math.atan2(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]), road, d: Math.hypot(x - map.spawn.x, z - map.spawn.z) });
    }
  }
  exits.sort((p, q) => q.d - p.d);
  const posts: typeof exits = [];
  for (const e of exits) {
    if (posts.length >= CHECKPOSTS) break;
    if (jGrid.near(e.x, e.z) || posts.some((p) => Math.hypot(p.x - e.x, p.z - e.z) < 1000)) continue;
    posts.push(e);
  }
  for (const e of posts) {
    const lane = e.road.oneway ? 0 : e.road.width * 0.25;
    const lx = Math.cos(e.h), lz = -Math.sin(e.h);
    const ux = Math.sin(e.h), uz = Math.cos(e.h);
    const y = groundY(e.x, e.z) + roadY(e.road.kind, false);
    // Staggered: one barricade on each lane, 8 m apart, so traffic weaves through.
    addItem('barrier', e.x + lx * lane, e.z + lz * lane, e.h + Math.PI / 2, 1.4, y);
    addItem('barrier', e.x - lx * lane + ux * 8, e.z - lz * lane + uz * 8, e.h + Math.PI / 2, 1.4, y);
    const bx = e.x + lx * (e.road.width / 2 + 3), bz = e.z + lz * (e.road.width / 2 + 3);
    if (!ctx.inBuilding(bx, bz)) out.booths.push({ x: bx, z: bz, a: e.h });
  }
  // Every other U-turn opening on the divided roads is closed with barricades.
  openings.forEach((o, k) => {
    if (k % 2) return;
    for (const t of [-4, 0, 4]) {
      const x = o.x + Math.sin(o.a) * t, z = o.z + Math.cos(o.a) * t;
      addItem('barrier', x, z, o.a, 1.4, groundY(x, z) + o.y);
    }
  });
  return out;
}

function pointAt(pts: Pt[], s: number): Pt {
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (s <= l && l > 0) {
      const t = Math.max(0, s / l);
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    }
    s -= l;
  }
  return pts[pts.length - 1];
}

function headingAt(pts: Pt[], s: number): number {
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (s <= l || i === pts.length - 1) return Math.atan2(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    s -= l;
  }
  return 0;
}

function roadOfEdge(map: MapData, edge: number): Road | null {
  const e = map.graph.edges[edge];
  return e ? map.roads[e.road] : null;
}

/** Ghats (Bunny OK'd the proposal): two on the Tungabhadra near the old city, one on the Handri, on bank pieces. */
function pickGhats(map: MapData, banks: { x: number; z: number; nx: number; nz: number }[]): { x: number; z: number; a: number }[] {
  const fort = map.landmarks.find((l) => l.id === 'fort');
  const rv = map.landmarks.find((l) => l.id === 'rajvihar');
  const out: { x: number; z: number; a: number }[] = [];
  const riverDist = (name: RegExp, x: number, z: number): number => {
    let d = Infinity;
    for (const w of map.waterways) {
      if (w.kind !== 'river' || !name.test(w.name ?? '')) continue;
      for (let i = 1; i < w.pts.length; i++) d = Math.min(d, segDist(x, z, w.pts[i - 1][0], w.pts[i - 1][1], w.pts[i][0], w.pts[i][1]) - w.w / 2);
    }
    return d;
  };
  const pick = (name: RegExp, reach: number, near: { x: number; z: number } | undefined, count: number): void => {
    if (!near) return;
    const cand = banks.filter((b) => riverDist(name, b.x, b.z) < reach).sort((p, q) => Math.hypot(p.x - near.x, p.z - near.z) - Math.hypot(q.x - near.x, q.z - near.z));
    let added = 0;
    for (const c of cand) {
      if (added >= count) break;
      if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 400)) continue;
      // Steps lead from the bank down towards the water (away from the land side).
      out.push({ x: c.x, z: c.z, a: Math.atan2(-c.nx, -c.nz) });
      added++;
    }
  };
  pick(/tungabhadra/i, 900, fort, 2);
  pick(/handri/i, 80, rv, 1);
  return out;
}

const cache = new WeakMap<MapData, Borders>();

/** The borders of a map (built once). */
export function bordersOf(map: MapData): Borders {
  let b = cache.get(map);
  if (!b) cache.set(map, (b = build(map)));
  return b;
}
