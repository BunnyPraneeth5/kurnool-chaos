import type * as THREE from 'three';
import type { Game } from '../game';
import { Vehicle } from '../vehicles/vehicle';
import { VEHICLES, type VehicleType } from '../vehicles/params';
import { hullDistance } from '../vehicles/hull';
import { setDamageLook } from '../vehicles/models';
import type { TrafficCar } from '../ai/traffic';
import type { Agent } from '../ai/agent';
import type { Ped } from '../ai/pedestrians';
import { nearestHospital } from '../map/hospitals';
import { nearestStation } from '../map/police';
import { sound } from '../audio/sound';
import { buzz } from '../ui/haptics';
import { CHAOS } from '../modes/chaosPoints';
import { Effects } from './effects';
import { Health, crashDamage } from './health';
import { Officers, type Officer } from './officers';
import { Pickups } from './pickups';
import {
  WEAPONS, nextWeapon, pickUp, refill, spend, startInventory, throwDistance, throwVelocity, usable, weaponLabel,
  type Weapon, type WeaponId,
} from './weapons';

// Fighting (tasks M.7 to M.12): your weapons and health, attacks with aim assist, thrown
// things, blasts, vehicle damage, cops on foot and hits on friends. Pedestrians are knocked
// over but never hurt. Friends' hits are decided on the attacker's screen and ride on the
// state message (no extra messages, see ARCHITECTURE).

const GRAVITY = 20;
/** Aim assist: targets within this angle of where you aim are picked (phones get more help). */
const ASSIST = 0.35;
const ASSIST_TOUCH = 0.55;
const CARJACK_SPEED = 4;
const STATION_REFILL_M = 8;
const WRECK_BLAST = { radius: 5, damage: 40 };
const SPLAT_COLOUR: Partial<Record<WeaponId, number>> = { balloon: 0x4fa8e8, tomato: 0xd8342c };
/** Shared parked vehicles come back where they live this long after being wrecked. */
export const WRECK_BACK_MS = 120000;

/** A friend as drawn on this screen (set by the room code). */
export interface FriendBody {
  id: string;
  x: number;
  y: number;
  z: number;
  /** on foot, or the vehicle type they drive */
  type: 'foot' | VehicleType;
  a: number;
}

/** A hit on a friend, sent with our next state message. */
export interface HitOut {
  to: string;
  /** damage (0 for splashes) */
  d: number;
  k: WeaponId | 'blast';
}

type TargetKind = 'ped' | 'officer' | 'friend' | 'traffic' | 'cop' | 'parked';
interface Target {
  kind: TargetKind;
  x: number;
  y: number;
  z: number;
  r: number;
  ped?: Ped;
  officer?: Officer;
  friend?: FriendBody;
  agent?: Agent;
  vehicle?: Vehicle;
}

interface Thrown {
  w: Weapon;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** firecrackers: seconds of fuse left after landing (-1 in the air) */
  fuse: number;
  slot: number;
}

export class Combat {
  readonly inv = startInventory();
  readonly health = new Health();
  readonly effects: Effects;
  readonly officers: Officers;
  readonly pickups: Pickups;
  /** Friends near us (set by the room code). */
  friends: () => FriendBody[] = () => [];
  /** May we hit this friend now (free roam yes; rounds by mode)? Set by the room code. */
  canHitFriend: (id: string) => boolean = () => true;
  /** Chor–Police: a police stun on a chor counts as a catch (set by the room code). */
  onStun: (id: string) => void = () => {};
  /** A shared parked vehicle was wrecked or blew up (told to friends). */
  onSharedWreck: (index: number, blown: boolean) => void = () => {};
  /** Hits on friends waiting for our next state message. */
  readonly pendingHits: HitOut[] = [];
  /** HUD hooks. */
  onHurt: (fromAngle: number | null, splash: WeaponId | null) => void = () => {};
  onHitMark: () => void = () => {};
  private cd = 0;
  private holdT = -1;
  private readonly thrown: Thrown[] = [];
  private refillCd = 0;
  private smokeT = 0;
  private dotsT = 0;
  private readonly touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;

