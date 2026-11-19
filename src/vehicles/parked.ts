import type { CollisionWorld } from '../map/collision';
import type { RoadIndex } from '../map/roadIndex';
import { Vehicle } from './vehicle';
import { CAR_COLOURS } from './params';

// Parked cars near the start point (PRD: parked vehicles near the start), on the
// left edge of nearby roads (India drives on the left), facing along the road.
// Placement is deterministic, so every player sees the same spots.

const COUNT = 8;
const SEARCH_RADIUS = 150;
const SPACING = 7; // m between parked cars
const KEEP_CLEAR = 12; // m around the spawn point and road ends (junctions)

export function spawnParkedCars(spawnX: number, spawnZ: number, roads: RoadIndex, world: CollisionWorld): Vehicle[] {
  type Spot = { x: number; z: number; a: number; d: number };
  const spots: Spot[] = [];
  for (const s of roads.segs) {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
    if (len < KEEP_CLEAR * 2 + 4 || s.hw < 3) continue;
    const mx = (s.ax + s.bx) / 2;
    const mz = (s.az + s.bz) / 2;
    if (Math.hypot(mx - spawnX, mz - spawnZ) > SEARCH_RADIUS + len / 2) continue;
    const ux = (s.bx - s.ax) / len;
    const uz = (s.bz - s.az) / len;
    // Left of travel direction for forward = (ux, uz) is (uz, -ux).
    const off = s.hw - 1.2;
    for (let along = KEEP_CLEAR; along <= len - KEEP_CLEAR; along += SPACING) {
      const x = s.ax + ux * along + uz * off;
      const z = s.az + uz * along - ux * off;
      const d = Math.hypot(x - spawnX, z - spawnZ);
      if (d < KEEP_CLEAR || d > SEARCH_RADIUS) continue;
      spots.push({ x, z, a: Math.atan2(ux, uz), d });
    }
  }
  spots.sort((p, q) => p.d - q.d || p.x - q.x);

  const cars: Vehicle[] = [];
  for (const sp of spots) {
    if (cars.length >= COUNT) break;
    if (cars.some((c) => Math.hypot(c.x - sp.x, c.z - sp.z) < SPACING)) continue;
    const car = new Vehicle('car', CAR_COLOURS[cars.length % CAR_COLOURS.length], sp.x, sp.z, sp.a);
    // Skip spots where the car would touch a wall.
    const bx = car.x, bz = car.z;
    if (car.pushOut(world) || Math.hypot(car.x - bx, car.z - bz) > 0.01) continue;
    car.sync();
    cars.push(car);
  }
  return cars;
}
