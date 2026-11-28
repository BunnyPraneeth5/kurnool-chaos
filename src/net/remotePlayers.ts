import * as THREE from 'three';
import { OnFootPlayer } from '../player/onFoot';
import { buildVehicleMesh, seatedFigure, setDamageLook, setRider } from '../vehicles/models';
import { decodeActs } from './acts';
import { VEHICLES, vehicleColour, type VehicleType } from '../vehicles/params';
import type { Bumper } from '../vehicles/hull';
import type { Vehicle } from '../vehicles/vehicle';
import { setPoliceLook } from '../modes/visuals';
import { SnapshotBuffer, STALE_MS, interpDelayMs, type NetState, type Pose } from './interp';
import { cssColour, playerColour, type PlayerInfo } from './roomTypes';

// Friends in the room: interpolated car or on-foot figure plus a name tag.
// Parked cars sit on the same spots on every screen, so when a friend drives
// parked car k we hide our copy of it, draw theirs in its colour, and leave it
// where they park it.

const TAG_RANGE = 300; // m
const TAG_HEIGHT_FOOT = 2.5;
const TAG_ABOVE_ROOF = 0.65;
const BUBBLE_MS = 4500;

/** The colour parked vehicle `index` was built with (see spawnParkedVehicles). */
function sharedColour(parked: readonly Vehicle[], index: number): number {
  const type = parked[index].type;
  return vehicleColour(type, type === 'car' ? index : parked.slice(0, index).filter((p) => p.type === type).length);
}

interface View {
  info: PlayerInfo;
  buf: SnapshotBuffer;
  figure: OnFootPlayer;
  car: THREE.Object3D | null;
  /** -1 on foot, k = driving our parked vehicle k, -2 = another vehicle */
  carIndex: number;
  carType: VehicleType | null;
  tag: HTMLDivElement;
  nick: HTMLSpanElement;
  bubble: HTMLSpanElement;
  bubbleUntil: number;
  blocked: boolean;
  police: boolean;
  last: Pose | null;
  /** Riding: the seated figure in the driver's vehicle. */
  seated: { obj: THREE.Object3D; host: THREE.Object3D; type: VehicleType; seat: number } | null;
  /** Their gun was firing in the last pose (draw a tracer when it starts again). */
  firing: boolean;
}

