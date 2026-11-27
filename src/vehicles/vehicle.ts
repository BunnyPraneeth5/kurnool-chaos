import type * as THREE from 'three';
import type { CollisionWorld } from '../map/collision';
import type { MoveInput } from '../player/input';
import { VEHICLES, type VehicleParams, type VehicleType } from './params';
import { buildVehicleMesh } from './models';
import { overlap, type Bumper } from './hull';

// Arcade driving model ported from the demo's updPlayer() car branch.
// Runs in fixed 1/120 s sub-steps so fast vehicles never pass through walls.

const SUBSTEP = 1 / 120;
const HARD_HIT = 9; // m/s; faster wall hits lose half their speed
const HARD_BUMP = 10; // m/s; faster vehicle hits are crashes
const RIDE_Y = 0.12; // wheels sit on the road layers

export type VehicleKind = 'parked' | 'player';

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
function angDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Vehicle implements Bumper {
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
  /** Seconds of boost left (Chor–Police, task H.11): faster and quicker off the line. */
  boostT = 0;
  /** The vehicle hit hard during the last drive() call, if any. */
  bumped: Bumper | null = null;
  private roll = 0;
  private wasHit = false;
  private acc = 0;

  constructor(
    readonly type: VehicleType,
    colour: number,
    x: number,
    z: number,
    heading: number,
  ) {
    this.t = VEHICLES[type];
    this.mesh = buildVehicleMesh(type, colour);
    this.x = x;
    this.z = z;
    this.a = heading;
    this.va = heading;
    this.mesh.rotation.order = 'YXZ'; // heading, then nose up/down on slopes, then body roll
    this.sync();
  }

  get camDist(): number {
    return this.t.camDist;
  }

  get camHeight(): number {
    return this.t.camHeight;
  }

  /** Sit on the ground (or bridge deck) and tilt with the slope. */
  settle(world: CollisionWorld, blend = 1): void {
    // The surface nearest the vehicle's height: stays under a flyover or on it.
    const ground = world.heightAt(this.x, this.z, this.y) + RIDE_Y;
    this.y += (ground - this.y) * blend;
    const reach = this.t.len * 0.3; // from the centre to where the wheels touch
    const fx = Math.sin(this.a) * reach, fz = Math.cos(this.a) * reach;
    const target = Math.atan2(world.heightAt(this.x + fx, this.z + fz, this.y) - world.heightAt(this.x - fx, this.z - fz, this.y), reach * 2);
    this.pitch += (target - this.pitch) * blend;
  }

  /**
   * Drive for one frame. Returns the strength of any hard crash this frame
   * (0 if none) so the camera can shake.
   */
  drive(dt: number, inp: MoveInput, world: CollisionWorld, others: readonly Bumper[]): number {
    let crash = 0;
    this.bumped = null;
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
    const boost = this.boostT > 0;
    if (boost) this.boostT -= h;
    const top = boost ? t.top * 1.35 : t.top;
    const acc = boost ? t.acc * 1.8 : t.acc;
    if (thr > 0) this.speed += (this.speed < 0 ? 32 : acc * (1 - clamp(this.speed / top, 0, 1))) * thr * h;
    else if (thr < 0) {
      this.speed += (this.speed > 0 ? 34 : 10) * thr * h;
      if (this.speed < -11) this.speed = -11;
    }
    this.speed -= this.speed * 0.04 * h;
    if (thr === 0) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 2.5 * h);
    if (hand) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 13 * h);
    const sf = clamp(Math.abs(this.speed) / 7, 0, 1) * (1 - 0.5 * clamp(Math.abs(this.speed) / top, 0, 1));
    this.a -= steer * (hand ? t.turn * 1.35 : t.turn) * sf * (this.speed < 0 ? -1 : 1) * h;
    this.va += angDiff(this.a, this.va) * Math.min(1, (hand ? 1.6 : t.grip) * h);
    this.x += Math.sin(this.va) * this.speed * h;
    this.z += Math.cos(this.va) * this.speed * h;

    // Walls: push the collision circles out.
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

    // Other vehicles: parked ones and friends' do not move; traffic and cops give way by weight.
    for (const o of others) {
      if (o === this) continue;
      const push = overlap(this, o);
      if (!push) continue;
      let mine = 1;
      if (o.shove) {
        const other = VEHICLES[o.type].mass;
        mine = other / (other + t.mass);
        o.shove(-push.x * (1 - mine), -push.z * (1 - mine));
      }
      this.x += push.x * mine;
      this.z += push.z * mine;
      if (Math.abs(this.speed) > HARD_BUMP) {
        this.speed *= 0.45;
        crash = Math.max(crash, 0.55);
        this.bumped = o;
      } else {
        this.speed -= this.speed * 3 * h;
      }
      this.va = this.a;
    }

    this.roll += (steer * sf * t.roll - this.roll) * Math.min(1, t.rollRate * h);
    return crash;
  }

  /** Push every collision circle out of walls; true if anything was hit. */
  pushOut(world: CollisionWorld): boolean {
    const t = this.t;
    let hit = false;
    for (const off of t.circles) {
      const fx = Math.sin(this.a) * off;
      const fz = Math.cos(this.a) * off;
      const r = world.collide(this.x + fx, this.z + fz, t.radius, this.y);
      hit = hit || r.hit;
      this.x = r.x - fx;
      this.z = r.z - fz;
    }
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
    this.mesh.rotation.x = -this.pitch; // the nose points along +z, so nose up is a negative x turn
    this.mesh.rotation.z = this.roll;
  }
}