  constructor(
    private readonly game: Game,
    scene: THREE.Scene,
  ) {
    this.effects = new Effects(scene);
    this.officers = new Officers(scene, game.world);
    this.pickups = new Pickups(game.map, game.world, scene);
    game.player.setWeapon(this.inv.current);
  }

  get weapon(): Weapon {
    return WEAPONS[this.inv.current];
  }

  get down(): boolean {
    return this.health.isDown;
  }

  /** Text for the weapon button. */
  label(): string {
    return weaponLabel(this.inv);
  }

  select(id: WeaponId): void {
    if (!usable(this.inv, id)) return;
    this.inv.current = id;
    this.game.player.setWeapon(id);
    this.holdT = -1;
    this.effects.showArc(null);
  }

  next(): void {
    this.select(nextWeapon(this.inv));
  }

  /** One frame. `attack`: pressed this frame; `held`: still held (guns keep firing, throws aim). */
  update(dt: number, attack: boolean, held: boolean, still: boolean): void {
    const g = this.game;
    this.cd = Math.max(0, this.cd - dt);
    this.effects.update(dt);
    this.updateHealth(dt);
    if (this.inv.current !== 'fists' && !usable(this.inv, this.inv.current)) this.select(nextWeapon(this.inv));

    const onFoot = !g.car && !g.ride;
    const me = g.car ?? g.player;
    // Pickups and ammo at police stations.
    const took = this.pickups.update(dt, me.x, me.z, g.player.y, onFoot && !this.down);
    if (took) {
      const got = pickUp(this.inv, took);
      if (got) {
        g.toast(`Picked up: ${got}`);
        sound.cue('getIn');
        buzz(25);
      }
    }
    this.refillCd = Math.max(0, this.refillCd - dt);
    const st = this.refillCd <= 0 && onFoot ? nearestStation(g.map, me.x, me.z) : null;
    if (st && Math.hypot(st.x - me.x, st.z - me.z) < STATION_REFILL_M) {
      this.refillCd = 30;
      if (refill(this.inv)) g.toast('Ammo refilled at the police station');
    }
    this.dotsT -= dt;
    if (this.dotsT <= 0 || took) {
      this.dotsT = 1;
      g.minimap.pickups = this.pickups.dots();
    }

    // Attacks.
    const w = this.weapon;
    const canUse = !still && !this.down && (onFoot || w.kind === 'gun');
    if (canUse && w.kind === 'throw' && onFoot) {
      if ((attack || held) && this.holdT < 0 && this.cd <= 0) this.holdT = 0;
      if (this.holdT >= 0) {
        if (held) {
          this.holdT += dt;
          this.previewThrow();
        } else {
          this.throwIt(this.holdT);
          this.holdT = -1;
          this.effects.showArc(null);
        }
      }
    } else {
      if (this.holdT >= 0) this.effects.showArc(null);
      this.holdT = -1;
      if (canUse && (attack || (held && w.kind === 'gun')) && this.cd <= 0) {
        if (w.kind === 'melee') this.melee(w);
        else if (w.kind === 'gun') this.shoot(w);
      }
    }
    this.updateThrown(dt);
    this.updateOfficers(dt);
    this.updateVehicles(dt);
  }

  // --- health -----------------------------------------------------------------------------

  private updateHealth(dt: number): void {
    const g = this.game;
    if (g.player.rolling) this.health.shield = Math.max(this.health.shield, 0.05);
    const wasDown = this.health.isDown;
    const up = this.health.update(dt);
    if (up && wasDown) this.getUp();
  }