export class RemotePlayers {
  private readonly views = new Map<string, View>();
  /** Snapshots that arrived before the sender's presence did. */
  private readonly early = new Map<string, SnapshotBuffer>();
  /** Where friends' vehicles are drawn this frame; you bounce off these. */
  readonly carColliders: Bumper[] = [];
  private readonly v3 = new THREE.Vector3();
  /** A friend fired a gun (task M.9): draw their tracer. */
  onShot: (x: number, y: number, z: number, a: number) => void = () => {};

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly myId: string,
    private readonly parked: readonly Vehicle[],
    private readonly myCar: () => Vehicle | null,
  ) {}

  setPlayers(list: PlayerInfo[]): void {
    const ids = new Set<string>();
    for (const p of list) {
      if (p.id === this.myId) continue;
      ids.add(p.id);
      const v = this.views.get(p.id);
      if (v) {
        v.info = p;
        v.nick.textContent = p.nick;
        v.nick.style.borderLeft = `4px solid ${cssColour(playerColour(p.slot))}`;
      } else {
        this.views.set(p.id, this.makeView(p));
      }
    }
    for (const [id, v] of this.views) if (!ids.has(id)) this.remove(id, v);
  }

  push(s: NetState, recvMs: number): void {
    const v = this.views.get(s.id);
    if (v) {
      v.buf.push(s, recvMs);
      return;
    }
    let b = this.early.get(s.id);
    if (!b) {
      if (this.early.size > 16) this.early.clear();
      this.early.set(s.id, (b = new SnapshotBuffer()));
    }
    b.push(s, recvMs);
  }

  /** Hide a player on this screen only: no model, no tag, not solid. */
  setBlocked(id: string, blocked: boolean): void {
    const v = this.views.get(id);
    if (!v) return;
    v.blocked = blocked;
    if (blocked) {
      this.setCar(v, -1, null);
      this.hide(v);
    }
  }

  /** Speech bubble over a friend's name tag (chat line or emote). */
  say(id: string, text: string, nowMs: number): void {
    const v = this.views.get(id);
    if (!v || v.blocked) return;
    v.bubble.textContent = text;
    v.bubbleUntil = nowMs + BUBBLE_MS;
  }

  /** Game rounds: police light bar on their car and a police name tag. */
  setPolice(id: string, on: boolean): void {
    const v = this.views.get(id);
    if (!v || v.police === on) return;
    v.police = on;
    setPoliceLook(v.car, on);
    v.nick.classList.toggle('police', on);
  }

  /** Where a friend is (even if blocked), for game rules; null if not seen for a while. */
  posOf(id: string): { x: number; z: number } | null {
    const v = this.views.get(id);
    if (!v || !v.last || performance.now() - v.buf.lastRecv > STALE_MS) return null;
    return { x: v.last.x, z: v.last.z };
  }

  /** Friends drawn on this screen, on foot or driving (not riding): what you can hit. */
  bodies(): { id: string; x: number; y: number; z: number; type: 'foot' | VehicleType; a: number }[] {
    const out: { id: string; x: number; y: number; z: number; type: 'foot' | VehicleType; a: number }[] = [];
    const now = performance.now();
    for (const v of this.views.values()) {
      const p = v.last;
      if (v.blocked || !p || p.mode === 'ride' || now - v.buf.lastRecv > STALE_MS) continue;
      if (p.mode === 'foot' && decodeActs(p.a ?? 0).down) continue;
      out.push({ id: v.info.id, x: p.x, y: p.y, z: p.z, type: p.mode, a: p.h });
    }
    return out;
  }

  /** Where a friend is drawn right now, or null if we cannot see them. */
  poseOf(id: string): Pose | null {
    const v = this.views.get(id);
    if (!v || v.blocked || performance.now() - v.buf.lastRecv > STALE_MS) return null;
    return v.last;
  }

  update(dt: number, nowMs: number, playerCount: number): void {
    const delay = interpDelayMs(playerCount);
    this.carColliders.length = 0;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const v of this.views.values()) {
      if (v.blocked) continue;
      v.bubble.hidden = nowMs > v.bubbleUntil;
      const stale = nowMs - v.buf.lastRecv > STALE_MS;
      const pose = stale ? null : v.buf.sample(nowMs, delay);
      if (!pose) {
        this.hide(v);
        continue;
      }
      if (pose.mode === 'ride') {
        // Sitting in a friend's vehicle (or ours): drawn in its seat, tag above it.
        this.setCar(v, -1, null);
        v.figure.figure.visible = false;
        const host = this.vehicleOf(pose.ride ?? '');
        this.sit(v, host, pose.seat ?? 1);
        v.last = pose;
        if (host) {
          host.mesh.getWorldPosition(this.v3);
          this.placeTag(v, { ...pose, x: this.v3.x, y: this.v3.y, z: this.v3.z }, w, h, VEHICLES[host.type].roof + TAG_ABOVE_ROOF + 0.4);
        } else v.tag.hidden = true;
        continue;
      }
      this.sit(v, null, 0);
      // -1 on foot, k = our parked vehicle k, -2 = some other vehicle.
      this.setCar(v, pose.mode === 'foot' ? -1 : pose.car >= 0 ? pose.car : -2, pose);
      if (pose.mode !== 'foot' && v.car) {
        v.figure.figure.visible = false;
        v.car.visible = true;
        v.car.position.set(pose.x, pose.y, pose.z);
        v.car.rotation.y = pose.h;
        // Their vehicle's damage (task M.12).
        const vd = pose.vd ?? 100;
        setDamageLook(v.car, vd, vd < 0);
        this.carColliders.push({ x: pose.x, z: pose.z, a: pose.h, type: pose.mode, id: v.info.id });
      } else {
        if (v.car) v.car.visible = false;
        const f = v.figure;
        f.figure.visible = true;
        f.x = pose.x;
        f.z = pose.z;
        f.y = pose.y;
        f.a = pose.h;
        const acts = decodeActs(pose.a ?? 0);
        f.setActs(acts);
        f.animate(dt, pose.v);
        f.sync();
        if (acts.fire && !v.firing) this.onShot(f.x, f.y, f.z, f.a);
        v.firing = acts.fire;
      }
      v.last = pose;
      this.placeTag(v, pose, w, h);
    }
  }

  // --- internals ---

  /** The vehicle a player is driving as drawn here: our own, or a friend's model. */
  private vehicleOf(id: string): { mesh: THREE.Object3D; type: VehicleType } | null {
    if (id === this.myId) {
      const c = this.myCar();
      return c ? { mesh: c.mesh, type: c.type } : null;
    }
    const d = this.views.get(id);
    return d && d.car && d.carType && d.car.visible ? { mesh: d.car, type: d.carType } : null;
  }

  /** Put a riding friend's figure in their seat (or take it out with host null). */
  private sit(v: View, host: { mesh: THREE.Object3D; type: VehicleType } | null, seat: number): void {
    const s = v.seated;
    if (s && host && s.host === host.mesh && s.type === host.type && s.seat === seat && s.obj.parent === host.mesh) return;
    if (s) {
      s.obj.removeFromParent();
      v.seated = null;
    }
    if (!host) return;
    const obj = seatedFigure(host.type, seat, playerColour(v.info.slot));
    host.mesh.add(obj);
    v.seated = { obj, host: host.mesh, type: host.type, seat };
  }

  /** Riders in a player's vehicle as seen here (seat numbers). */
  seatsTaken(driver: string, except: string): number[] {
    const out: number[] = [];
    for (const v of this.views.values()) {
      if (v.info.id === except || !v.last || v.last.mode !== 'ride' || v.last.ride !== driver) continue;
      if (performance.now() - v.buf.lastRecv > STALE_MS) continue;
      out.push(v.last.seat ?? 1);
    }
    return out;
  }

  /** Who else claims this seat, and when they joined (the earlier joiner keeps it). */
  seatRivals(driver: string, seat: number, except: string): PlayerInfo[] {
    const out: PlayerInfo[] = [];
    for (const v of this.views.values()) {
      if (v.info.id !== except && v.last?.mode === 'ride' && v.last.ride === driver && v.last.seat === seat && performance.now() - v.buf.lastRecv < STALE_MS) out.push(v.info);
    }
    return out;
  }

  private makeView(p: PlayerInfo): View {
    const figure = new OnFootPlayer(0, 0, 0, playerColour(p.slot));
    figure.figure.visible = false;
    this.scene.add(figure.figure);
    const tag = document.createElement('div');
    tag.className = 'nametag';
    const bubble = document.createElement('span');
    bubble.className = 'bubble';
    bubble.hidden = true;
    const nick = document.createElement('span');
    nick.className = 'nick';
    nick.textContent = p.nick;
    nick.style.borderLeft = `4px solid ${cssColour(playerColour(p.slot))}`;
    tag.append(bubble, nick);
    tag.hidden = true;
    document.body.append(tag);
    const buf = this.early.get(p.id) ?? new SnapshotBuffer();
    this.early.delete(p.id);
    return { info: p, buf, figure, car: null, carIndex: -1, carType: null, tag, nick, bubble, bubbleUntil: 0, blocked: false, police: false, last: null, seated: null, firing: false };
  }

  /** Switch which parked car (if any) this friend is driving. */
  private setCar(v: View, index: number, pose: Pose | null): void {
    const type = index === -1 || !pose || pose.mode === 'foot' || pose.mode === 'ride' ? null : pose.mode;
    if (index === v.carIndex && type === v.carType) return;
    // Leaving car k: our copy of it now stands where they left it.
    const old = this.parked[v.carIndex];
    if (old) {
      if (old !== this.myCar() && v.last && v.last.mode !== 'foot') {
        old.x = v.last.x;
        old.z = v.last.z;
        old.a = old.va = v.last.h;
        const vd = v.last.vd ?? 100;
        old.hp = Math.max(0, vd);
        old.blown = vd < 0;
        if (old.hp <= 0 && old.wreck <= 0) old.wreck = 0.001;
        setDamageLook(old.mesh, old.hp, old.blown);
        old.sync();
      }
      old.mesh.visible = true;
    }
    if (v.car) {
      this.scene.remove(v.car);
      v.car = null;
    }
    v.carIndex = index;
    v.carType = type;
    if (!type) return;
    // A shared vehicle keeps its own colour; any other car is drawn in the friend's colour.
    const shared = this.parked[index];
    const colour = shared ? sharedColour(this.parked, index) : playerColour(v.info.slot);
    v.car = buildVehicleMesh(type, colour);
    setRider(v.car, playerColour(v.info.slot));
    setPoliceLook(v.car, v.police);
    this.scene.add(v.car);
    if (shared && shared !== this.myCar()) shared.mesh.visible = false;
  }

  private hide(v: View): void {
    this.sit(v, null, 0);
    v.figure.figure.visible = false;
    if (v.car) v.car.visible = false;
    v.tag.hidden = true;
  }

  private remove(id: string, v: View): void {
    this.sit(v, null, 0);
    this.setCar(v, -1, null);
    this.scene.remove(v.figure.figure);
    v.tag.remove();
    this.views.delete(id);
  }

  private placeTag(v: View, pose: Pose, w: number, h: number, above?: number): void {
    const lift = above ?? (pose.mode === 'foot' || pose.mode === 'ride' ? TAG_HEIGHT_FOOT : VEHICLES[pose.mode].roof + TAG_ABOVE_ROOF);
    const p = this.v3.set(pose.x, pose.y + lift, pose.z);
    const dist = p.distanceTo(this.camera.position);
    p.project(this.camera);
    if (p.z > 1 || dist > TAG_RANGE || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2) {
      v.tag.hidden = true;
      return;
    }
    v.tag.hidden = false;
    const sx = ((p.x + 1) / 2) * w;
    const sy = ((1 - p.y) / 2) * h;
    v.tag.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
  }
}
