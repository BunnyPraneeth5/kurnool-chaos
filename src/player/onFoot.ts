import * as THREE from 'three';
import type { CollisionWorld } from '../map/collision';
import type { MoveInput } from './input';

// On-foot player ported from the demo: box figure with swinging limbs,
// tank-style controls (forward/back walks, left/right turns), Shift to run.
// Heading convention: forward = (sin a, cos a).

const WALK = 5; // m/s
const RUN = 9; // m/s
const TURN = 2.8; // rad/s
export const PLAYER_RADIUS = 0.5;

type Limb = THREE.Group;

function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
}

export class OnFootPlayer {
  x: number;
  z: number;
  y = 0;
  a: number;
  speed = 0;
  private phase = 0;
  readonly figure = new THREE.Group();
  private readonly legL: Limb;
  private readonly legR: Limb;
  private readonly armL: Limb;
  private readonly armR: Limb;

  constructor(x: number, z: number, heading: number, shirt = 0xffc247) {
    this.x = x;
    this.z = z;
    this.a = heading;
    const f = this.figure;
    const torso = box(0.62, 0.72, 0.36, shirt);
    torso.position.y = 1.16;
    const head = box(0.38, 0.38, 0.38, 0xd9a07c);
    head.position.y = 1.74;
    const hair = box(0.4, 0.12, 0.4, 0x241c2e);
    hair.position.y = 1.97;
    f.add(torso, head, hair);
    const limb = (x0: number, y0: number, w: number, h: number, color: number): Limb => {
      const g = new THREE.Group();
      g.position.set(x0, y0, 0);
      const m = box(w, h, 0.28, color);
      m.position.y = -h / 2;
      g.add(m);
      f.add(g);
      return g;
    };
    this.legL = limb(0.16, 0.8, 0.26, 0.8, 0x2b2a4a);
    this.legR = limb(-0.16, 0.8, 0.26, 0.8, 0x2b2a4a);
    this.armL = limb(0.42, 1.5, 0.18, 0.66, shirt);
    this.armR = limb(-0.42, 1.5, 0.18, 0.66, shirt);
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 14).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    shadow.position.y = 0.2; // above the highest road layer
    f.add(shadow);
    this.sync();
  }

  update(dt: number, inp: MoveInput, world: CollisionWorld): void {
    let sp = (inp.hand ? RUN : WALK) * inp.thr;
    if (sp < 0) sp *= 0.5;
    this.a -= inp.steer * TURN * dt;
    this.x += Math.sin(this.a) * sp * dt;
    this.z += Math.cos(this.a) * sp * dt;
    const r = world.collide(this.x, this.z, PLAYER_RADIUS);
    this.x = r.x;
    this.z = r.z;
    this.speed = sp;
    // Step up onto bridge decks smoothly.
    const ground = world.heightAt(this.x, this.z);
    this.y += (ground - this.y) * Math.min(1, dt * 12);
    this.animate(dt, sp);
    this.sync();
  }

  /** Swing arms and legs for walking at `speed` m/s (also used for friends' figures). */
  animate(dt: number, speed: number): void {
    this.phase += Math.abs(speed) * dt * 2.4;
    const sw = Math.sin(this.phase) * 0.75 * Math.min(1, Math.abs(speed) / 4);
    this.legL.rotation.x = sw;
    this.legR.rotation.x = -sw;
    this.armL.rotation.x = -sw;
    this.armR.rotation.x = sw;
  }

  sync(): void {
    this.figure.position.set(this.x, this.y, this.z);
    this.figure.rotation.y = this.a;
  }
}
