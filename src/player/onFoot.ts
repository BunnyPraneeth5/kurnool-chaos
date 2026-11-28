import * as THREE from 'three';
import type { CollisionWorld } from '../map/collision';
import type { MoveInput } from './input';
import { NO_ACTS, type Acts, type EmoteId } from '../net/acts';
import type { WeaponId } from '../combat/weapons';

// On-foot player ported from the demo: box figure with swinging limbs, tank-style controls
// (forward/back walks, left/right turns), Shift to run. Task M.6 adds jumping (onto vehicle
// roofs and over low walls), crouching, a dodge roll and emotes; M.7 to M.9 falling down,
// swings and a weapon in hand. Friends' figures use the same class (setActs).
// Heading convention: forward = (sin a, cos a).

const WALK = 5; // m/s
const RUN = 9; // m/s
const CROUCH = 2; // m/s
const TURN = 2.8; // rad/s
export const PLAYER_RADIUS = 0.5;
/** Jump: up speed and gravity give a peak of about 1.4 m and 0.75 s in the air. */
const JUMP_V = 7.4;
const GRAVITY = 20;
const ROLL_S = 0.45;
const ROLL_SPEED = 10;
const EMOTE_S = 3;
/** The body pivots at the waist (rolls and falls turn round it). */
const HIP = 0.9;

type Limb = THREE.Group;

function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
}

/** A small model of a weapon held in the right hand (null for fists). */
function weaponModel(id: WeaponId): THREE.Object3D | null {
  const g = new THREE.Group();
  const part = (w: number, h: number, d: number, c: number, z: number, y = 0): void => {
    const m = box(w, h, d, c);
    m.position.set(0, y, z);
    g.add(m);
  };
  switch (id) {
    case 'bat':
      part(0.07, 0.07, 0.3, 0x3b2a1a, 0.08);
      part(0.12, 0.05, 0.62, 0xd9b97a, 0.52);
      break;
    case 'lathi':
      part(0.06, 0.06, 1.5, 0xa77b3f, 0.45);
      break;
    case 'pistol':
      part(0.08, 0.13, 0.12, 0x232833, 0);
      part(0.07, 0.07, 0.3, 0xf2b33d, 0.14, 0.06);
      break;
    case 'shotgun':
      part(0.08, 0.12, 0.3, 0x5b3a22, -0.05);
      part(0.07, 0.07, 0.6, 0x2c66c4, 0.38, 0.03);
      break;
    case 'balloon':
      part(0.2, 0.22, 0.2, 0x4fa8e8, 0.05);
      break;
    case 'tomato':
      part(0.16, 0.14, 0.16, 0xd8342c, 0.05);
      break;
    case 'cracker':
      part(0.07, 0.07, 0.26, 0xd13b32, 0.08);
      part(0.02, 0.02, 0.08, 0xf2e3a0, 0.24);
      break;
    default:
      return null;
  }
  return g;
}

export interface FootExtras {
  /** Jump pressed this frame. */
  jump: boolean;
  /** Crouch pressed this frame (toggles; while running it rolls instead). */
  crouch: boolean;
  /** Top of a vehicle under (x, z) that someone at feet height y could stand on, or null. */
  roofAt?: (x: number, z: number, y: number) => number | null;
}

export class OnFootPlayer {
  x: number;
  z: number;
  y = 0;
  a: number;
  speed = 0;
  /** up speed while in the air (m/s) */
  vy = 0;
  air = false;
  crouched = false;
  private rollT = 0;
  private emote: EmoteId | null = null;
  private emoteT = 0;
  /** lying down (health ran out, task M.7) */
  down = false;
  private downAnim = 0;
  private swingT = 0;
  private fireT = 0;
  /** every third punch is a kick */
  private combo = 0;
  private kick = false;
  private weapon: WeaponId = 'fists';
  private held: THREE.Object3D | null = null;
  private phase = 0;
  private t = 0;
  readonly figure = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legL: Limb;
  private readonly legR: Limb;
  private readonly armL: Limb;
  private readonly armR: Limb;

