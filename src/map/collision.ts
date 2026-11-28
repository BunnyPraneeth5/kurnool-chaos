import type { MapData, Pt } from './types';
import { roadY, roadProfile, flyoverPiers } from './roads';
import { groundY } from './terrain';
import { pointInRing } from '../util/rng';
import { compoundWall } from './buildingStyle';
import { propWalls } from './props';
import { railWalls } from './rail';
import { junctionWalls } from '../ai/junctions';
import { bordersOf, type BreakItem, type Raised } from './borders';

// Collision world (ARCHITECTURE: Collision): a uniform 32 m hash grid of wall
// segments. Players and vehicles are circles pushed out of walls.
//
// Walls are building outlines and water banks. Where a drivable road crosses
// water (bridges and culverts) the bank walls are removed along the road, and
// railings are added along the part of the road that is over water, so you can
// cross but not step off the side into the river.

const CELL = 32;
const SPLIT = 4; // water banks are cut into pieces of at most 4 m so roads can carve gaps
const ROAD_GAP = 1.0; // extra metres either side of a road kept free of bank walls
const RAILING = 0.3; // railing sits this far outside the road edge

export interface CollideResult {
  x: number;
  z: number;
  hit: boolean;
  /** breakable pieces this circle went through (hit hard enough, Phase R.1) */
  broke: number[];
}

/** A vehicle's speed (m/s) and weight class: kerbs stop slow vehicles, hard hits break things. */
export interface VehicleHit {
  speed: number;
  heavy: boolean;
}

/** Above this a vehicle mounts kerbs (about 25 km/h). */
export const KERB_MOUNT = 7;
/** Hit a breakable piece faster than this and it breaks (30 km/h; buses and lorries 15 km/h). */
export const BREAK_SPEED = 8.3;
export const BREAK_SPEED_HEAVY = 4.2;
/** Broken pieces are fixed after this long (shared with friends). */
export const FIX_MS = 120000;
/** How tall each breakable piece is: someone jumping higher clears it (task M.6). */
const BREAK_TOP: Record<BreakItem['kind'], number> = { rail: 1.1, barrier: 1.0, cone: 0.75, fence: 1.8 };

interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  hw: number;
  y: number; // surface height at a (bridge decks: ya at a, yb at b)
  yb?: number;
}

const key = (i: number, j: number): number => (i + 2048) * 4096 + (j + 2048);

function segDist(px: number, pz: number, s: { ax: number; az: number; bx: number; bz: number }): number {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - s.ax) * dx + (pz - s.az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (s.ax + t * dx), pz - (s.az + t * dz));
}

/** Small grid of items with bounding boxes, used while building and for height queries. */
class ItemGrid<T> {
  private readonly cells = new Map<number, T[]>();
  constructor(private readonly cell: number) {}
  add(item: T, x0: number, z0: number, x1: number, z1: number): void {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) {
      for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
        const k = key(i, j);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(item);
      }
    }
  }
  at(x: number, z: number): T[] {
    return this.cells.get(key(Math.floor(x / this.cell), Math.floor(z / this.cell))) ?? [];
  }
}

export class CollisionWorld {
  private readonly ax: Float64Array;
  private readonly az: Float64Array;
  private readonly bx: Float64Array;
  private readonly bz: Float64Array;
  private readonly ylo: Float64Array; // walls only block between these heights (railings up on decks)
  private readonly yhi: Float64Array;
  private readonly kerb: Uint8Array; // 1 = kerb-like: stops slow vehicles, mounted at speed, walked over
  private readonly top: Float32Array; // height above the ground: people jumping higher clear it (task M.6)
  private readonly cells = new Map<number, number[]>();
  private readonly stamp: Uint32Array;
  private query = 0;
  private readonly decks = new ItemGrid<Seg>(CELL);
  private readonly bounds: MapData['bounds'];
  readonly wallCount: number;
  private readonly out: CollideResult = { x: 0, z: 0, hit: false, broke: [] };
  /** Breakable pieces (Phase R.1): state, and when each broken one is fixed (performance.now ms). */
  readonly breakables: readonly BreakItem[];
  readonly broken: Uint8Array;
  private readonly fixAt: Float64Array;
  private readonly bcells = new Map<number, number[]>();
  /** Pieces that broke or were fixed since the last drain (for the meshes). */
  private changed: number[] = [];
  private readonly brokenNow = new Set<number>();
  private readonly raised = new ItemGrid<Raised>(CELL);

