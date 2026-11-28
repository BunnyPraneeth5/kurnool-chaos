import type * as THREE from 'three';
import type { CollisionWorld } from '../map/collision';
import { OnFootPlayer } from '../player/onFoot';
import type { Cop, Cops } from '../ai/cops';
import { Health } from './health';

// Cops on foot (task M.11). Police heat stops at 3 stars, so: at 2+ stars, when you are on
// foot near a chasing cop car, it stops and an officer gets out and runs after you. Officers
// bust you if they reach you while you stand still, lose you faster when you crouch out of
// sight, and at 3 stars shoot (cartoon tracers; a roll dodges, cover blocks). Hit them and
// they go down for a while. Local to each player, like the cops.

const MAX_OFFICERS = 3;
const GET_OUT_M = 30;
const RUN = 6.2; // m/s (you walk 5, run 9)
const SEE_M = 45;
const SEE_CROUCHED_M = 14;
const GIVE_UP_S = 4;
const GIVE_UP_CROUCHED_S = 2;
const BUST_M = 1.5;
const BUST_SPEED = 2.5;
const BUST_S = 1.2;
const SHOOT_M = 30;
const SHOOT_EVERY = 1.4;
const SHOT_DAMAGE = 8;
const OFFICER_HP = 60;
const OFFICER_DOWN_S = 10;
const KHAKI = 0xc8a165;

export interface Officer {
  fig: OnFootPlayer;
  car: Cop;
  hp: Health;
  seenT: number;
  lastX: number;
  lastZ: number;
  shootCd: number;
  back: boolean;
  /** line of sight is checked 4 times a second, not every frame */
  sightT: number;
  sees: boolean;
}

export interface OfficerTarget {
  x: number;
  y: number;
  z: number;
  speed: number;
  onFoot: boolean;
  crouched: boolean;
  rolling: boolean;
}

export interface OfficerShot {
  from: { x: number; y: number; z: number };
  hit: boolean;
  damage: number;
}

