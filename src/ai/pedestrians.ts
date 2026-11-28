import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CollisionWorld } from '../map/collision';
import type { Pt } from '../map/types';
import { VEHICLES } from '../vehicles/params';
import { hullDistance, type Bumper } from '../vehicles/hull';
import { pointAlong, type Arc, type RoadGraph } from './graph';

// Pedestrians (task H.8): people walking along the road edges around the player (fewer on
// low quality), sometimes crossing at the end of a road. They jump out of the way of anything
// coming at them and are never hurt. Two instanced meshes (shirts tinted, the rest plain),
// so all of them cost two draw calls. Local to each player.

const SPAWN_MIN = 35;
const SPAWN_MAX = 150;
const DESPAWN = 190;
const WALK = 1.3; // m/s
const CROSS_CHANCE = 0.3; // at the end of a road
const DODGE_SPEED = 6;
const SHIRTS = [0xf4efe4, 0x3d8fd6, 0xd13b32, 0x49b08c, 0xf2b33d, 0xb25fc4, 0xf08a5d, 0x7a5cc4, 0xe0c9a6, 0x2f9e5b];

export interface Ped {
  arc: Arc;
  pts: Pt[];
  len: number;
  s: number;
  /** +1 walks on the left of the road (as you face along the arc), -1 on the right */
  side: number;
  /** metres from the road centre */
  off: number;
  speed: number;
  /** crossing: 0..1 progress from one side to the other */
  cross: number;
  crossFrom: number;
  /** dodge push, decays back to the path */
  ex: number;
  ez: number;
  vx: number;
  vz: number;
  x: number;
  z: number;
  y: number;
  a: number;
  phase: number;
  /** seconds left lying down after a hit (task M.8); they are never hurt for good */
  down: number;
  /** seconds left running away, and which way */
  flee: number;
  fx: number;
  fz: number;
}

const FLEE_SPEED = 5;
const KNOCK_DOWN_S = 2.5;