  constructor(map: MapData) {
    this.bounds = map.bounds;
    const ax: number[] = [];
    const az: number[] = [];
    const bx: number[] = [];
    const bz: number[] = [];
    const ylo: number[] = [];
    const yhi: number[] = [];
    const kerb: number[] = [];
    const top: number[] = [];
    const addWall = (x0: number, z0: number, x1: number, z1: number, lo = -1e9, hi = 1e9, isKerb = 0, height = Infinity): void => {
      top.push(height);
      ax.push(x0);
      az.push(z0);
      bx.push(x1);
      bz.push(z1);
      ylo.push(lo);
      yhi.push(hi);
      kerb.push(isKerb);
    };

    // Buildings.
    for (const b of map.buildings) {
      const r = b.pts;
      for (let i = 0; i < r.length; i++) {
        const p = r[i];
        const q = r[(i + 1) % r.length];
        addWall(p[0], p[1], q[0], q[1]);
      }
      // Compound walls around colony houses (task K.2), open at the gate.
      const wall = compoundWall(b);
      if (wall) for (const line of wall) for (let i = 1; i < line.length; i++) addWall(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
    }

    // Solid street details (task K.3): poles, tree trunks, hoarding posts, temples, mosques, churches, autos, dividers.
    for (const line of [...propWalls(map), ...railWalls(map), ...junctionWalls(map)]) for (let i = 1; i < line.length; i++) addWall(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);

    // Roads and borders (Phase R): dividers, station walls, flyover barriers; kerbs; breakables; raised surfaces.
    const borders = bordersOf(map);
    for (const w of borders.walls) for (let i = 1; i < w.pts.length; i++) addWall(w.pts[i - 1][0], w.pts[i - 1][1], w.pts[i][0], w.pts[i][1], w.lo, w.hi, 0, w.top);
    for (const line of borders.kerbs) for (let i = 1; i < line.length; i++) addWall(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1], -1e9, 1e9, 1);
    this.breakables = borders.breakables;
    this.broken = new Uint8Array(this.breakables.length);
    this.fixAt = new Float64Array(this.breakables.length);
    for (const b of this.breakables) {
      if (!b.solid) continue;
      const r = b.len / 2 + 1;
      for (let i = Math.floor((b.x - r) / CELL); i <= Math.floor((b.x + r) / CELL); i++) {
        for (let j = Math.floor((b.z - r) / CELL); j <= Math.floor((b.z + r) / CELL); j++) {
          const k = key(i, j);
          let l = this.bcells.get(k);
          if (!l) this.bcells.set(k, (l = []));
          l.push(b.id);
        }
      }
    }
    for (const r of borders.raised) {
      if (r.ring) {
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const [x, z] of r.ring) {
          x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
        }
        this.raised.add(r, x0, z0, x1, z1);
      } else this.raised.add(r, Math.min(r.ax, r.bx) - r.hw, Math.min(r.az, r.bz) - r.hw, Math.max(r.ax, r.bx) + r.hw, Math.max(r.az, r.bz) + r.hw);
    }

    // Road segments, for carving bank gaps and placing railings.
    const roadSegs = new ItemGrid<Seg>(CELL);
    for (const road of map.roads) {
      const hw = road.width / 2;
      const y = roadY(road.kind, road.bridge);
      for (let i = 1; i < road.pts.length; i++) {
        const [x0, z0] = road.pts[i - 1];
        const [x1, z1] = road.pts[i];
        const s: Seg = { ax: x0, az: z0, bx: x1, bz: z1, hw, y };
        const m = hw + ROAD_GAP;
        roadSegs.add(s, Math.min(x0, x1) - m, Math.min(z0, z1) - m, Math.max(x0, x1) + m, Math.max(z0, z1) + m);

      }
    }
    // Decks: bridges run straight between their banks and flyovers stand on their ramps (see
    // roadProfile); the ground or deck under a car is the one nearest its height (heightAt).
    for (const road of map.roads) {
      if (!road.bridge && !road.lift) continue;
      const hw = road.width / 2;
      const p = roadProfile(road);
      for (let i = 1; i < p.pts.length; i++) {
        const [x0, z0] = p.pts[i - 1];
        const [x1, z1] = p.pts[i];
        const s: Seg = { ax: x0, az: z0, bx: x1, bz: z1, hw, y: p.y[i - 1], yb: p.y[i] };
        this.decks.add(s, Math.min(x0, x1) - hw, Math.min(z0, z1) - hw, Math.max(x0, x1) + hw, Math.max(z0, z1) + hw);
      }
    }
    const onRoad = (x: number, z: number): boolean => roadSegs.at(x, z).some((s) => segDist(x, z, s) < s.hw + ROAD_GAP);

