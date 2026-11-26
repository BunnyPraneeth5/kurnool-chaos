import type * as THREE from 'three';
import type { CollisionWorld } from '../map/collision';
import type { MoveInput } from '../player/input';
import { VEHICLES, type VehicleParams, type VehicleType } from './params';
import { buildCarMesh } from './carModel';

// Arcade driving model ported from the demo's updPlayer() car branch.
// Runs in fixed 1/120 s sub-steps so fast cars never pass through walls.

const SUBSTEP = 1 / 120;
const BUMP = 3.0; // centre distance at which two vehicles touch
const HARD_HIT = 9; // m/s; faster wall hits lose half their speed
const RIDE_Y = 0.12; // wheels sit on the road layers
const PITCH_REACH = 1.3; // m from the centre to where the front and back wheels touch

export type VehicleKind = 'parked' | 'player';

/** Anything a car bounces off: parked cars, friends' cars. */
export interface Bumper {
  x: number;
  z: number;
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
function angDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Vehicle {
  readonly t: VehicleParams;
  readonly mesh: THREE.Object3D;
  kind: VehicleKind = 'parked';
  x: number;
  z: number;
  y = RIDE_Y;
  pitch = 0; // radians, nose up positive
  /** nose heading */
  a: number;
  /** travel direction (lags behind the nose when drifting) */
  va: number;
  speed = 0;
  private roll = 0;
  private wasHit = false;
  private acc = 0;

  constructor(type: VehicleType, colour: number, x: number, z: number, heading: number) {
    this.t = VEHICLES[type];
    this.mesh = buildCarMesh(this.t, colour);
    this.x = x;
    this.z = z;
    this.a = heading;
    this.va = heading;
    this.mesh.rotation.order = 'YXZ'; // heading, then nose up/down on slopes, then body roll
    this.sync();
  }

  /** Sit on the ground (or bridge deck) and tilt with the slope. */
  settle(world: CollisionWorld, blend = 1): void {
    // The surface nearest the car's height: stays under a flyover or on it.
    const ground = world.heightAt(this.x, this.z, this.y) + RIDE_Y;
    this.y += (ground - this.y) * blend;
    const fx = Math.sin(this.a) * PITCH_REACH, fz = Math.cos(this.a) * PITCH_REACH;
    const target = Math.atan2(world.heightAt(this.x + fx, this.z + fz, this.y) - world.heightAt(this.x - fx, this.z - fz, this.y), PITCH_REACH * 2);
    this.pitch += (target - this.pitch) * blend;
  }

  /**
   * Drive for one frame. Returns the strength of any hard crash this frame
   * (0 if none) so the camera can shake.
   */
  drive(dt: number, inp: MoveInput, world: CollisionWorld, others: readonly Bumper[]): number {
    let crash = 0;
    this.acc += dt;
    while (this.acc >= SUBSTEP) {
      this.acc -= SUBSTEP;
      crash = Math.max(crash, this.step(SUBSTEP, inp, world, others));
    }
    this.settle(world, Math.min(1, dt * 10));
    this.sync();
    return crash;
  }

  private step(h: number, inp: MoveInput, world: CollisionWorld, others: readonly Bumper[]): number {
    const t = this.t;
    const { thr, steer, hand } = inp;
    let crash = 0;
    if (thr > 0) this.speed += (this.speed < 0 ? 32 : t.acc * (1 - clamp(this.speed / t.top, 0, 1))) * thr * h;
    else if (thr < 0) {
      this.speed += (this.speed > 0 ? 34 : 10) * thr * h;
      if (this.speed < -11) this.speed = -11;
    }
    this.speed -= this.speed * 0.04 * h;
    if (thr === 0) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 2.5 * h);
    if (hand) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 13 * h);
    const sf = clamp(Math.abs(this.speed) / 7, 0, 1) * (1 - 0.5 * clamp(Math.abs(this.speed) / t.top, 0, 1));
    this.a -= steer * (hand ? 3.1 : t.turn) * sf * (this.speed < 0 ? -1 : 1) * h;
    this.va += angDiff(this.a, this.va) * Math.min(1, (hand ? 1.6 : t.grip) * h);
    this.x += Math.sin(this.va) * this.speed * h;
    this.z += Math.cos(this.va) * this.speed * h;

    // Walls: push the front and back circles out.
    const hit = this.pushOut(world);
    if (hit) {
      if (!this.wasHit && Math.abs(this.speed) > HARD_HIT) {
        this.speed *= 0.45;
        crash = 0.5;
      } else {
        this.speed -= this.speed * 2.2 * h;
      }
      this.va = this.a;
    }
    this.wasHit = hit;

    // Other vehicles: parked ones and friends' cars do not move, we bounce off.
    for (const o of others) {
      if (o === this) continue;
      const dx = this.x - o.x;
      const dz = this.z - o.z;
      const d = Math.hypot(dx, dz);
      if (d >= BUMP || d < 1e-3) continue;
      const pen = BUMP - d;
      this.x += (dx / d) * pen;
      this.z += (dz / d) * pen;
      if (Math.abs(this.speed) > 10) {
        this.speed *= 0.45;
        crash = Math.max(crash, 0.55);
      } else {
        this.speed -= this.speed * 3 * h;
      }
      this.va = this.a;
    }

    this.roll += (-steer * sf * 0.07 - this.roll) * Math.min(1, 8 * h);
    return crash;
  }

  /** Push both collision circles out of walls; true if anything was hit. */
  pushOut(world: CollisionWorld): boolean {
    const t = this.t;
    const fx = Math.sin(this.a) * t.axle;
    const fz = Math.cos(this.a) * t.axle;
    let r = world.collide(this.x + fx, this.z + fz, t.radius, this.y);
    let hit = r.hit;
    this.x = r.x - fx;
    this.z = r.z - fz;
    r = world.collide(this.x - fx, this.z - fz, t.radius, this.y);
    hit = hit || r.hit;
    this.x = r.x + fx;
    this.z = r.z + fz;
    return hit;
  }

  /** Stop and settle (used when the player gets out). */
  park(): void {
    this.kind = 'parked';
    this.speed = 0;
    this.roll = 0;
    this.va = this.a;
    this.sync();
  }

  sync(): void {
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = this.a;
    this.mesh.rotation.x = -this.pitch; // the car's nose points along +z, so nose up is a negative x turn
    this.mesh.rotation.z = this.roll;
  }
}
