import * as THREE from 'three';
import { OnFootPlayer } from '../player/onFoot';
import { buildCarMesh } from '../vehicles/carModel';
import { CAR_COLOURS, VEHICLES } from '../vehicles/params';
import type { Vehicle } from '../vehicles/vehicle';
import { SnapshotBuffer, STALE_MS, interpDelayMs, type NetState, type Pose } from './interp';
import { cssColour, playerColour, type PlayerInfo } from './roomTypes';

// Friends in the room: interpolated car or on-foot figure plus a name tag.
// Parked cars sit on the same spots on every screen, so when a friend drives
// parked car k we hide our copy of it, draw theirs in its colour, and leave it
// where they park it.

const TAG_RANGE = 300; // m
const TAG_HEIGHT_FOOT = 2.5;
const TAG_HEIGHT_CAR = 2.3;

interface View {
  info: PlayerInfo;
  buf: SnapshotBuffer;
  figure: OnFootPlayer;
  car: THREE.Object3D | null;
  /** -1 on foot, k = driving our parked car k, -2 = another car */
  carIndex: number;
  tag: HTMLDivElement;
  last: Pose | null;
}

export class RemotePlayers {
  private readonly views = new Map<string, View>();
  /** Snapshots that arrived before the sender's presence did. */
  private readonly early = new Map<string, SnapshotBuffer>();
  /** Where friends' cars are drawn this frame; you bounce off these. */
  readonly carColliders: { x: number; z: number }[] = [];
  private readonly v3 = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly myId: string,
    private readonly parked: Vehicle[],
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
        v.tag.textContent = p.nick;
        v.tag.style.borderLeft = `4px solid ${cssColour(playerColour(p.slot))}`;
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

  update(dt: number, nowMs: number, playerCount: number): void {
    const delay = interpDelayMs(playerCount);
    this.carColliders.length = 0;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const v of this.views.values()) {
      const stale = nowMs - v.buf.lastRecv > STALE_MS;
      const pose = stale ? null : v.buf.sample(nowMs, delay);
      if (!pose) {
        this.hide(v);
        continue;
      }
      // -1 on foot, k = our parked car k, -2 = some other car (drawn in their colour).
      this.setCar(v, pose.mode === 'car' ? (pose.car >= 0 ? pose.car : -2) : -1, pose);
      if (pose.mode === 'car' && v.car) {
        v.figure.figure.visible = false;
        v.car.visible = true;
        v.car.position.set(pose.x, pose.y, pose.z);
        v.car.rotation.y = pose.h;
        this.carColliders.push({ x: pose.x, z: pose.z });
      } else {
        if (v.car) v.car.visible = false;
        const f = v.figure;
        f.figure.visible = true;
        f.x = pose.x;
        f.z = pose.z;
        f.y = pose.y;
        f.a = pose.h;
        f.animate(dt, pose.v);
        f.sync();
      }
      v.last = pose;
      this.placeTag(v, pose, w, h);
    }
  }

  // --- internals ---

  private makeView(p: PlayerInfo): View {
    const figure = new OnFootPlayer(0, 0, 0, playerColour(p.slot));
    figure.figure.visible = false;
    this.scene.add(figure.figure);
    const tag = document.createElement('div');
    tag.className = 'nametag';
    tag.textContent = p.nick;
    tag.style.borderLeft = `4px solid ${cssColour(playerColour(p.slot))}`;
    tag.hidden = true;
    document.body.append(tag);
    const buf = this.early.get(p.id) ?? new SnapshotBuffer();
    this.early.delete(p.id);
    return { info: p, buf, figure, car: null, carIndex: -1, tag, last: null };
  }

  /** Switch which parked car (if any) this friend is driving. */
  private setCar(v: View, index: number, pose: Pose | null): void {
    if (index === v.carIndex) return;
    // Leaving car k: our copy of it now stands where they left it.
    const old = this.parked[v.carIndex];
    if (old) {
      if (old !== this.myCar() && v.last && v.last.mode === 'car') {
        old.x = v.last.x;
        old.z = v.last.z;
        old.a = old.va = v.last.h;
        old.sync();
      }
      old.mesh.visible = true;
    }
    if (v.car) {
      this.scene.remove(v.car);
      v.car = null;
    }
    v.carIndex = index;
    if (index === -1 || !pose) return;
    const colour = index >= 0 ? CAR_COLOURS[index % CAR_COLOURS.length] : playerColour(v.info.slot);
    v.car = buildCarMesh(VEHICLES.car, colour);
    this.scene.add(v.car);
    const mine = this.parked[index];
    if (mine && mine !== this.myCar()) mine.mesh.visible = false;
  }

  private hide(v: View): void {
    v.figure.figure.visible = false;
    if (v.car) v.car.visible = false;
    v.tag.hidden = true;
  }

  private remove(id: string, v: View): void {
    this.setCar(v, -1, null);
    this.scene.remove(v.figure.figure);
    v.tag.remove();
    this.views.delete(id);
  }

  private placeTag(v: View, pose: Pose, w: number, h: number): void {
    const p = this.v3.set(pose.x, pose.y + (pose.mode === 'car' ? TAG_HEIGHT_CAR : TAG_HEIGHT_FOOT), pose.z);
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
