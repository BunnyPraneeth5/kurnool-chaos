import type { MapData } from './types';

// Spatial index of road centreline segments, for "nearest road" questions:
// the unstuck button and placing parked cars.

const CELL = 64;

interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  hw: number;
  road: number;
}

export interface RoadPoint {
  x: number;
  z: number;
  /** heading along the road, forward = (sin, cos) */
  heading: number;
  /** half width of that road */
  hw: number;
  dist: number;
}

const key = (i: number, j: number): number => (i + 2048) * 4096 + (j + 2048);

export class RoadIndex {
  private readonly cells = new Map<number, Seg[]>();
  readonly segs: Seg[] = [];

  constructor(map: MapData) {
    map.roads.forEach((road, ri) => {
      if (road.id === -1) return; // airport link: fine to drive, but not a place to respawn or park
      for (let i = 1; i < road.pts.length; i++) {
        const [ax, az] = road.pts[i - 1];
        const [bx, bz] = road.pts[i];
        if (Math.hypot(bx - ax, bz - az) < 0.01) continue;
        const s: Seg = { ax, az, bx, bz, hw: road.width / 2, road: ri };
        this.segs.push(s);
        for (let x = Math.floor(Math.min(ax, bx) / CELL); x <= Math.floor(Math.max(ax, bx) / CELL); x++) {
          for (let z = Math.floor(Math.min(az, bz) / CELL); z <= Math.floor(Math.max(az, bz) / CELL); z++) {
            const k = key(x, z);
            let list = this.cells.get(k);
            if (!list) this.cells.set(k, (list = []));
            list.push(s);
          }
        }
      }
    });
  }

  /**
   * Nearest point on any road centreline, searching outwards ring by ring.
   * The heading is the road direction closest to `preferHeading`.
   */
  nearest(x: number, z: number, preferHeading = 0, maxDist = 3000): RoadPoint | null {
    const ci = Math.floor(x / CELL);
    const cj = Math.floor(z / CELL);
    let best = null as RoadPoint | null;
    for (let ring = 0; ring * CELL <= maxDist + CELL; ring++) {
      for (let i = ci - ring; i <= ci + ring; i++) {
        for (let j = cj - ring; j <= cj + ring; j++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue;
          for (const s of this.cells.get(key(i, j)) ?? []) {
            const dx = s.bx - s.ax;
            const dz = s.bz - s.az;
            const l2 = dx * dx + dz * dz;
            let t = ((x - s.ax) * dx + (z - s.az) * dz) / l2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const px = s.ax + t * dx;
            const pz = s.az + t * dz;
            const d = Math.hypot(x - px, z - pz);
            if (best && d >= best.dist) continue;
            let h = Math.atan2(dx, dz);
            const diff = Math.abs(((h - preferHeading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
            if (diff > Math.PI / 2) h += Math.PI;
            best = { x: px, z: pz, heading: h, hw: s.hw, dist: d };
          }
        }
      }
      // Anything in a further ring is at least (ring * CELL) away.
      if (best && best.dist <= ring * CELL) break;
    }
    return best;
  }
}
