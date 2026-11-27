import type * as THREE from 'three';
import type { CollisionWorld } from '../map/collision';
import { VEHICLES, vehicleColour, type VehicleType } from '../vehicles/params';
import { overlap, type Bumper } from '../vehicles/hull';
import { Agent, angDiff } from './agent';
import type { Arc, RoadGraph } from './graph';

// Local traffic (TASKS 5.2): vehicles on the road graph around the player, keeping left,
// stopping for whatever is ahead and squeezing through after 5 s stuck (the demo's rule).
// Each player has their own traffic; it is not synced.

const SPAWN_MIN = 120; // m from the player, so vehicles do not pop up in front of them
const SPAWN_MIN_FIRST = 30; // the first fill may be closer
const SPAWN_MAX = 300;
const DESPAWN = 360;
const SPACE = 16; // m clear around a new vehicle
const STUCK_S = 5;
const GHOST_S = 2.5;
const SWERVE_M = 1.8;
const BIG_ROAD_W = 9; // buses and lorries keep to roads at least this wide

const CRUISE: Record<string, number> = { trunk: 13, primary: 12, secondary: 11, tertiary: 9, residential: 7, unclassified: 7, living_street: 5, service: 5 };
const MIX: [VehicleType, number][] = [['auto', 0.3], ['bike', 0.32], ['car', 0.28], ['bus', 0.05], ['lorry', 0.05]];
const SPEED_FACTOR: Record<VehicleType, number> = { car: 1, auto: 0.8, bike: 1.05, bus: 0.8, lorry: 0.75 };

/** Something traffic stops for. `still` = a parked vehicle it can steer around. */
export interface Obstacle {
  body: Bumper;
  still?: boolean;
}

export class TrafficCar extends Agent {
  arc!: Arc;
  stuck = 0;
  /** seconds left of squeezing past (not solid, ignores what is ahead) */
  ghost = 0;
}

