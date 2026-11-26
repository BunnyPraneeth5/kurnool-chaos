import type { Building, Pt } from './types';

// Kurnool building styles (task K.2), chosen per building by scripts/osm/build.mjs from
// OSM land use, shops, places of worship and building density. Keep the ids in sync
// with STYLE in build.mjs.
export const STYLE = {
  plain: 0, // ordinary town house
  old: 1, // dense old city (Peta, Budhwarpet, around the fort): 2-3 floors, small windows
  colony: 2, // colony house with a compound wall
  market: 3, // shop fronts: shutters and signboards on the ground floor
  campus: 4, // schools, colleges, hospitals, offices
  outskirts: 5, // village and edge-of-town houses, some with sloped sheet roofs
  industrial: 6, // sheds and godowns
} as const;
export type StyleId = (typeof STYLE)[keyof typeof STYLE];

// Compound walls around colony houses: a rectangle around the house, this far out,
// with a gate gap on one side (side index stored per building by the build).
export const WALL_GAP = 1.8; // m from the house to the wall
export const WALL_H = 1.5; // m
export const GATE_W = 3; // m

/** Oriented box around a ring, aligned to its longest edge: corners c0..c3 (counter-clockwise in x,z). */
export function orientedBox(ring: Pt[], pad: number): Pt[] {
  let best = 0;
  let ux = 1;
  let uz = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > best) {
      best = L;
      ux = (b[0] - a[0]) / L;
      uz = (b[1] - a[1]) / L;
    }
  }
  const nx = -uz;
  const nz = ux;
  let u0 = Infinity, u1 = -Infinity, n0 = Infinity, n1 = -Infinity;
  for (const [x, z] of ring) {
    const u = x * ux + z * uz;
    const n = x * nx + z * nz;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u);
    n0 = Math.min(n0, n); n1 = Math.max(n1, n);
  }
  u0 -= pad; u1 += pad; n0 -= pad; n1 += pad;
  const at = (u: number, n: number): Pt => [u * ux + n * nx, u * uz + n * nz];
  return [at(u0, n0), at(u1, n0), at(u1, n1), at(u0, n1)];
}

/** The compound wall of a building as open polylines (the gate splits one side), or null. */
export function compoundWall(b: Building): Pt[][] | null {
  if (b.gate === undefined) return null;
  const c = orientedBox(b.pts, WALL_GAP);
  const g = b.gate & 3;
  const a = c[g];
  const e = c[(g + 1) % 4];
  const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
  const t0 = Math.max(0, (L - GATE_W) / 2 / L);
  const t1 = 1 - t0;
  const lerp = (t: number): Pt => [a[0] + (e[0] - a[0]) * t, a[1] + (e[1] - a[1]) * t];
  // From the gate's far post all the way round to its near post, then the short piece.
  const around: Pt[] = [lerp(t1), e, c[(g + 2) % 4], c[(g + 3) % 4], a, lerp(t0)];
  return [around];
}