  /** Take a hit (cops' shots, blasts, friends). `from` is where it came from, for the HUD. */
  hurt(damage: number, from: { x: number; z: number } | null, splash: WeaponId | null = null): void {
    const g = this.game;
    const me = g.car ?? g.player;
    const ang = from ? Math.atan2(from.x - me.x, from.z - me.z) : null;
    this.onHurt(ang, splash);
    if (splash || damage <= 0) return;
    // In a vehicle, the vehicle takes it.
    if (g.car) {
      this.damageVehicle({ kind: 'parked', x: g.car.x, y: g.car.y, z: g.car.z, r: 1, vehicle: g.car }, damage * 0.6, false);
      return;
    }
    if (g.ride) return; // riders are safe in a friend's vehicle
    buzz(40);
    if (this.health.damage(damage)) this.knockedOut();
  }

  private knockedOut(): void {
    const g = this.game;
    g.player.setDown(true);
    g.chaos.knockedOut();
    sound.cue('busted');
    const h = nearestHospital(g.map, g.player.x, g.player.z);
    g.toast(h ? `Knocked out! Getting up at ${h.name}` : 'Knocked out!', 'bad');
    this.holdT = -1;
    this.effects.showArc(null);
  }

  private getUp(): void {
    const g = this.game;
    g.player.setDown(false);
    const h = nearestHospital(g.map, g.player.x, g.player.z);
    g.life.cops.clear();
    this.officers.clear();
    if (h) g.toFoot(h.x, h.z, h.a);
    refill(this.inv);
    refill(this.inv, false);
    g.toast(h ? `Back on your feet at ${h.name}` : 'Back on your feet');
  }

  // --- aiming ------------------------------------------------------------------------------

  /** Everything that can be hit near (x, z) within `range`. */
  private targets(x: number, z: number, range: number): Target[] {
    const g = this.game;
    const out: Target[] = [];
    const near = (tx: number, tz: number): boolean => Math.abs(tx - x) < range + 6 && Math.abs(tz - z) < range + 6;
    for (const p of g.life.peds.peds) if (near(p.x, p.z) && p.down <= 0) out.push({ kind: 'ped', x: p.x, y: p.y + 1.1, z: p.z, r: 0.45, ped: p });
    for (const o of this.officers.list) if (near(o.fig.x, o.fig.z) && !o.hp.isDown) out.push({ kind: 'officer', x: o.fig.x, y: o.fig.y + 1.1, z: o.fig.z, r: 0.5, officer: o });
    for (const f of this.friends()) {
      if (!near(f.x, f.z)) continue;
      const foot = f.type === 'foot';
      out.push({ kind: 'friend', x: f.x, y: f.y + (foot ? 1.1 : 1), z: f.z, r: foot ? 0.5 : VEHICLES[f.type as VehicleType].w / 2 + 0.3, friend: f });
    }
    for (const c of g.life.traffic.cars) if (near(c.x, c.z) && !c.blown) out.push({ kind: 'traffic', x: c.x, y: c.y + 1, z: c.z, r: VEHICLES[c.type].w / 2 + 0.3, agent: c });
    for (const c of g.life.cops.cops) if (near(c.x, c.z) && !c.blown) out.push({ kind: 'cop', x: c.x, y: c.y + 1, z: c.z, r: VEHICLES[c.type].w / 2 + 0.3, agent: c });
    for (const v of g.vehicles) if (v !== g.car && v.mesh.visible && near(v.x, v.z) && !v.blown) out.push({ kind: 'parked', x: v.x, y: v.y + 1, z: v.z, r: v.t.w / 2 + 0.3, vehicle: v });
    return out;
  }

  /** Distance from (x, z) to a target's body (vehicles: their hull). */
  private reach(t: Target, x: number, z: number): number {
    const body = t.agent ?? t.vehicle;
    if (body) return Math.max(0, hullDistance(body, x, z).d);
    if (t.friend && t.friend.type !== 'foot') return Math.max(0, hullDistance({ x: t.x, z: t.z, a: t.friend.a, type: t.friend.type }, x, z).d);
    return Math.max(0, Math.hypot(t.x - x, t.z - z) - t.r);
  }

