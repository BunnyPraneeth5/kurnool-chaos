import type { MapData } from '../map/types';
import type { RoadIndex } from '../map/roadIndex';

// Players in a room start spread out on a ring of road points around Raj Vihar
// (ARCHITECTURE: Player), one point per slot, facing back towards the circle.

const RING_M = 45;
const MIN_GAP_M = 10;

export function spawnPoint(map: MapData, roads: RoadIndex, slot: number): { x: number; z: number; heading: number } {
  const { x: cx, z: cz, heading } = map.spawn;
  const taken: { x: number; z: number }[] = [];
  let pick = { x: cx, z: cz, heading };
  // Walk slots 0..slot so each one avoids the points of the slots before it.
  for (let s = 0; s <= slot; s++) {
    const ang = heading + (s * Math.PI) / 4;
    for (let r = RING_M; r <= RING_M * 3; r += 15) {
      const p = roads.nearest(cx + Math.sin(ang) * r, cz + Math.cos(ang) * r, ang + Math.PI);
      if (!p || taken.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < MIN_GAP_M)) continue;
      pick = { x: p.x, z: p.z, heading: p.heading };
      break;
    }
    taken.push(pick);
  }
  return pick;
}
