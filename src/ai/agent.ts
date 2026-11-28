import type * as THREE from 'three';
import type { CollisionWorld } from '../map/collision';
import { buildVehicleMesh, setRider } from '../vehicles/models';
import { VEHICLES, type VehicleType } from '../vehicles/params';
import type { Bumper } from '../vehicles/hull';
import type { Pt } from '../map/types';

// A computer-driven vehicle (traffic or police). It moves along a polyline on the road, so
// it cannot get caught on walls; a knock from the player pushes it aside for a moment.

const RIDE_Y = 0.12;
const MAX_KNOCK = 2.5; // m
const KNOCK_RETURN = 1.5; // per second

export function angDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Agent implements Bumper {
  readonly mesh: THREE.Object3D;
  /** where it is drawn and collides */
  x: number;
  z: number;
  y: number;
  a: number;
  pitch = 0;
  speed = 0;
  /** where it is on its path, before knocks and swerves */
  px: number;
  pz: number;
  /** points still to drive through */
  path: Pt[] = [];
  /** metres to the right of the path (steering round a parked vehicle) */
  side = 0;
  /** vehicle health (task M.12): 0 = wrecked */
  hp = 100;
  /** seconds since it was wrecked (0 = fine); it stops, burns and can blow up */
  wreck = 0;
  /** blew up already (a burnt-out shell) */
  blown = false;
  private kx = 0;
  private kz = 0;

  constructor(
    readonly type: VehicleType,
    readonly colour: number,
    x: number,
    z: number,
    heading: number,
    y: number,
    shadow: boolean,
  ) {
    this.mesh = buildVehicleMesh(type, colour, shadow);
    setRider(this.mesh, 0x6c7a99);
    this.x = this.px = x;
    this.z = this.pz = z;
    this.a = heading;
    this.y = y;
  }

  shove(dx: number, dz: number): void {
    this.kx += dx;
    this.kz += dz;
    const d = Math.hypot(this.kx, this.kz);
    if (d > MAX_KNOCK) {
      this.kx *= MAX_KNOCK / d;
      this.kz *= MAX_KNOCK / d;
    }
    this.x += dx;
    this.z += dz;
    this.speed *= 0.9;
  }

  /** Metres left along the path. */
  left(): number {
    let d = 0;
    let x = this.px, z = this.pz;
    for (const [px, pz] of this.path) {
      d += Math.hypot(px - x, pz - z);
      x = px;
      z = pz;
    }
    return d;
  }

  /** Drive `dist` metres along the path, calling `more` when it runs short. False at a true dead end. */
  advance(dist: number, more: () => boolean): boolean {
    let left = dist;
    for (let guard = 0; guard < 32 && left > 0; guard++) {
      if (this.path.length === 0 && !more()) return false;
      const [tx, tz] = this.path[0];
      const dx = tx - this.px;
      const dz = tz - this.pz;
      const d = Math.hypot(dx, dz);
      if (d <= left) {
        this.px = tx;
        this.pz = tz;
        this.path.shift();
        left -= d;
      } else {
        this.px += (dx / d) * left;
        this.pz += (dz / d) * left;
        left = 0;
      }
    }
    return true;
  }

  /** Turn towards the path and put the model on the ground. */
  place(dt: number, world: CollisionWorld): void {
    const next = this.path[0];
    if (next && Math.hypot(next[0] - this.px, next[1] - this.pz) > 0.3) {
      const want = Math.atan2(next[0] - this.px, next[1] - this.pz);
      const rate = (2 + this.speed * 0.35) * dt;
      this.a += Math.max(-rate, Math.min(rate, angDiff(want, this.a)));
    }
    const back = Math.min(1, KNOCK_RETURN * dt);
    this.kx -= this.kx * back;
    this.kz -= this.kz * back;
    // Right of forward (sin a, cos a) is (-cos a, sin a).
    this.x = this.px + this.kx - Math.cos(this.a) * this.side;
    this.z = this.pz + this.kz + Math.sin(this.a) * this.side;
    this.settle(world, Math.min(1, dt * 10));
  }

  settle(world: CollisionWorld, blend = 1): void {
    const ground = world.heightAt(this.x, this.z, this.y) + RIDE_Y;
    this.y += (ground - this.y) * blend;
    const reach = VEHICLES[this.type].len * 0.3;
    const fx = Math.sin(this.a) * reach, fz = Math.cos(this.a) * reach;
    const target = Math.atan2(world.heightAt(this.x + fx, this.z + fz, this.y) - world.heightAt(this.x - fx, this.z - fz, this.y), reach * 2);
    this.pitch += (target - this.pitch) * blend;
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = this.a;
    this.mesh.rotation.x = -this.pitch;
  }
}