export class Traffic {
  readonly cars: TrafficCar[] = [];
  private first = true;
  private spawnWait = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly graph: RoadGraph,
    private readonly world: CollisionWorld,
    private readonly count: number,
    private readonly shadows: boolean,
  ) {}

  /** Vehicles you collide with (not the ones squeezing past). */
  solid(): TrafficCar[] {
    return this.cars.filter((c) => c.ghost <= 0);
  }

  /** Take a vehicle out of traffic (the player got in). */
  remove(car: TrafficCar): void {
    const i = this.cars.indexOf(car);
    if (i < 0) return;
    this.cars.splice(i, 1);
    this.scene.remove(car.mesh);
    if (car.mesh.children[0]) disposeShadow(car.mesh);
  }

  /** Clear the road around a spot (a game round puts a player there). */
  clearNear(x: number, z: number, r: number): void {
    for (const c of [...this.cars]) if (Math.hypot(c.x - x, c.z - z) < r) this.remove(c);
  }

  update(dt: number, focus: { x: number; z: number }, others: readonly Obstacle[]): void {
    for (const c of [...this.cars]) if (Math.hypot(c.x - focus.x, c.z - focus.z) > DESPAWN) this.remove(c);
    // A jump (teleport, round start) empties the area: fill it again from close in.
    if (this.cars.length === 0) this.first = true;
    this.spawnWait -= dt;
    if (this.cars.length < this.count && (this.first || this.spawnWait <= 0)) {
      const tries = this.first ? this.count * 8 : 4;
      for (let i = 0; i < tries && this.cars.length < this.count; i++) this.trySpawn(focus, this.first ? SPAWN_MIN_FIRST : SPAWN_MIN, others);
      this.first = false;
      this.spawnWait = 0.25;
    }
    for (const c of [...this.cars]) this.drive(c, dt, others);
  }

  private drive(c: TrafficCar, dt: number, others: readonly Obstacle[]): void {
    const t = VEHICLES[c.type];
    c.ghost = Math.max(0, c.ghost - dt);
    const road = this.graph.map.roads[c.arc.road];
    let target = (CRUISE[road.kind] ?? CRUISE[road.kind.replace('_link', '')] ?? 8) * SPEED_FACTOR[c.type];
    // Slow for a bend.
    const next = c.path[0];
    if (next) {
      const bend = Math.abs(angDiff(Math.atan2(next[0] - c.px, next[1] - c.pz), c.a));
      if (bend > 0.5) target = Math.min(target, 4.5);
    }
    // Look ahead.
    const sa = Math.sin(c.a);
    const ca = Math.cos(c.a);
    let gap = Infinity;
    let swerve = 0;
    if (c.ghost <= 0) {
      const look = (o: Bumper, still: boolean): void => {
        const dx = o.x - c.x;
        const dz = o.z - c.z;
        if (Math.abs(dx) > 32 || Math.abs(dz) > 32) return;
        const ot = VEHICLES[o.type];
        for (const off of ot.circles) {
          const ex = dx + Math.sin(o.a) * off;
          const ez = dz + Math.cos(o.a) * off;
          const fw = ex * sa + ez * ca;
          if (fw <= 0) continue;
          const left = ex * ca - ez * sa;
          const clear = t.w / 2 + ot.radius + 0.15;
          // A parked vehicle in our lane: steer right, round it.
          if (still && fw < 22 && Math.abs(left - c.side) < clear) swerve = SWERVE_M;
          if (Math.abs(left) >= clear) continue;
          gap = Math.min(gap, fw - t.len / 2 - ot.radius);
        }
      };
      for (const o of this.cars) if (o !== c && o.ghost <= 0) look(o, false);
      for (const o of others) look(o.body, !!o.still);
    }
    c.side += Math.max(-2.5 * dt, Math.min(2.5 * dt, swerve - c.side));
    if (gap < Infinity) target = Math.min(target, Math.max(0, (gap - 1.5) * 1.1));
    if (target < 0.5 && gap < 4) {
      c.stuck += dt;
      if (c.stuck > STUCK_S) {
        c.ghost = GHOST_S;
        c.stuck = 0;
      }
    } else if (c.speed > 1) c.stuck = 0;
    c.speed += Math.max(-18 * dt, Math.min((t.acc * 0.55) * dt, target - c.speed));
    if (!c.advance(c.speed * dt, () => this.extend(c))) {
      this.remove(c);
      return;
    }
    c.place(dt, this.world);
  }

  /** Pick the next road at the end of this one and add its lane to the path. */
  private extend(c: TrafficCar): boolean {
    const here = c.arc.to;
    const all = this.graph.out[here].filter((a) => a.legal);
    let options = all.filter((a) => a.edge !== c.arc.edge);
    if (options.length === 0) options = all; // dead end: turn round
    if (options.length === 0) return false;
    const big = VEHICLES[c.type].len > 6;
    const weight = (a: Arc): number => {
      const w = this.graph.map.roads[a.road].width;
      return big && w < BIG_ROAD_W ? 0.02 : (w - 3) ** 2;
    };
    let r = Math.random() * options.reduce((s, a) => s + weight(a), 0);
    const arc = options.find((a) => (r -= weight(a)) <= 0) ?? options[options.length - 1];
    c.arc = arc;
    c.path.push(...this.graph.lane(arc));
    return true;
  }

  private trySpawn(focus: { x: number; z: number }, min: number, others: readonly Obstacle[]): void {
    const ang = Math.random() * Math.PI * 2;
    const dist = min + Math.random() * (SPAWN_MAX - min);
    const p = this.graph.nearest(focus.x + Math.sin(ang) * dist, focus.z + Math.cos(ang) * dist, 60);
    if (!p || Math.hypot(p.x - focus.x, p.z - focus.z) < min) return;
    const e = this.graph.map.graph.edges[p.edge];
    const road = this.graph.map.roads[e.road];
    // Mostly the bigger roads.
    if (road.id === -1 || (road.width < 7 && Math.random() < 0.7) || e.len < 12) return;
    let r = Math.random();
    let type = MIX.find(([, share]) => (r -= share) <= 0)?.[0] ?? 'car';
    if (VEHICLES[type].len > 6 && road.width < BIG_ROAD_W) type = 'car';
    const dirs = [...this.graph.out[e.a], ...this.graph.out[e.b]].filter((a) => a.edge === p.edge && a.legal);
    if (!dirs.length) return;
    const arc = dirs[Math.floor(Math.random() * dirs.length)];
    const lane = this.graph.lane(arc);
    const i = Math.floor(Math.random() * (lane.length - 1));
    const f = Math.random();
    const x = lane[i][0] + (lane[i + 1][0] - lane[i][0]) * f;
    const z = lane[i][1] + (lane[i + 1][1] - lane[i][1]) * f;
    const near = (o: { x: number; z: number }): boolean => Math.hypot(o.x - x, o.z - z) < SPACE;
    if (this.cars.some(near) || others.some((o) => near(o.body))) return;
    const heading = Math.atan2(lane[i + 1][0] - lane[i][0], lane[i + 1][1] - lane[i][1]);
    // A flyover's road is up on its deck; everything else starts on the ground.
    const y = this.world.heightAt(x, z, road.lift || road.bridge ? 1e9 : this.world.heightAt(x, z, -1e9) + 0.5);
    const car = new TrafficCar(type, vehicleColour(type, Math.floor(Math.random() * 8)), x, z, heading, y, this.shadows);
    if (others.some((o) => overlap(car, o.body))) return;
    car.arc = arc;
    car.path = lane.slice(i + 1);
    car.speed = 4;
    car.settle(this.world);
    this.cars.push(car);
    this.scene.add(car.mesh);
  }
}

/** The shadow plane is the only geometry a vehicle owns (bodies are shared). */
function disposeShadow(mesh: THREE.Object3D): void {
  for (const child of mesh.children) {
    const m = child as THREE.Mesh;
    if (child.name === '' && m.geometry) m.geometry.dispose();
  }
}