  constructor(x: number, z: number, heading: number, shirt = 0xffc247) {
    this.x = x;
    this.z = z;
    this.a = heading;
    const b = this.body;
    b.position.y = HIP;
    this.figure.add(b);
    const torso = box(0.62, 0.72, 0.36, shirt);
    torso.position.y = 1.16 - HIP;
    const head = box(0.38, 0.38, 0.38, 0xd9a07c);
    head.position.y = 1.74 - HIP;
    const hair = box(0.4, 0.12, 0.4, 0x241c2e);
    hair.position.y = 1.97 - HIP;
    b.add(torso, head, hair);
    const limb = (x0: number, y0: number, w: number, h: number, color: number): Limb => {
      const g = new THREE.Group();
      g.position.set(x0, y0 - HIP, 0);
      const m = box(w, h, 0.28, color);
      m.position.y = -h / 2;
      g.add(m);
      b.add(g);
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
    shadow.name = 'shadow';
    this.figure.add(shadow);
    this.sync();
  }

  get rolling(): boolean {
    return this.rollT > 0;
  }

  update(dt: number, inp: MoveInput, world: CollisionWorld, ex: FootExtras = { jump: false, crouch: false }): void {
    this.t += dt;
    this.swingT = Math.max(0, this.swingT - dt);
    this.fireT = Math.max(0, this.fireT - dt);
    if (this.down) {
      inp = { thr: 0, steer: 0, hand: false };
      ex = { ...ex, jump: false, crouch: false };
    }
    // Crouch toggles; pressed while running forward it is a dodge roll instead.
    if (ex.crouch && !this.air && this.rollT <= 0) {
      if (inp.hand && inp.thr > 0.3) {
        this.rollT = ROLL_S;
        this.crouched = false;
      } else this.crouched = !this.crouched;
      this.emote = null;
    }
    if (ex.jump && !this.air && this.rollT <= 0) {
      this.crouched = false;
      this.air = true;
      this.vy = JUMP_V;
      this.emote = null;
    }
    let sp: number;
    if (this.rollT > 0) {
      this.rollT = Math.max(0, this.rollT - dt);
      sp = ROLL_SPEED;
    } else {
      sp = (this.crouched ? CROUCH : inp.hand ? RUN : WALK) * inp.thr;
      if (sp < 0) sp *= 0.5;
      this.a -= inp.steer * TURN * dt;
    }
    if (Math.abs(inp.thr) > 0.1 && this.emote) this.emote = null;
    if (this.emote && this.emote !== 'dance') {
      this.emoteT -= dt;
      if (this.emoteT <= 0) this.emote = null;
    }
    this.x += Math.sin(this.a) * sp * dt;
    this.z += Math.cos(this.a) * sp * dt;
    // Feet this far above the ground clear low walls, dividers and railings.
    const groundHere = world.heightAt(this.x, this.z, this.y);
    const r = world.collide(this.x, this.z, PLAYER_RADIUS, this.y + 0.3, undefined, this.y - groundHere);
    this.x = r.x;
    this.z = r.z;
    this.speed = sp;
    // Ground: the terrain, a deck, or a vehicle roof we came down on.
    let surface = world.heightAt(this.x, this.z, this.y);
    const roof = ex.roofAt?.(this.x, this.z, this.y);
    if (roof != null && roof > surface) surface = roof;
    if (this.air) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= surface) {
        this.y = surface;
        this.vy = 0;
        this.air = false;
      }
    } else if (surface < this.y - 0.6 && surface > this.y - 8) {
      // Walked off a roof or a ledge: fall.
      this.air = true;
      this.vy = 0;
    } else if (Math.abs(surface - this.y) > 3) {
      // Big jumps (unstuck, teleports, map changes) snap straight to the ground; small steps blend.
      this.y = surface;
    } else this.y += (surface - this.y) * Math.min(1, dt * 12);
    this.pose(dt, sp);
    this.sync();
  }

  /** Start an emote (stops when you move). */
  startEmote(id: EmoteId): void {
    if (this.down || this.air) return;
    this.emote = id;
    this.emoteT = EMOTE_S;
    this.crouched = false;
  }

  /** Swing (melee or throw). Returns true when this swing is a kick (every third punch). */
  swing(): boolean {
    this.swingT = 0.32;
    this.emote = null;
    this.combo = (this.combo + 1) % 3;
    this.kick = this.weapon === 'fists' && this.combo === 0;
    return this.kick;
  }

  /** A gun went off (arm kicks up, friends see a flash). */
  fired(): void {
    this.fireT = 0.25;
    this.emote = null;
  }

  setWeapon(id: WeaponId): void {
    if (id === this.weapon && (this.held !== null) === (id !== 'fists')) return;
    this.weapon = id;
    if (this.held) this.armR.remove(this.held);
    this.held = weaponModel(id);
    if (this.held) {
      this.held.position.set(0, -0.62, 0.05);
      this.armR.add(this.held);
    }
  }

  /** Fall down (task M.7) or get back up. */
  setDown(down: boolean): void {
    if (down === this.down) return;
    this.down = down;
    this.crouched = false;
    this.emote = null;
    this.rollT = 0;
  }

  /** What friends need to draw us (state field `a`). */
  acts(): Acts {
    return {
      crouch: this.crouched,
      roll: this.rollT > 0,
      down: this.down,
      emote: this.emote,
      weapon: this.weapon,
      swing: this.swingT > 0,
      fire: this.fireT > 0,
    };
  }

  /** A friend's figure: copy what they are doing from their state. */
  setActs(a: Acts = NO_ACTS): void {
    this.crouched = a.crouch;
    if (a.roll && this.rollT <= 0) this.rollT = ROLL_S;
    if (!a.roll && this.rollT > 0.1) this.rollT = 0.1;
    this.setDown(a.down);
    if (a.emote !== this.emote) {
      this.emote = a.emote;
      this.emoteT = 99; // the sender ends it
    }
    this.setWeapon(a.weapon);
    if (a.swing && this.swingT <= 0) this.swingT = 0.32;
    if (a.fire && this.fireT <= 0) this.fireT = 0.25;
  }

  /** Friends' figures (no update()): advance the timers, then pose for `speed` m/s. */
  animate(dt: number, speed: number): void {
    if (dt > 0) this.tick(dt);
    this.pose(dt, speed);
  }

  private pose(dt: number, speed: number): void {
    const b = this.body;
    this.phase += Math.abs(speed) * dt * 2.4;
    const walk = this.air ? 0 : Math.sin(this.phase) * 0.75 * Math.min(1, Math.abs(speed) / 4);
    // Defaults: upright, arms and legs swinging with the walk.
    b.position.y = HIP;
    b.rotation.set(0, 0, 0);
    b.scale.set(1, 1, 1);
    this.legL.rotation.set(walk, 0, 0);
    this.legR.rotation.set(-walk, 0, 0);
    this.armL.rotation.set(-walk, 0, 0);
    this.armR.rotation.set(walk, 0, 0);
    // Falling down and lying there.
    this.downAnim = this.down ? Math.min(1, this.downAnim + dt * 3) : Math.max(0, this.downAnim - dt * 2);
    if (this.downAnim > 0) {
      const k = this.downAnim;
      b.rotation.x = (-Math.PI / 2) * k;
      b.position.y = HIP - (HIP - 0.25) * k;
      this.armL.rotation.set(0, 0, 0.6 * k);
      this.armR.rotation.set(0, 0, -0.6 * k);
      this.legL.rotation.set(0, 0, 0.15 * k);
      this.legR.rotation.set(0, 0, -0.15 * k);
      return;
    }
    if (this.rollT > 0) {
      // Tuck and spin forward round the waist.
      const p = 1 - this.rollT / ROLL_S;
      b.rotation.x = p * Math.PI * 2;
      b.position.y = 0.55;
      b.scale.set(1, 0.8, 1);
      this.legL.rotation.x = this.legR.rotation.x = -1.6;
      this.armL.rotation.x = this.armR.rotation.x = -1.2;
      return;
    }
    if (this.air) {
      this.legL.rotation.x = 0.5;
      this.legR.rotation.x = -0.3;
      this.armL.rotation.z = 0.5;
      this.armR.rotation.z = -0.5;
    }
    if (this.crouched) {
      b.scale.set(1, 0.72, 1);
      b.position.y = HIP * 0.72;
      b.rotation.x = 0.25;
    }
    const t = this.t;
    switch (this.emote) {
      case 'wave':
        this.armR.rotation.set(0, 0, -2.6 + Math.sin(t * 10) * 0.35);
        break;
      case 'dance':
        b.rotation.z = Math.sin(t * 6) * 0.18;
        b.position.y += Math.abs(Math.sin(t * 6)) * 0.12;
        this.armL.rotation.set(0, 0, 2.2 + Math.sin(t * 6) * 0.6);
        this.armR.rotation.set(0, 0, -2.2 + Math.sin(t * 6 + 1) * 0.6);
        this.legL.rotation.x = Math.sin(t * 6) * 0.4;
        this.legR.rotation.x = -Math.sin(t * 6) * 0.4;
        break;
      case 'point':
        this.armR.rotation.set(-1.55, 0, 0);
        break;
      case 'namaste':
        this.armL.rotation.set(-1.25, 0, -0.55);
        this.armR.rotation.set(-1.25, 0, 0.55);
        b.rotation.x = 0.2;
        break;
    }
    // Weapons: guns are held out in front; swings and kicks override the arm or leg.
    if (this.weapon === 'pistol' || this.weapon === 'shotgun') {
      this.armR.rotation.set(-1.45 - (this.fireT > 0 ? 0.35 * (this.fireT / 0.25) : 0), 0, 0);
      if (this.weapon === 'shotgun') this.armL.rotation.set(-1.3, 0, -0.4);
    }
    if (this.swingT > 0) {
      const p = 1 - this.swingT / 0.32;
      if (this.kick) this.legR.rotation.x = -1.5 * Math.sin(p * Math.PI);
      else if (this.weapon === 'fists') this.armR.rotation.set(-1.5 * Math.sin(p * Math.PI), 0, 0);
      else this.armR.rotation.set(-2.6 + p * 3.2, 0, 0);
    }
  }

  /** Friends' figures do not run update(): advance their timers here. */
  private tick(dt: number): void {
    this.t += dt;
    if (this.rollT > 0) this.rollT = Math.max(0, this.rollT - dt);
    this.swingT = Math.max(0, this.swingT - dt);
    this.fireT = Math.max(0, this.fireT - dt);
  }

  sync(): void {
    this.figure.position.set(this.x, this.y, this.z);
    this.figure.rotation.y = this.a;
  }
}