    // Water banks, minus gaps where roads cross.
    const waterGrid = new ItemGrid<{ pts: Pt[]; holes: Pt[][] }>(64);
    for (const w of map.water) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of w.pts) {
        x0 = Math.min(x0, x); z0 = Math.min(z0, z);
        x1 = Math.max(x1, x); z1 = Math.max(z1, z);
      }
      waterGrid.add({ pts: w.pts, holes: w.holes ?? [] }, x0, z0, x1, z1);
      // Banks: the outline and the shores of islands.
      for (const r of [w.pts, ...(w.holes ?? [])]) for (let i = 0; i < r.length; i++) {
        const p = r[i];
        const q = r[(i + 1) % r.length];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const n = Math.max(1, Math.ceil(len / SPLIT));
        for (let k = 0; k < n; k++) {
          const t0 = k / n;
          const t1 = (k + 1) / n;
          const sx = p[0] + (q[0] - p[0]) * t0, sz = p[1] + (q[1] - p[1]) * t0;
          const ex = p[0] + (q[0] - p[0]) * t1, ez = p[1] + (q[1] - p[1]) * t1;
          if (onRoad((sx + ex) / 2, (sz + ez) / 2)) continue;
          addWall(sx, sz, ex, ez);
        }
      }
    }
    const inWater = (x: number, z: number): boolean =>
      waterGrid.at(x, z).some((w) => pointInRing(x, z, w.pts) && !w.holes.some((h) => pointInRing(x, z, h)));

    // Railings: along whole bridges and raised flyover ramps, and along any other road where it is
    // over water. They only block at deck height, so roads underneath stay open.
    for (const road of map.roads) {
      const hw = road.width / 2 + RAILING;
      const lifted = !!road.lift;
      for (let i = 1; i < road.pts.length; i++) {
        const [x0, z0] = road.pts[i - 1];
        const [x1, z1] = road.pts[i];
        const len = Math.hypot(x1 - x0, z1 - z0);
        if (len < 0.01) continue;
        const nx = (-(z1 - z0) / len) * hw;
        const nz = ((x1 - x0) / len) * hw;
        const n = Math.max(1, Math.ceil(len / SPLIT));
        for (let k = 0; k < n; k++) {
          const sx = x0 + ((x1 - x0) * k) / n, sz = z0 + ((z1 - z0) * k) / n;
          const ex = x0 + ((x1 - x0) * (k + 1)) / n, ez = z0 + ((z1 - z0) * (k + 1)) / n;
          const mx = (sx + ex) / 2, mz = (sz + ez) / 2;
          const deck = this.heightAt(mx, mz, 1e9);
          const raised = lifted && deck - groundY(mx, mz) > 1.0;
          if (!road.bridge && !raised && !inWater(mx + nx, mz + nz) && !inWater(mx - nx, mz - nz)) continue;
          addWall(sx + nx, sz + nz, ex + nx, ez + nz, deck - 0.8, deck + 2.5);
          addWall(sx - nx, sz - nz, ex - nx, ez - nz, deck - 0.8, deck + 2.5);
        }
      }
    }

    // Flyover piers stand from the ground to the deck.
    for (const [x, z, h, top] of flyoverPiers(map)) {
      const ux = Math.sin(h), uz = Math.cos(h);
      const nx = -uz, nz = ux;
      const g = groundY(x, z);
      const c: Pt[] = [
        [x - ux * 0.8 - nx * 1.2, z - uz * 0.8 - nz * 1.2],
        [x + ux * 0.8 - nx * 1.2, z + uz * 0.8 - nz * 1.2],
        [x + ux * 0.8 + nx * 1.2, z + uz * 0.8 + nz * 1.2],
        [x - ux * 0.8 + nx * 1.2, z - uz * 0.8 + nz * 1.2],
      ];
      for (let k = 0; k < 4; k++) addWall(c[k][0], c[k][1], c[(k + 1) % 4][0], c[(k + 1) % 4][1], g - 2, top);
    }

    this.ax = Float64Array.from(ax);
    this.ylo = Float64Array.from(ylo);
    this.yhi = Float64Array.from(yhi);
    this.kerb = Uint8Array.from(kerb);
    this.top = Float32Array.from(top);
    this.az = Float64Array.from(az);
    this.bx = Float64Array.from(bx);
    this.bz = Float64Array.from(bz);
    this.wallCount = ax.length;
    this.stamp = new Uint32Array(this.wallCount);
    for (let e = 0; e < this.wallCount; e++) {
      const i0 = Math.floor(Math.min(ax[e], bx[e]) / CELL), i1 = Math.floor(Math.max(ax[e], bx[e]) / CELL);
      const j0 = Math.floor(Math.min(az[e], bz[e]) / CELL), j1 = Math.floor(Math.max(az[e], bz[e]) / CELL);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const k = key(i, j);
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, (list = []));
          list.push(e);
        }
      }
    }
  }

  /**
   * Push a circle at (x, z) with radius r out of every wall it overlaps, and keep
   * it inside the map bounds. The returned object is reused between calls.
   */
  collide(x: number, z: number, r: number, y?: number, veh?: VehicleHit, clear = 0): CollideResult {
    let hit = false;
    const r2 = r * r;
    // Kerbs only stop vehicles going slowly; people and fast vehicles go over them.
    const kerbs = !!veh && veh.speed < KERB_MOUNT;
    this.out.broke.length = 0;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const q = ++this.query;
      const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL);
      const j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const list = this.cells.get(key(i, j));
          if (!list) continue;
          for (const e of list) {
            if (this.stamp[e] === q) continue;
            this.stamp[e] = q;
            if (y !== undefined && (y < this.ylo[e] || y > this.yhi[e])) continue;
            if (this.kerb[e] && !kerbs) continue;
            if (clear > 0 && clear >= this.top[e]) continue; // jumped over it
            const ax = this.ax[e], az = this.az[e];
            const dx = this.bx[e] - ax, dz = this.bz[e] - az;
            const l2 = dx * dx + dz * dz;
            let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const cx = ax + t * dx, cz = az + t * dz;
            const ox = x - cx, oz = z - cz;
            const d2 = ox * ox + oz * oz;
            if (d2 >= r2) continue;
            hit = true;
            moved = true;
            if (d2 > 1e-10) {
              const d = Math.sqrt(d2);
              x = cx + (ox / d) * r;
              z = cz + (oz / d) * r;
            } else {
              const l = Math.sqrt(l2) || 1;
              x = cx + (-dz / l) * r;
              z = cz + (dx / l) * r;
            }
          }
        }
      }
      // Breakable pieces: hard hits go through (and break them), soft ones push back.
      const fast = !!veh && veh.speed >= (veh.heavy ? BREAK_SPEED_HEAVY : BREAK_SPEED);
      const i0b = Math.floor((x - r) / CELL), i1b = Math.floor((x + r) / CELL);
      const j0b = Math.floor((z - r) / CELL), j1b = Math.floor((z + r) / CELL);
      for (let i = i0b; i <= i1b; i++) {
        for (let j = j0b; j <= j1b; j++) {
          for (const id of this.bcells.get(key(i, j)) ?? []) {
            if (this.broken[id]) continue;
            const b = this.breakables[id];
            if (y !== undefined && (y < b.y - 1 || y > b.y + 2.5)) continue;
            if (clear > 0 && clear >= BREAK_TOP[b.kind]) continue; // jumped over it
            const ux = Math.sin(b.a) * (b.len / 2), uz = Math.cos(b.a) * (b.len / 2);
            const ax = b.x - ux, az = b.z - uz;
            const dx = ux * 2, dz = uz * 2;
            const l2 = dx * dx + dz * dz;
            let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const cx = ax + t * dx, cz = az + t * dz;
            const ox = x - cx, oz = z - cz;
            const reach = r + (b.kind === 'cone' ? 0.3 : 0.15);
            const d2 = ox * ox + oz * oz;
            if (d2 >= reach * reach) continue;
            if (fast) {
              if (!this.out.broke.includes(id)) this.out.broke.push(id);
              continue;
            }
            hit = true;
            moved = true;
            const d = Math.sqrt(d2) || 1;
            x = cx + (ox / d) * reach;
            z = cz + (oz / d) * reach;
          }
        }
      }
      if (!moved) break;
    }
    const B = this.bounds;
    if (x < B.minX + r) { x = B.minX + r; hit = true; }
    if (x > B.maxX - r) { x = B.maxX - r; hit = true; }
    if (z < B.minZ + r) { z = B.minZ + r; hit = true; }
    if (z > B.maxZ - r) { z = B.maxZ - r; hit = true; }
    this.out.x = x;
    this.out.z = z;
    this.out.hit = hit;
    return this.out;
  }

  /** Break pieces (locally or from a friend); `leftMs` until they are fixed. True for each newly broken. */
  breakPieces(ids: readonly number[], leftMs = FIX_MS, now = performance.now()): number[] {
    const fresh: number[] = [];
    for (const id of ids) {
      if (id < 0 || id >= this.broken.length) continue;
      const at = now + Math.max(0, Math.min(FIX_MS, leftMs));
      if (!this.broken[id]) {
        this.broken[id] = 1;
        this.brokenNow.add(id);
        fresh.push(id);
        this.changed.push(id);
      }
      this.fixAt[id] = Math.max(this.fixAt[id], at);
    }
    return fresh;
  }

  /** Broken pieces and how long until each is fixed (for someone who joins). */
  openBreaks(now = performance.now()): [number, number][] {
    const out: [number, number][] = [];
    for (const id of this.brokenNow) out.push([id, Math.max(0, Math.round(this.fixAt[id] - now))]);
    return out;
  }

  /** Fix pieces whose time is up. */
  updateBreaks(now = performance.now()): void {
    for (const id of this.brokenNow) {
      if (now >= this.fixAt[id]) {
        this.broken[id] = 0;
        this.brokenNow.delete(id);
        this.changed.push(id);
      }
    }
  }

  /** Pieces that broke or were fixed since the last call. */
  drainChanges(): number[] {
    const c = this.changed;
    this.changed = [];
    return c;
  }

  /** Barricades and cones near a point that are standing (traffic steers round them). */
  standingItems(x: number, z: number, r: number): BreakItem[] {
    const out: BreakItem[] = [];
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        for (const id of this.bcells.get(key(i, j)) ?? []) {
          const b = this.breakables[id];
          if (!this.broken[id] && (b.kind === 'barrier' || b.kind === 'cone') && Math.hypot(b.x - x, b.z - z) < r && !out.includes(b)) out.push(b);
        }
      }
    }
    return out;
  }

  /**
   * Surface height at a point: the ground (terrain) or a deck (bridge, flyover, ramp). With
   * `near` (the caller's current height) it is the highest surface no more than 1.5 m above it,
   * so a car under a flyover stays under it and one on the flyover stays on it. Without it, the top one.
   */
  heightAt(x: number, z: number, near = 1e9): number {
    let y = groundY(x, z);
    // Raised surfaces on the ground (Phase R.3/R.5): footpaths, islands, speed breakers, embankments.
    let lift = 0;
    for (const r of this.raised.at(x, z)) {
      if (r.ring) {
        if (pointInRing(x, z, r.ring)) lift = Math.max(lift, r.h);
        continue;
      }
      const d = segDist(x, z, { ax: r.ax, az: r.az, bx: r.bx, bz: r.bz });
      if (d >= r.hw) continue;
      lift = Math.max(lift, r.bump ? r.h * Math.cos((d / r.hw) * (Math.PI / 2)) : r.h);
    }
    if (lift > 0 && near < y + lift + 3) y += lift;
    for (const s of this.decks.at(x, z)) {
      if (segDist(x, z, s) >= s.hw) continue;
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2)) : 0;
      const d = s.y + ((s.yb ?? s.y) - s.y) * t;
      if (d > y && d <= near + 1.5) y = d;
    }
    return y;
  }
}
