import type { MapData, Pt } from './types';
import { roadY } from './roads';
import { pointInRing } from '../util/rng';
import { compoundWall } from './buildingStyle';
import { propWalls } from './props';
import { railWalls } from './rail';

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
}

interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  hw: number;
  y: number;
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
  private readonly cells = new Map<number, number[]>();
  private readonly stamp: Uint32Array;
  private query = 0;
  private readonly decks = new ItemGrid<Seg>(CELL);
  private readonly bounds: MapData['bounds'];
  readonly wallCount: number;
  private readonly out: CollideResult = { x: 0, z: 0, hit: false };

  constructor(map: MapData) {
    this.bounds = map.bounds;
    const ax: number[] = [];
    const az: number[] = [];
    const bx: number[] = [];
    const bz: number[] = [];
    const addWall = (x0: number, z0: number, x1: number, z1: number): void => {
      ax.push(x0);
      az.push(z0);
      bx.push(x1);
      bz.push(z1);
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
    for (const line of [...propWalls(map), ...railWalls(map)]) for (let i = 1; i < line.length; i++) addWall(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);

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
        if (road.bridge) this.decks.add(s, Math.min(x0, x1) - hw, Math.min(z0, z1) - hw, Math.max(x0, x1) + hw, Math.max(z0, z1) + hw);
      }
    }
    const onRoad = (x: number, z: number): boolean => roadSegs.at(x, z).some((s) => segDist(x, z, s) < s.hw + ROAD_GAP);

    // Water banks, minus gaps where roads cross.
    const waterGrid = new ItemGrid<Pt[]>(64);
    for (const w of map.water) {
      const r = w.pts;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of r) {
        x0 = Math.min(x0, x); z0 = Math.min(z0, z);
        x1 = Math.max(x1, x); z1 = Math.max(z1, z);
      }
      waterGrid.add(r, x0, z0, x1, z1);
      for (let i = 0; i < r.length; i++) {
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
    const inWater = (x: number, z: number): boolean => waterGrid.at(x, z).some((r) => pointInRing(x, z, r));

    // Railings: along whole bridges, and along any other road where it is over water.
    for (const road of map.roads) {
      const hw = road.width / 2 + RAILING;
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
          if (!road.bridge && !inWater(mx + nx, mz + nz) && !inWater(mx - nx, mz - nz)) continue;
          addWall(sx + nx, sz + nz, ex + nx, ez + nz);
          addWall(sx - nx, sz - nz, ex - nx, ez - nz);
        }
      }
    }

    this.ax = Float64Array.from(ax);
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
  collide(x: number, z: number, r: number): CollideResult {
    let hit = false;
    const r2 = r * r;
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

  /** Surface height at a point: the deck height on bridges, otherwise the ground (0). */
  heightAt(x: number, z: number): number {
    let y = 0;
    for (const s of this.decks.at(x, z)) if (segDist(x, z, s) < s.hw) y = Math.max(y, s.y);
    return y;
  }
}