  /** The best target in a cone round `aim`, or null. */
  private assist(list: Target[], x: number, z: number, aim: number, range: number, cone: number, from: { y: number }): Target | null {
    let best: Target | null = null;
    let bs = Infinity;
    for (const t of list) {
      if (t.kind === 'friend' && !this.canHitFriend(t.friend!.id)) continue;
      const d = this.reach(t, x, z);
      if (d > range) continue;
      const da = Math.abs(angDiff(Math.atan2(t.x - x, t.z - z), aim));
      if (da > cone + Math.atan2(t.r, Math.max(1, d))) continue;
      // People before vehicles, then the one closest to where you aim.
      const score = da * 3 + d * 0.02 + (t.kind === 'traffic' || t.kind === 'parked' ? 0.6 : 0);
      if (score < bs && this.officers.clearLine(x, z, t.x, t.z, from.y, d < 6 ? 0.4 : 1.5)) {
        bs = score;
        best = t;
      }
    }
    return best;
  }

  // --- melee (M.8) --------------------------------------------------------------------------

  private melee(w: Weapon): void {
    const g = this.game;
    const p = g.player;
    this.cd = w.cooldown;
    const list = this.targets(p.x, p.z, w.reach + 2);
    // Turn to the nearest thing in front within reach (a little help).
    const help = this.assist(list, p.x, p.z, p.a, w.reach + 0.6, (w.arc ?? 0.9) + 0.4, { y: p.y + 1.1 });
    if (help) p.a = Math.atan2(help.x - p.x, help.z - p.z);
    const kick = p.swing();
    const damage = kick ? 20 : w.damage;
    sound.cue('getOut');
    let hits = 0;
    for (const t of list) {
      const d = this.reach(t, p.x, p.z);
      if (d > w.reach) continue;
      const da = Math.abs(angDiff(Math.atan2(t.x - p.x, t.z - p.z), p.a));
      if (da > (w.arc ?? 0.9) + Math.atan2(t.r, Math.max(0.5, d))) continue;
      if (!this.officers.clearLine(p.x, p.z, t.x, t.z, p.y + 1, 0.4)) continue;
      // Hit a traffic vehicle's driver side slowly enough: carjack.
      if (t.kind === 'traffic' && w.id === 'fists' && Math.abs((t.agent as TrafficCar).speed) < CARJACK_SPEED && (t.agent as TrafficCar).wreck <= 0) {
        g.carjack(t.agent as TrafficCar);
        return;
      }
      this.hit(t, damage, w, { x: p.x, z: p.z });
      hits++;
      if (w.kind === 'melee' && t.kind !== 'traffic' && t.kind !== 'parked' && t.kind !== 'cop') break; // one person per swing
    }
    if (hits) {
      buzz(30);
      sound.thud(0.35);
    }
  }

  // --- guns (M.9) ---------------------------------------------------------------------------

  /** Where you aim: the camera's way on foot and for riders; drivers shoot out of a side window. */
  private aimFrom(): { x: number; y: number; z: number; aim: number; side: boolean } {
    const g = this.game;
    const cam = g.aimYaw();
    if (g.car) {
      const c = g.car;
      // Out of the window on the side the camera looks to.
      const rel = angDiff(cam, c.a);
      const left = rel > 0;
      const a = c.a + (left ? Math.PI / 2 : -Math.PI / 2);
      return { x: c.x + Math.sin(a) * (c.t.w / 2), y: c.y + 1.3, z: c.z + Math.cos(a) * (c.t.w / 2), aim: a, side: true };
    }
    const p = g.player;
    return { x: p.x, y: p.y + 1.35, z: p.z, aim: cam, side: false };
  }

