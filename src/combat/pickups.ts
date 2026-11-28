import * as THREE from 'three';
import type { MapData } from '../map/types';
import type { CollisionWorld } from '../map/collision';
import { makeRng } from '../util/rng';
import { PICKUP_WEAPONS, WEAPONS, type WeaponId } from './weapons';

// Weapon pickups (task M.9, Bunny's proposal): spots round the city on road edges, the same
// on every screen (seeded from the map), each giving one weapon (lathi, shotgun, balloons,
// tomatoes, firecrackers). Walk over one to take it; it comes back after 90 s (on your screen).
// Only the 12 nearest are drawn (6 on low quality): spinning coloured crates.

const COUNT = 60;
const TAKE_M = 1.6;
const BACK_S = 90;
const DRAWN = 12;
const DRAW_M = 160;

export const PICKUP_COLOUR: Record<WeaponId, number> = {
  fists: 0xffffff,
  bat: 0xd9b97a,
  lathi: 0xa77b3f,
  pistol: 0xf2b33d,
  shotgun: 0x2c66c4,
  balloon: 0x4fa8e8,
  tomato: 0xd8342c,
  cracker: 0xe0762c,
};

export interface Pickup {
  x: number;
  z: number;
  y: number;
  weapon: WeaponId;
  /** seconds until it is back (0 = there) */
  gone: number;
}

/** The pickup spots for a map: seeded, so every screen has the same ones. */
export function pickupSpots(map: MapData, world: Pick<CollisionWorld, 'heightAt'>): Pickup[] {
  const rand = makeRng(0x6b75726e); // "kurn"
  const nodes = map.graph.nodes;
  const out: Pickup[] = [];
  if (!nodes.length) return out;
  const pa = map.playArea;
  for (let tries = 0; out.length < COUNT && tries < COUNT * 40; tries++) {
    const [x, z] = nodes[Math.floor(rand() * nodes.length)];
    if (x < pa.minX || x > pa.maxX || z < pa.minZ || z > pa.maxZ) continue;
    if (out.some((p) => Math.hypot(p.x - x, p.z - z) < 180)) continue;
    // A little off the junction so it is not in the traffic's way.
    const ox = (rand() - 0.5) * 6, oz = (rand() - 0.5) * 6;
    out.push({ x: x + ox, z: z + oz, y: world.heightAt(x + ox, z + oz), weapon: PICKUP_WEAPONS[out.length % PICKUP_WEAPONS.length], gone: 0 });
  }
  return out;
}

export class Pickups {
  readonly list: Pickup[];
  private readonly meshes: THREE.Mesh[] = [];
  private t = 0;

  constructor(map: MapData, world: CollisionWorld, scene: THREE.Scene, drawn = DRAWN) {
    this.list = pickupSpots(map, world);
    const geo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    for (let i = 0; i < drawn; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x332200 }));
      m.visible = false;
      scene.add(m);
      this.meshes.push(m);
    }
  }

  /** One frame near (x, z): returns the weapon walked over, if any. */
  update(dt: number, x: number, z: number, y: number, onFoot: boolean): WeaponId | null {
    this.t += dt;
    let took: WeaponId | null = null;
    const near: Pickup[] = [];
    for (const p of this.list) {
      if (p.gone > 0) {
        p.gone = Math.max(0, p.gone - dt);
        continue;
      }
      const d = Math.hypot(p.x - x, p.z - z);
      if (onFoot && !took && d < TAKE_M && Math.abs(p.y - y) < 2) {
        took = p.weapon;
        p.gone = BACK_S;
        continue;
      }
      if (d < DRAW_M) near.push(p);
    }
    near.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    for (let i = 0; i < this.meshes.length; i++) {
      const m = this.meshes[i];
      const p = near[i];
      m.visible = !!p;
      if (!p) continue;
      m.position.set(p.x, p.y + 0.9 + Math.sin(this.t * 2 + i) * 0.15, p.z);
      m.rotation.y = this.t * 1.5 + i;
      (m.material as THREE.MeshLambertMaterial).color.setHex(PICKUP_COLOUR[p.weapon]);
    }
    return took;
  }

  /** Minimap diamonds for pickups that are there. */
  dots(): { x: number; z: number; colour: string }[] {
    return this.list.filter((p) => p.gone <= 0).map((p) => ({ x: p.x, z: p.z, colour: `#${PICKUP_COLOUR[p.weapon].toString(16).padStart(6, '0')}` }));
  }

  /** For the guide. */
  static what(): string {
    return PICKUP_WEAPONS.map((id) => WEAPONS[id].name).join(', ');
  }
}
