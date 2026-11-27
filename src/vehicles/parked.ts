import type { CollisionWorld } from '../map/collision';
import type { RoadIndex } from '../map/roadIndex';
import { Vehicle } from './vehicle';
import { VEHICLES, vehicleColour, type VehicleType } from './params';

// Parked vehicles near the start point (PRD), on the left edge of nearby roads (India
// drives on the left), facing along the road. Placement is deterministic, so every player
// sees the same spots and the same number means the same vehicle on every screen.

// The first 8 are cars: game rounds put player slot k in vehicle k, so everyone gets the
// same kind, and rooms move these 8 to the lobby. The rest stay in the city.
export const LOBBY_CARS = 8;
const LIST: VehicleType[] = [...Array<VehicleType>(LOBBY_CARS).fill('car'), 'auto', 'bike', 'auto', 'bike', 'bus', 'lorry'];
const SEARCH_RADIUS = 220;
const STEP = 7; // m between candidate spots
const GAP = 2.5; // m of clear road between two parked vehicles
const KEEP_CLEAR = 12; // m around the spawn point and road ends (junctions)
const WIDE_HW = 4.5; // buses and lorries only park on roads at least this wide each side

export function spawnParkedVehicles(spawnX: number, spawnZ: number, roads: RoadIndex, world: CollisionWorld): Vehicle[] {
  type Spot = { x: number; z: number; ux: number; uz: number; hw: number; d: number };
  const spots: Spot[] = [];
  for (const s of roads.segs) {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
    if (len < KEEP_CLEAR * 2 + 4 || s.hw < 3) continue;
    const mx = (s.ax + s.bx) / 2;
    const mz = (s.az + s.bz) / 2;
    if (Math.hypot(mx - spawnX, mz - spawnZ) > SEARCH_RADIUS + len / 2) continue;
    const ux = (s.bx - s.ax) / len;
    const uz = (s.bz - s.az) / len;
    for (let along = KEEP_CLEAR; along <= len - KEEP_CLEAR; along += STEP) {
      const x = s.ax + ux * along;
      const z = s.az + uz * along;
      const d = Math.hypot(x - spawnX, z - spawnZ);
      if (d < KEEP_CLEAR || d > SEARCH_RADIUS) continue;
      spots.push({ x, z, ux, uz, hw: s.hw, d });
    }
  }
  spots.sort((p, q) => p.d - q.d || p.x - q.x);

  const out: Vehicle[] = [];
  const counts = new Map<VehicleType, number>();
  for (const type of LIST) {
    const t = VEHICLES[type];
    const n = counts.get(type) ?? 0;
    for (const sp of spots) {
      if (t.len > 6 && sp.hw < WIDE_HW) continue;
      // Left of travel direction for forward = (ux, uz) is (uz, -ux).
      const off = sp.hw - t.w / 2 - 0.25;
      const x = sp.x + sp.uz * off;
      const z = sp.z - sp.ux * off;
      if (out.some((c) => Math.hypot(c.x - x, c.z - z) < (c.t.len + t.len) / 2 + GAP)) continue;
      const v = new Vehicle(type, vehicleColour(type, type === 'car' ? out.length : n), x, z, Math.atan2(sp.ux, sp.uz));
      // Skip spots where it would touch a wall.
      if (v.pushOut(world) || Math.hypot(v.x - x, v.z - z) > 0.01) continue;
      v.settle(world);
      v.sync();
      out.push(v);
      counts.set(type, n + 1);
      break;
    }
  }
  if (out.length < LIST.length) console.warn(`Only ${out.length} of ${LIST.length} parked vehicles fit near the start`);
  return out;
}