export class Officers {
  readonly list: Officer[] = [];
  private bustT = 0;
  /** 0..1 while an officer's bust is building (HUD). */
  bustLevel = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: CollisionWorld,
  ) {}

  clear(): void {
    for (const o of this.list) {
      this.scene.remove(o.fig.figure);
      o.car.hold = false;
    }
    this.list.length = 0;
    this.bustT = this.bustLevel = 0;
  }

  /** No wall between two points (sampled every `step` m and at least at the middle, at chest height). */
  clearLine(x0: number, z0: number, x1: number, z1: number, y: number, step = 1.5): boolean {
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
    for (let k = 1; k < n; k++) {
      const x = x0 + ((x1 - x0) * k) / n;
      const z = z0 + ((z1 - z0) * k) / n;
      if (this.world.collide(x, z, 0.3, y).hit) return false;
    }
    return true;
  }

  /** One frame. Returns the shots fired at you and whether you were busted. */
  update(dt: number, cops: Cops, t: OfficerTarget): { shots: OfficerShot[]; busted: boolean } {
    const shots: OfficerShot[] = [];
    const heat = cops.heat;
    // Get out of nearby chasing cars.
    if (heat >= 2 && t.onFoot && this.list.length < MAX_OFFICERS) {
      for (const c of cops.cops) {
        if (c.block || c.hold || c.wreck > 0 || this.list.some((o) => o.car === c)) continue;
        if (Math.hypot(c.x - t.x, c.z - t.z) > GET_OUT_M) continue;
        this.spawn(c);
        if (this.list.length >= MAX_OFFICERS) break;
      }
    }
    let nearest = Infinity;
    for (const o of [...this.list]) {
      const f = o.fig;
      const up = o.hp.update(dt);
      if (up) f.setDown(false);
      if (o.hp.isDown) {
        f.update(dt, { thr: 0, steer: 0, hand: false }, this.world);
        continue;
      }
      const carGone = !cops.cops.includes(o.car) || o.car.wreck > 0;
      const d = Math.hypot(t.x - f.x, t.z - f.z);
      // Seen: in range with a clear line; crouched you are only seen close up.
      o.sightT -= dt;
      if (o.sightT <= 0) {
        o.sightT = 0.25;
        o.sees = d < SEE_M && this.clearLine(f.x, f.z, t.x, t.z, f.y + 1.2);
      }
      const seen = !o.back && heat > 0 && t.onFoot && o.sees && d < (t.crouched ? SEE_CROUCHED_M : SEE_M);
      if (seen) {
        o.seenT = 0;
        o.lastX = t.x;
        o.lastZ = t.z;
      } else o.seenT += dt;
      if (heat === 0 || o.seenT > (t.crouched ? GIVE_UP_CROUCHED_S : GIVE_UP_S) || (!t.onFoot && d > 25)) o.back = true;
      // Where to run: at you, to where you were last seen, or back to the car.
      let gx = o.lastX, gz = o.lastZ;
      if (o.back) {
        if (carGone) {
          if (d > 120) this.remove(o);
          gx = f.x;
          gz = f.z;
        } else {
          gx = o.car.x + Math.cos(o.car.a) * 1.8;
          gz = o.car.z - Math.sin(o.car.a) * 1.8;
          if (Math.hypot(gx - f.x, gz - f.z) < 1.2) {
            this.remove(o);
            continue;
          }
        }
      }
      const want = Math.atan2(gx - f.x, gz - f.z);
      const dist = Math.hypot(gx - f.x, gz - f.z);
      f.a = want;
      const close = !o.back && seen && d < BUST_M + 0.3;
      f.update(dt, { thr: dist > 0.6 && !close ? RUN / 9 : 0, steer: 0, hand: true }, this.world);
      if (!o.back) nearest = Math.min(nearest, d);
      // 3 stars: shoot.
      o.shootCd -= dt;
      if (heat >= 3 && seen && d < SHOOT_M && d > 2.5 && o.shootCd <= 0) {
        o.shootCd = SHOOT_EVERY * (0.8 + Math.random() * 0.4);
        f.fired();
        const chance = t.rolling ? 0 : t.crouched ? 0.3 : 0.55;
        shots.push({ from: { x: f.x, y: f.y + 1.35, z: f.z }, hit: Math.random() < chance, damage: SHOT_DAMAGE });
      }
    }
    // Bust: an officer at your side while you stand still.
    let busted = false;
    if (nearest < BUST_M && Math.abs(t.speed) < BUST_SPEED && t.onFoot) {
      this.bustT += dt;
      if (this.bustT > BUST_S) busted = true;
    } else this.bustT = Math.max(0, this.bustT - dt * 0.5);
    this.bustLevel = this.bustT / BUST_S;
    if (busted) this.clear();
    return { shots, busted };
  }

  /** Hit an officer; true when this put them down. */
  hit(o: Officer, damage: number): boolean {
    const down = o.hp.damage(damage);
    if (down) {
      o.hp.down = OFFICER_DOWN_S;
      o.fig.setDown(true);
    }
    return down;
  }

  private spawn(c: Cop): void {
    c.hold = true;
    // Out of the driver's door (right-hand drive: the right side).
    const side = 1.6;
    const x = c.x - Math.cos(c.a) * side, z = c.z + Math.sin(c.a) * side;
    const fig = new OnFootPlayer(x, z, c.a, KHAKI);
    fig.y = this.world.heightAt(x, z, c.y);
    fig.setWeapon('pistol');
    this.scene.add(fig.figure);
    const hp = new Health(false);
    hp.hp = OFFICER_HP;
    this.list.push({ fig, car: c, hp, seenT: 0, lastX: x, lastZ: z, shootCd: 1.5, back: false, sightT: 0, sees: false });
  }

  private remove(o: Officer): void {
    const i = this.list.indexOf(o);
    if (i >= 0) this.list.splice(i, 1);
    this.scene.remove(o.fig.figure);
    o.car.hold = false;
  }
}