  private shoot(w: Weapon): void {
    const g = this.game;
    if (!spend(this.inv, w.id)) {
      g.toast(`Out of ${w.name.toLowerCase()} ammo`);
      this.next();
      return;
    }
    this.cd = w.cooldown;
    const from = this.aimFrom();
    const list = this.targets(from.x, from.z, w.reach);
    const help = this.assist(list, from.x, from.z, from.aim, w.reach, from.side ? 0.6 : this.touch ? ASSIST_TOUCH : ASSIST, from);
    let aim = from.aim;
    let pitch = 0;
    if (help) {
      aim = Math.atan2(help.x - from.x, help.z - from.z);
      pitch = Math.atan2(help.y - from.y, Math.max(1, Math.hypot(help.x - from.x, help.z - from.z)));
    }
    if (!g.car) {
      g.player.a = aim;
      g.player.fired();
    }
    const muzzle = { x: from.x + Math.sin(aim) * 0.6, y: from.y, z: from.z + Math.cos(aim) * 0.6 };
    this.effects.flash(muzzle.x, muzzle.y, muzzle.z, 0.16);
    sound.thud(0.25);
    buzz(15);
    // Gunfire scares people around.
    g.life.peds.scare(from.x, from.z, 25);
    let hits = 0;
    const pellets = w.pellets ?? 1;
    for (let i = 0; i < pellets; i++) {
      const a = aim + (pellets > 1 ? (Math.random() - 0.5) * (w.spread ?? 0) * 2 : 0);
      const hit = this.ray(list, muzzle, a, pitch, w.reach);
      this.effects.tracer(muzzle.x, muzzle.y, muzzle.z, hit.x, hit.y, hit.z, pellets > 1 ? 0xffc27a : 0xfff1a0);
      if (hit.target) {
        this.effects.flash(hit.x, hit.y, hit.z, 0.12, 0xffffff);
        this.hit(hit.target, w.damage, w, { x: from.x, z: from.z });
        hits++;
      }
    }
    if (hits) this.onHitMark();
  }

  /** The first target or wall along a shot. */
  private ray(list: Target[], from: { x: number; y: number; z: number }, a: number, pitch: number, range: number): { x: number; y: number; z: number; target: Target | null } {
    const sx = Math.sin(a), sz = Math.cos(a);
    let best: Target | null = null;
    let bt = range;
    for (const t of list) {
      if (t.kind === 'friend' && !this.canHitFriend(t.friend!.id)) continue;
      const dx = t.x - from.x, dz = t.z - from.z;
      const along = dx * sx + dz * sz;
      if (along < 0 || along > bt) continue;
      const side = Math.abs(dx * sz - dz * sx);
      if (side > t.r + 0.25) continue;
      bt = along;
      best = t;
    }
    // A wall before it?
    const step = 1.5;
    for (let d = step; d < bt; d += step) {
      const x = from.x + sx * d, z = from.z + sz * d;
      if (this.game.world.collide(x, z, 0.15, from.y + Math.tan(pitch) * d).hit) return { x, y: from.y + Math.tan(pitch) * d, z, target: null };
    }
    return { x: from.x + sx * bt, y: from.y + Math.tan(pitch) * bt, z: from.z + sz * bt, target: best };
  }

  // --- throwing (M.10) ----------------------------------------------------------------------

  private launch(holdS: number): { x: number; y: number; z: number; vx: number; vy: number; vz: number } {
    const p = this.game.player;
    const aim = this.game.aimYaw();
    const v = throwVelocity(throwDistance(this.weapon, holdS), GRAVITY);
    return { x: p.x + Math.sin(aim) * 0.5, y: p.y + 1.7, z: p.z + Math.cos(aim) * 0.5, vx: Math.sin(aim) * v.h, vy: v.up, vz: Math.cos(aim) * v.h };
  }

  private previewThrow(): void {
    const l = this.launch(this.holdT);
    this.game.player.a = this.game.aimYaw();
    this.effects.showArc({ x: l.x, y: l.y, z: l.z }, l.vx, l.vy, l.vz, GRAVITY, this.game.player.y);
  }

