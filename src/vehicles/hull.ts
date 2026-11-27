import { VEHICLES, type VehicleType } from './params';

// A vehicle's outline for collisions: circles along its body (see params.ts).

/** Anything a vehicle bounces off: parked vehicles, traffic, cops, friends' vehicles. */
export interface Bumper {
  x: number;
  z: number;
  /** heading, forward = (sin a, cos a) */
  a: number;
  type: VehicleType;
  /** A friend's vehicle: the driver's player id (you can ride along). */
  id?: string;
  /** Local traffic and cops give way when hit; without this the vehicle does not move. */
  shove?(dx: number, dz: number): void;
}

/** The smallest move of `a` that takes it clear of `b` (deepest pair of circles), or null if apart. */
export function overlap(a: Bumper, b: Bumper): { x: number; z: number } | null {
  const ta = VEHICLES[a.type];
  const tb = VEHICLES[b.type];
  // Quick reject for far apart vehicles.
  const reach = (ta.len + tb.len) / 2 + 2;
  if (Math.abs(a.x - b.x) > reach || Math.abs(a.z - b.z) > reach) return null;
  const asx = Math.sin(a.a), acz = Math.cos(a.a);
  const bsx = Math.sin(b.a), bcz = Math.cos(b.a);
  const touch = ta.radius + tb.radius;
  let best: { x: number; z: number } | null = null;
  let deepest = 0;
  for (const i of ta.circles) {
    for (const j of tb.circles) {
      const dx = a.x + asx * i - (b.x + bsx * j);
      const dz = a.z + acz * i - (b.z + bcz * j);
      const d = Math.hypot(dx, dz);
      const pen = touch - d;
      if (pen <= deepest || d < 1e-3) continue;
      deepest = pen;
      best = { x: (dx / d) * pen, z: (dz / d) * pen };
    }
  }
  return best;
}

/** Distance from a point to the vehicle's outline (negative inside), and the circle it is nearest. */
export function hullDistance(v: Bumper, x: number, z: number): { d: number; cx: number; cz: number } {
  const t = VEHICLES[v.type];
  const sx = Math.sin(v.a), cz = Math.cos(v.a);
  let best = { d: Infinity, cx: v.x, cz: v.z };
  for (const i of t.circles) {
    const px = v.x + sx * i;
    const pz = v.z + cz * i;
    const d = Math.hypot(x - px, z - pz) - t.radius;
    if (d < best.d) best = { d, cx: px, cz: pz };
  }
  return best;
}
