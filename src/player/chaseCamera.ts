import * as THREE from 'three';
import type { CollisionWorld } from '../map/collision';

// Third-person chase camera ported from the demo's updCamera(): trails behind the
// player's heading, stays out of buildings, and sits a little further back in portrait.

const FOOT_DIST = 6.2;
const FOOT_HEIGHT = 3.3;
const CAR_DIST = 9.5;
const CAR_HEIGHT = 4.4;

export interface Followable {
  x: number;
  y: number;
  z: number;
  a: number;
  speed: number;
}

function angDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class ChaseCamera {
  private camA = 0;
  private shakeAmt = 0;
  private readonly pos = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly look = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** Jump straight behind the target (on start or after leaving the map view). */
  snap(t: Followable, world: CollisionWorld, inCar = false): void {
    this.camA = t.a;
    this.place(t, world, inCar);
    this.pos.copy(this.target);
    this.apply(t);
  }

  /** Short camera shake after a crash (demo values 0.5 to 0.55). */
  shake(amount: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  update(dt: number, t: Followable, world: CollisionWorld, inCar = false): void {
    this.camA += angDiff(t.a, this.camA) * Math.min(1, dt * (inCar ? 3.4 : 4.5));
    this.place(t, world, inCar);
    this.pos.lerp(this.target, Math.min(1, dt * 6));
    this.apply(t);
    if (this.shakeAmt > 0) {
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.6);
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmt;
    }
  }

  private place(t: Followable, world: CollisionWorld, inCar: boolean): void {
    const portrait = this.camera.aspect < 1;
    const sp = Math.abs(t.speed);
    const dist = (inCar ? CAR_DIST + sp * 0.11 : FOOT_DIST) * (portrait ? 1.12 : 1);
    const h = inCar ? CAR_HEIGHT : FOOT_HEIGHT;
    const r = world.collide(t.x - Math.sin(this.camA) * dist, t.z - Math.cos(this.camA) * dist, 1.2);
    this.target.set(r.x, t.y + h, r.z);
  }

  private apply(t: Followable): void {
    this.camera.position.copy(this.pos);
    this.look.set(t.x + Math.sin(this.camA) * 3.5, t.y + 1.7, t.z + Math.cos(this.camA) * 3.5);
    this.camera.lookAt(this.look);
  }
}