  private throwIt(holdS: number): void {
    const w = this.weapon;
    if (!spend(this.inv, w.id)) return;
    this.cd = w.cooldown;
    this.game.player.swing();
    const l = this.launch(holdS);
    const used = new Set(this.thrown.map((t) => t.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    if (slot >= 8) return;
    this.thrown.push({ w, ...l, fuse: -1, slot });
  }

  private updateThrown(dt: number): void {
    const g = this.game;
    for (const t of [...this.thrown]) {
      if (t.fuse >= 0) {
        // A firecracker on the ground, fizzing.
        t.fuse -= dt;
        if (Math.random() < 0.5) this.effects.flash(t.x, t.y + 0.15, t.z, 0.06, 0xffe08a);
        if (t.fuse <= 0) {
          this.blast(t.x, t.y, t.z, t.w.radius ?? 4, t.w.damage, t.w.carDamage, 'cracker');
          this.drop(t);
        }
        continue;
      }
      t.vy -= GRAVITY * dt;
      const nx = t.x + t.vx * dt, nz = t.z + t.vz * dt, ny = t.y + t.vy * dt;
      const ground = g.world.heightAt(nx, nz, t.y);
      const wall = g.world.collide(nx, nz, 0.12, ny).hit;
      t.x = nx;
      t.z = nz;
      t.y = ny;
      this.effects.thing(t.slot, t, t.w.id === 'balloon' ? 0x4fa8e8 : t.w.id === 'tomato' ? 0xd8342c : 0xd13b32);
      if (ny > ground && !wall) continue;
      t.y = Math.max(ny, ground);
      if (t.w.id === 'cracker') {
        t.fuse = 0.8;
        t.vx = t.vz = t.vy = 0;
        continue;
      }
      this.splash(t);
      this.drop(t);
    }
  }

  private drop(t: Thrown): void {
    this.effects.thing(t.slot, null);
    this.thrown.splice(this.thrown.indexOf(t), 1);
  }

  /** A balloon or tomato lands: a splat, people run, friends in range get a wet or red screen. */
  private splash(t: Thrown): void {
    const g = this.game;
    const r = t.w.radius ?? 2;
    this.effects.splat(t.x, t.y, t.z, r * 0.6, SPLAT_COLOUR[t.w.id] ?? 0xffffff);
    sound.thud(0.15);
    g.life.peds.scare(t.x, t.z, r + 4);
    for (const f of this.friends()) {
      if (f.type === 'foot' && Math.hypot(f.x - t.x, f.z - t.z) < r && this.canHitFriend(f.id)) {
        this.pendingHits.push({ to: f.id, d: 0, k: t.w.id });
        this.onHitMark();
      }
    }
    // Ourselves too, if we threw it at our feet.
    if (Math.hypot(g.player.x - t.x, g.player.z - t.z) < r && !g.car) this.onHurt(null, t.w.id);
  }

  /** A blast: damage falls off with distance; people knocked over, vehicles damaged, traffic swerves. */
  blast(x: number, y: number, z: number, radius: number, damage: number, carDamage: number, cause: 'cracker' | 'wreck'): void {
    const g = this.game;
    this.effects.blast(x, y, z, radius);
    sound.thud(1);
    const me = g.car ?? g.player;
    const dm = Math.hypot(me.x - x, me.z - z);
    if (dm < 30) {
      g.shake(Math.max(0.15, 0.6 * (1 - dm / 30)));
      buzz(60);
    }
    g.chaos.add(CHAOS.boom, 'Boom');
    g.life.peds.scare(x, z, radius * 3);
    for (const t of this.targets(x, z, radius)) {
      const d = this.reach(t, x, z);
      if (d > radius) continue;
      const k = 1 - d / radius;
      if (t.kind === 'friend' && !this.canHitFriend(t.friend!.id)) continue;
      const fake: Weapon = { ...WEAPONS.cracker, damage: damage * k, carDamage: carDamage * k };
      this.hit(t, damage * k, fake, { x, z }, cause === 'cracker' ? 'cracker' : 'blast');
    }
    // Traffic swerves away.
    for (const c of g.life.traffic.cars) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < 14 && d > 0.1) c.shove(((c.x - x) / d) * 2.5, ((c.z - z) / d) * 2.5);
    }
    // Us.
    if (dm < radius + 0.5) this.hurt(damage * (1 - dm / (radius + 0.5)), { x, z });
  }

