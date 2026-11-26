import type { Pt } from './types';

// Ground heights (task K.5): a 20 m grid from the Copernicus DEM, in metres relative to Raj
// Vihar, loaded from public/map/terrain.bin (see docs/ARCHITECTURE.md). Every mesh builder and
// the collision world read the ground through groundY(); setTerrain() is called once after the
// map loads, before anything is built.

export interface TerrainMeta {
  file: string;
  x0: number;
  z0: number;
  cell: number;
  w: number;
  h: number;
  ref: number; // metres above sea level of height 0
}

export class Terrain {
  constructor(
    readonly meta: TerrainMeta,
    private readonly data: Int16Array,
  ) {
    if (data.length !== meta.w * meta.h) throw new Error(`terrain grid has ${data.length} values, expected ${meta.w} x ${meta.h}`);
  }

  /** Grid value (metres) at vertex (i, j), clamped to the grid. */
  at(i: number, j: number): number {
    const m = this.meta;
    const ii = i < 0 ? 0 : i >= m.w ? m.w - 1 : i;
    const jj = j < 0 ? 0 : j >= m.h ? m.h - 1 : j;
    return this.data[jj * m.w + ii] / 10;
  }

  /** Ground height at a point, bilinear between grid vertices (clamped at the edges). */
  height(x: number, z: number): number {
    const m = this.meta;
    const u = (x - m.x0) / m.cell;
    const v = (z - m.z0) / m.cell;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fx = u - i;
    const fz = v - j;
    const a = this.at(i, j), b = this.at(i + 1, j), c = this.at(i, j + 1), d = this.at(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }
}

let current: Terrain | null = null;

export function setTerrain(t: Terrain): void {
  current = t;
}

/** Ground height at a point. Throws if the terrain was never loaded (no silent flat world). */
export function groundY(x: number, z: number): number {
  if (!current) throw new Error('Terrain not loaded: call setTerrain() after loading the map');
  return current.height(x, z);
}

export function terrain(): Terrain {
  if (!current) throw new Error('Terrain not loaded: call setTerrain() after loading the map');
  return current;
}

/** Lowest ground height under a ring's corners and middle (where a building's floor goes). */
export function lowestGround(ring: Pt[]): number {
  let lo = Infinity;
  let cx = 0;
  let cz = 0;
  for (const [x, z] of ring) {
    lo = Math.min(lo, groundY(x, z));
    cx += x;
    cz += z;
  }
  return Math.min(lo, groundY(cx / ring.length, cz / ring.length));
}

/** A polyline with extra points so no piece is longer than `step` metres (to follow the ground). */
export function densify(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2) return pts.slice();
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