function box(w: number, h: number, d: number, x: number, y: number, z: number, colour?: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  if (colour !== undefined) {
    const c = new THREE.Color(colour);
    const n = g.attributes.position.count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  return g;
}

export class Pedestrians {
  readonly peds: Ped[] = [];
  private readonly shirts: THREE.InstancedMesh;
  private readonly rest: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly lie = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  /** People in the road right now (crossing or dodging): traffic stops for them. */
  readonly inRoad: Bumper[] = [];
  /** Set for a frame when the player drove fast right past someone on the roadside. */
  scared = false;

  constructor(
    scene: THREE.Scene,
    private readonly graph: RoadGraph,
    private readonly world: CollisionWorld,
    private readonly count: number,
  ) {
    const shirtGeo = mergeGeometries([box(0.5, 0.62, 0.3, 0, 1.12, 0), box(0.14, 0.58, 0.16, 0.33, 1.12, 0), box(0.14, 0.58, 0.16, -0.33, 1.12, 0)]);
    const restGeo = mergeGeometries([
      box(0.2, 0.8, 0.22, 0.12, 0.4, 0, 0x2b2a4a),
      box(0.2, 0.8, 0.22, -0.12, 0.4, 0, 0x2b2a4a),
      box(0.32, 0.32, 0.32, 0, 1.62, 0, 0xc68a62),
      box(0.34, 0.1, 0.34, 0, 1.82, 0, 0x241c2e),
    ]);
    if (!shirtGeo || !restGeo) throw new Error('Could not build the pedestrian model');
    this.shirts = new THREE.InstancedMesh(shirtGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), count);
    this.rest = new THREE.InstancedMesh(restGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), count);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) this.shirts.setColorAt(i, c.setHex(SHIRTS[i % SHIRTS.length]));
    for (const mesh of [this.shirts, this.rest]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
    }
  }

  /**
   * One frame. `vehicles` are everything that can come at people (with speeds); `player` is
   * the player's vehicle, if driving (for the heat check).
   */
  update(dt: number, focus: { x: number; z: number }, vehicles: readonly { b: Bumper; speed: number }[], player: { b: Bumper; speed: number } | null): void {
    for (let i = this.peds.length - 1; i >= 0; i--) {
      if (Math.hypot(this.peds[i].x - focus.x, this.peds[i].z - focus.z) > DESPAWN) this.peds.splice(i, 1);
    }
    for (let tries = 0; tries < 6 && this.peds.length < this.count; tries++) this.spawn(focus);
    this.inRoad.length = 0;
    this.scared = false;
    for (const p of this.peds) {
      this.walk(p, dt);
      this.dodge(p, dt, vehicles);
      if (player && Math.abs(player.speed) > 12 && hullDistance(player.b, p.x, p.z).d < 1.6 && p.cross === 0) this.scared = true;
    }
    this.draw(dt);
  }

  /** Knocked over by a hit from (fx, fz): lie down a moment, then get up and run away. */
  knock(p: Ped, fromX: number, fromZ: number): void {
    p.down = KNOCK_DOWN_S;
    this.runFrom(p, fromX, fromZ, 4);
  }

  /** Scared by something at (x, z): run away for a few seconds. */
  runFrom(p: Ped, fromX: number, fromZ: number, seconds = 3): void {
    const dx = p.x - fromX, dz = p.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    p.fx = dx / d;
    p.fz = dz / d;
    p.flee = Math.max(p.flee, seconds);
  }

  /** Everyone within r of (x, z) runs away from it (a blast, a splat, gunfire). */
  scare(x: number, z: number, r: number): void {
    for (const p of this.peds) if (Math.hypot(p.x - x, p.z - z) < r) this.runFrom(p, x, z, 3 + Math.random() * 2);
  }

  /** A driver pulled out of their vehicle (carjack, task M.8): a person at (x, z) running from (ax, az). */
  addRunner(x: number, z: number, ax: number, az: number): void {
    const e = this.graph.nearest(x, z, 60);
    if (!e) return;
    const edge = this.graph.map.graph.edges[e.edge];
    const arc = this.graph.out[edge.a].find((a) => a.edge === e.edge);
    if (!arc) return;
    const p: Ped = { arc, pts: [], len: 0, s: e.along, side: 1, off: 0, speed: WALK, cross: 0, crossFrom: 1, ex: 0, ez: 0, vx: 0, vz: 0, x, z, y: this.world.heightAt(x, z), a: 0, phase: 0, down: 0, flee: 0, fx: 0, fz: 0 };
    this.setArc(p, arc);
    // Start exactly at the door: the path offset makes up the difference, then fades.
    const road = this.graph.map.roads[arc.road];
    const [cx, cz] = pointAlong(p.pts, p.s);
    const [nx, nz] = pointAlong(p.pts, Math.min(p.len, p.s + 1));
    const h = Math.atan2(nx - cx, nz - cz);
    const off = road.width / 2 + 1.2;
    p.ex = x - (cx + Math.cos(h) * off);
    p.ez = z - (cz - Math.sin(h) * off);
    this.runFrom(p, ax, az, 5);
    if (this.peds.length >= this.count) this.peds.shift();
    this.peds.push(p);
  }

  private walk(p: Ped, dt: number): void {
    if (p.down > 0) {
      // Lying where they fell.
      p.down -= dt;
      this.inRoad.push({ x: p.x, z: p.z, a: p.a, type: 'bike' });
      return;
    }
    if (p.flee > 0) {
      p.flee -= dt;
      p.vx = p.fx * FLEE_SPEED;
      p.vz = p.fz * FLEE_SPEED;
    }
    const road = this.graph.map.roads[p.arc.road];
    const hw = road.width / 2;
    if (p.cross > 0) {
      // Crossing straight over the road.
      p.cross += (dt * WALK) / (2 * (hw + 1.2));
      if (p.cross >= 1) {
        p.cross = 0;
        p.side = -p.crossFrom;
        this.nextRoad(p, false);
      }
    } else {
      p.s += p.speed * dt;
      if (p.s >= p.len) this.nextRoad(p, true);
    }
    const s = Math.min(p.s, p.len);
    const [cx, cz] = pointAlong(p.pts, s);
    const [nx, nz] = pointAlong(p.pts, Math.min(p.len, s + 1));
    const heading = Math.atan2(nx - cx, nz - cz);
    const off = hw + 1.2;
    p.off = p.cross > 0 ? off * p.crossFrom * (1 - 2 * p.cross) : off * p.side;
    // Left of forward (sin h, cos h) is (cos h, -sin h).
    const bx = cx + Math.cos(heading) * p.off;
    const bz = cz - Math.sin(heading) * p.off;
    if (p.flee <= 0) {
      p.vx *= Math.max(0, 1 - dt * 3);
      p.vz *= Math.max(0, 1 - dt * 3);
    }
    p.ex += p.vx * dt;
    p.ez += p.vz * dt;
    p.ex -= p.ex * Math.min(1, dt * 0.5);
    p.ez -= p.ez * Math.min(1, dt * 0.5);
    const r = this.world.collide(bx + p.ex, bz + p.ez, 0.35);
    const moving = Math.hypot(r.x - p.x, r.z - p.z);
    if (moving > 0.01) p.a = p.cross > 0 ? heading - (Math.PI / 2) * p.crossFrom : Math.atan2(r.x - p.x, r.z - p.z);
    p.x = r.x;
    p.z = r.z;
    p.y = this.world.heightAt(p.x, p.z, p.y);
    p.phase += moving * (p.flee > 0 ? 9 : 6);
    if (p.cross > 0 || Math.abs(p.off) < hw) this.inRoad.push({ x: p.x, z: p.z, a: p.a, type: 'bike' });
  }

  /** At the end of a road: carry on along another one, sometimes crossing first. */
  private nextRoad(p: Ped, mayCross: boolean): void {
    const outs = this.graph.out[p.arc.to].filter((a) => a.edge !== p.arc.edge && this.walkable(a));
    if (mayCross && Math.random() < CROSS_CHANCE) {
      p.cross = 0.001;
      p.crossFrom = p.side;
      p.s = p.len;
      return;
    }
    const next = outs.length ? outs[Math.floor(Math.random() * outs.length)] : this.graph.out[p.arc.to].find((a) => a.edge === p.arc.edge);
    if (!next) {
      p.s = p.len;
      return;
    }
    this.setArc(p, next);
    p.s = 0;
  }

  private walkable(a: Arc): boolean {
    const r = this.graph.map.roads[a.road];
    return r.id !== -1 && !r.lift && !r.bridge && r.width >= 5 && !/^trunk/.test(r.kind);
  }

  private setArc(p: Ped, arc: Arc): void {
    p.arc = arc;
    p.pts = this.graph.points(arc);
    p.len = this.graph.length(arc.edge);
  }

  /** Jump out of the way of anything coming; never end up inside a vehicle. */
  private dodge(p: Ped, dt: number, vehicles: readonly { b: Bumper; speed: number }[]): void {
    for (const { b, speed } of vehicles) {
      const dx = p.x - b.x, dz = p.z - b.z;
      if (Math.abs(dx) > 14 || Math.abs(dz) > 14) continue;
      const near = hullDistance(b, p.x, p.z);
      if (near.d < 0.45) {
        // Already touching: step clear at once.
        const d = Math.hypot(p.x - near.cx, p.z - near.cz) || 1;
        p.ex += ((p.x - near.cx) / d) * (0.5 - near.d);
        p.ez += ((p.z - near.cz) / d) * (0.5 - near.d);
      }
      if (Math.abs(speed) < 2.5) continue;
      const fx = Math.sin(b.a) * Math.sign(speed), fz = Math.cos(b.a) * Math.sign(speed);
      const fw = dx * fx + dz * fz;
      const lat = dx * fz - dz * fx;
      const reach = Math.min(14, 3 + Math.abs(speed) * 0.7);
      if (fw < 0 || fw > reach || Math.abs(lat) > VEHICLES[b.type].w / 2 + 1.2) continue;
      // Jump sideways, away from the vehicle's line.
      const away = lat >= 0 ? 1 : -1;
      p.vx = fz * away * DODGE_SPEED;
      p.vz = -fx * away * DODGE_SPEED;
    }
    void dt;
  }

  private spawn(focus: { x: number; z: number }): void {
    const ang = Math.random() * Math.PI * 2;
    const dist = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    const e = this.graph.nearest(focus.x + Math.sin(ang) * dist, focus.z + Math.cos(ang) * dist, 40);
    if (!e) return;
    const edge = this.graph.map.graph.edges[e.edge];
    const arc = this.graph.out[edge.a].find((a) => a.edge === e.edge);
    if (!arc || !this.walkable(arc) || Math.hypot(e.x - focus.x, e.z - focus.z) < SPAWN_MIN) return;
    const p: Ped = {
      arc,
      pts: [],
      len: 0,
      s: e.along,
      side: Math.random() < 0.5 ? 1 : -1,
      off: 0,
      speed: WALK * (0.8 + Math.random() * 0.4) * (Math.random() < 0.5 ? 1 : 1),
      cross: 0,
      crossFrom: 1,
      ex: 0,
      ez: 0,
      vx: 0,
      vz: 0,
      x: e.x,
      z: e.z,
      y: this.world.heightAt(e.x, e.z),
      a: 0,
      phase: Math.random() * 6,
      down: 0,
      flee: 0,
      fx: 0,
      fz: 0,
    };
    this.setArc(p, arc);
    // Half of them walk the other way.
    if (Math.random() < 0.5) {
      const back = this.graph.out[edge.b].find((a) => a.edge === e.edge);
      if (back) {
        this.setArc(p, back);
        p.s = p.len - e.along;
      }
    }
    this.peds.push(p);
  }

  private draw(dt: number): void {
    const n = this.peds.length;
    for (let i = 0; i < n; i++) {
      const p = this.peds[i];
      const bob = Math.abs(Math.sin(p.phase)) * 0.06;
      this.q.setFromAxisAngle(this.up, p.a);
      if (p.down > 0) {
        // Lying on their back: tip over round the feet.
        this.q.multiply(this.lie);
        this.m.compose(this.p.set(p.x, p.y + 0.3, p.z), this.q, this.one);
      } else this.m.compose(this.p.set(p.x, p.y + 0.12 + bob, p.z), this.q, this.one);
      this.shirts.setMatrixAt(i, this.m);
      this.rest.setMatrixAt(i, this.m);
    }
    for (const mesh of [this.shirts, this.rest]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    void dt;
  }
}