  // --- what a hit does ----------------------------------------------------------------------

  private hit(t: Target, damage: number, w: Weapon, from: { x: number; z: number }, kind: WeaponId | 'blast' = w.id): void {
    const g = this.game;
    switch (t.kind) {
      case 'ped':
        g.life.peds.knock(t.ped!, from.x, from.z);
        if (g.life.crime(1, from)) g.toast('Attacking people brings the police', 'bad');
        g.chaos.add(CHAOS.hit, 'Hit');
        break;
      case 'officer':
        this.officers.hit(t.officer!, damage);
        g.life.crime(2, from);
        g.chaos.add(CHAOS.hit, 'Hit a cop');
        break;
      case 'friend': {
        const f = t.friend!;
        this.pendingHits.push({ to: f.id, d: Math.round(damage), k: kind });
        this.onHitMark();
        this.onStun(f.id);
        break;
      }
      case 'traffic':
      case 'cop':
        this.damageAgent(t.agent!, w.carDamage, t.kind === 'cop');
        g.life.crime(t.kind === 'cop' ? 2 : 1, from);
        break;
      case 'parked':
        this.damageVehicle(t, w.carDamage, true);
        break;
    }
  }

  // --- vehicle damage (M.12) ----------------------------------------------------------------

  private damageAgent(a: Agent, n: number, cop: boolean): void {
    if (n <= 0 || a.blown) return;
    if (a.wreck > 0) {
      // Already wrecked: one more hit and it blows up.
      a.blown = true;
      setDamageLook(a.mesh, 0, true);
      this.blast(a.x, a.y, a.z, WRECK_BLAST.radius, WRECK_BLAST.damage, WRECK_BLAST.damage, 'wreck');
      return;
    }
    a.hp = Math.max(0, a.hp - n);
    setDamageLook(a.mesh, a.hp);
    if (a.hp <= 0) {
      a.wreck = 0.001;
      this.game.chaos.add(CHAOS.wreck, cop ? 'Cop car wrecked' : 'Wrecked');
      if (cop) this.game.life.crime(1, a);
    }
  }

  /** Damage a drivable vehicle (yours, parked, borrowed). `byUs`: our attack (not a crash). */
  damageVehicle(t: Target, n: number, byUs: boolean): void {
    const g = this.game;
    const v = t.vehicle!;
    if (n <= 0 || v.blown) return;
    const i = g.shared.indexOf(v);
    if (v.wreck > 0) {
      if (!byUs && v !== g.car) return;
      v.blown = true;
      setDamageLook(v.mesh, 0, true);
      this.blast(v.x, v.y, v.z, WRECK_BLAST.radius, WRECK_BLAST.damage, WRECK_BLAST.damage, 'wreck');
      if (i >= 0) this.onSharedWreck(i, true);
      if (v === g.car) g.ejectFromWreck();
      return;
    }
    v.hp = Math.max(0, v.hp - n);
    setDamageLook(v.mesh, v.hp);
    if (v.hp <= 0) {
      v.wreck = 0.001;
      v.speed *= 0.5;
      g.chaos.add(CHAOS.wreck, 'Wrecked');
      if (i >= 0) this.onSharedWreck(i, false);
      if (v === g.car) g.toast('Your vehicle is wrecked! Get out before it blows', 'bad');
    }
  }

  /** Our own vehicle crashed: damage by how hard. */
  crash(v: Vehicle): void {
    if (v.impact <= 0) return;
    const n = crashDamage(v.impact, v.t.mass);
    if (n > 0.5) this.damageVehicle({ kind: 'parked', x: v.x, y: v.y, z: v.z, r: 1, vehicle: v }, n, false);
  }

  /** Smoke and fire from damaged vehicles near you; wrecked shared vehicles come home. */
  private updateVehicles(dt: number): void {
    const g = this.game;
    this.smokeT += dt;
    if (this.smokeT < 0.12) return;
    const step = this.smokeT;
    this.smokeT = 0;
    const me = g.car ?? g.player;
    const puff = (b: { x: number; y: number; z: number; hp: number; wreck: number; blown: boolean; type: VehicleType }): void => {
      if (b.hp >= 50 || Math.abs(b.x - me.x) > 120 || Math.abs(b.z - me.z) > 120) return;
      const t = VEHICLES[b.type];
      const y = b.y + t.roof * 0.8;
      if (b.wreck > 0 && !b.blown) this.effects.puff(b.x, y, b.z, 'fire', 0.45);
      this.effects.puff(b.x + (Math.random() - 0.5), y + 0.2, b.z + (Math.random() - 0.5), b.blown || b.hp < 25 ? 'dark' : 'smoke', 0.4);
    };
    for (const v of g.vehicles) {
      if (v.wreck > 0) v.wreck += step;
      if (v.mesh.visible) puff(v);
    }
    for (const c of g.life.traffic.cars) puff(c);
    for (const c of g.life.cops.cops) puff(c);
    // Burning wrecks blow up by themselves after a while.
    for (const c of [...g.life.traffic.cars, ...g.life.cops.cops]) if (c.wreck > 8 && !c.blown) this.damageAgent(c, 1, false);
    // Burnt-out traffic is cleared once you are far away (cops tidy their own).
    for (const c of [...g.life.traffic.cars]) if (c.blown && c.wreck > 25 && Math.hypot(c.x - me.x, c.z - me.z) > 120) g.life.traffic.remove(c);
    for (const v of g.vehicles) {
      if (v.wreck > 8 && !v.blown && v !== g.car) this.damageVehicle({ kind: 'parked', x: v.x, y: v.y, z: v.z, r: 1, vehicle: v }, 1, true);
    }
    // Wrecked shared vehicles come back where they live (on every screen, from the same timer).
    for (const v of g.shared) if (v.wreck * 1000 > WRECK_BACK_MS && v !== g.car) g.repairHome(v);
  }

  // --- cops on foot (M.11) ------------------------------------------------------------------

  private updateOfficers(dt: number): void {
    const g = this.game;
    const p = g.player;
    const res = this.officers.update(dt, g.life.cops, {
      x: (g.car ?? p).x,
      y: p.y,
      z: (g.car ?? p).z,
      speed: g.car ? g.car.speed : p.speed,
      onFoot: !g.car && !g.ride && !this.down,
      crouched: p.crouched,
      rolling: p.rolling,
    });
    for (const s of res.shots) {
      const tx = p.x + (s.hit ? 0 : (Math.random() - 0.5) * 3), tz = p.z + (s.hit ? 0 : (Math.random() - 0.5) * 3);
      this.effects.flash(s.from.x, s.from.y, s.from.z, 0.14);
      this.effects.tracer(s.from.x, s.from.y, s.from.z, tx, p.y + 1.1, tz, 0xff8a7a);
      sound.thud(0.2);
      if (s.hit) this.hurt(s.damage, s.from);
    }
    if (res.busted) g.bustedOnFoot();
  }

  /** A friend's hit arrived (from their state message). */
  takeFriendHit(from: { x: number; z: number } | null, d: number, k: string): void {
    const splash = k === 'balloon' || k === 'tomato' ? (k as WeaponId) : null;
    this.hurt(splash ? 0 : Math.min(60, Math.max(0, d)), from, splash);
  }

  /** A friend fired: draw their tracer from their hand (no hit; their screen decides hits). */
  friendShot(x: number, y: number, z: number, a: number): void {
    const mx = x + Math.sin(a) * 0.6, mz = z + Math.cos(a) * 0.6;
    this.effects.flash(mx, y + 1.35, mz, 0.15);
    this.effects.tracer(mx, y + 1.35, mz, x + Math.sin(a) * 30, y + 1.3, z + Math.cos(a) * 30);
  }
}

function angDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
