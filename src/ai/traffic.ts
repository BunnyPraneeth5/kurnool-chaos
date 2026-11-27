import type * as THREE from 'three';
import type { CollisionWorld } from '../map/collision';
import { VEHICLES, vehicleColour, type VehicleType } from '../vehicles/params';
import { overlap, type Bumper } from '../vehicles/hull';
import { seatedFigure } from '../vehicles/models';
import { Agent, angDiff } from './agent';
import type { Arc, RoadGraph } from './graph';
import { junctionsOf, lightFor } from './junctions';

// Local traffic (TASKS 5.2, H.6, H.7): vehicles on the road graph around the player, keeping
// left, stopping for whatever is ahead and for red lights, squeezing through after 5 s stuck
// (the demo's rule). They honk when held up, overtake slow vehicles on the right on wide
// two-way roads, buses pull in at stops and autos at auto stands. Each player has their own.

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
const PASSENGER_SHIRTS = [0xe8e2d2, 0x3d8fd6, 0xd13b32, 0x49b08c, 0xf2b33d, 0xb25fc4];
const OVERTAKE_ROAD_W = 9; // two-way roads at least this wide
const OVERTAKE_S = 9; // give up after this long
const BUS_STOP_EVERY = 300; // m on main roads
const BUS_STOP_S = 6;
const AUTO_STAND_S = 8;
const HONK_AFTER_S = 1.2;
const HONK_GAP_S = 5;

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
  /** stopped for a red light, or queued behind someone who is (does not count as stuck) */
  waiting = false;
  /** the slow vehicle being overtaken */
  overtaking: TrafficCar | null = null;
  overtakeT = 0;
  /** seconds left pulled in at the kerb (bus stop, auto stand) */
  pulledIn = 0;
  sinceStop = Math.random() * BUS_STOP_EVERY;
  standsDone = new Set<number>();
  blockedT = 0;
  honkCd = 0;
}

export class Traffic {
  readonly cars: TrafficCar[] = [];
  private first = true;
  private spawnWait = 0;
  readonly junctions;
  /** A vehicle honks (for the sound). */
  onHonk: (c: TrafficCar) => void = () => {};
  private readonly stands: { x: number; z: number }[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly graph: RoadGraph,
    private readonly world: CollisionWorld,
    private readonly count: number,
    private readonly shadows: boolean,
  ) {
    this.junctions = junctionsOf(graph.map, graph);
    const a = graph.map.props.autoStands;
    for (let i = 0; i + 3 < a.length; i += 4) this.stands.push({ x: a[i] / 10, z: a[i + 1] / 10 });
  }

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
    c.honkCd = Math.max(0, c.honkCd - dt);
    const road = this.graph.map.roads[c.arc.road];
    const cruise = (CRUISE[road.kind] ?? CRUISE[road.kind.replace('_link', '')] ?? 8) * SPEED_FACTOR[c.type];
    let target = cruise;
    // Slow for a bend.
    const next = c.path[0];
    if (next) {
      const bend = Math.abs(angDiff(Math.atan2(next[0] - c.px, next[1] - c.pz), c.a));
      if (bend > 0.5) target = Math.min(target, 4.5);
    }
    const laneLeft = c.left();

    // Look ahead.
    const sa = Math.sin(c.a);
    const ca = Math.cos(c.a);
    let gap = Infinity;
    let swerve = 0;
    let blocker = null as Bumper | null;
    if (c.ghost <= 0) {
      const look = (o: Bumper, still: boolean): void => {
        if (o === c.overtaking) return;
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
          const g = fw - t.len / 2 - ot.radius;
          if (g < gap) {
            gap = g;
            blocker = o;
          }
        }
      };
      for (const o of this.cars) if (o !== c && o.ghost <= 0) look(o, false);
      for (const o of others) look(o.body, !!o.still);
    }

    // Junction lights and traffic police (H.6): stop at the end of the lane unless green
    // (on amber, carry on if too close to stop).
    let atRed = false;
    const ctl = this.junctions.approachOf(c.arc);
    if (ctl) {
      const light = lightFor(ctl.j, ctl.a.group, Date.now());
      if (light !== 'green' && (light === 'red' || laneLeft > 9) && laneLeft + 1 < gap) {
        gap = laneLeft + 1;
        blocker = null;
        atRed = laneLeft < 12;
      }
    }

    // Overtaking (H.7): a slow vehicle ahead on a wide two-way road, nothing coming the other way.
    const twoWay = !road.oneway && road.width >= OVERTAKE_ROAD_W;
    const shift = road.width * 0.5; // from our lane into the other one
    if (c.overtaking) {
      c.overtakeT += dt;
      const o = c.overtaking;
      const behind = (o.x - c.x) * sa + (o.z - c.z) * ca < -(t.len + VEHICLES[o.type].len) / 2 - 3;
      if (behind || c.overtakeT > OVERTAKE_S || !this.cars.includes(o) || !twoWay || this.oncoming(c, shift, 25)) c.overtaking = null;
      else target = Math.max(target, cruise * 1.15);
    } else if (
      twoWay &&
      blocker instanceof TrafficCar &&
      gap < 14 &&
      !atRed &&
      !blocker.waiting &&
      blocker.speed < cruise * 0.8 &&
      laneLeft > 45 &&
      c.pulledIn <= 0 &&
      !this.oncoming(c, shift, 70)
    ) {
      c.overtaking = blocker;
      c.overtakeT = 0;
      gap = Infinity;
      blocker = null;
    }

    // Buses stop every 500 m on main roads; autos pull in at auto stands.
    if (c.pulledIn > 0) {
      c.pulledIn -= dt;
      target = 0;
    } else if (!c.overtaking && laneLeft > 30) {
      if (c.type === 'bus' && /^(trunk|primary|secondary)/.test(road.kind) && c.sinceStop > BUS_STOP_EVERY) {
        c.sinceStop = 0;
        c.pulledIn = BUS_STOP_S;
      } else if (c.type === 'auto') {
        this.stands.forEach((st, i) => {
          if (c.standsDone.has(i) || Math.hypot(st.x - c.px, st.z - c.pz) > 25) return;
          c.standsDone.add(i);
          if (Math.random() < 0.5) c.pulledIn = AUTO_STAND_S;
        });
      }
    }
    c.sinceStop += c.speed * dt;

    // Where to sit across the road: overtaking lane, pulled in at the kerb, or round a parked car.
    const want = c.overtaking ? shift : c.pulledIn > 0 ? -road.width * 0.18 : swerve;
    const rate = c.overtaking ? 3 : 2.5;
    c.side += Math.max(-rate * dt, Math.min(rate * dt, want - c.side));

    if (gap < Infinity) target = Math.min(target, Math.max(0, (gap - 1.5) * 1.1));
    c.waiting = atRed || c.pulledIn > 0 || (blocker instanceof TrafficCar && blocker.waiting && gap < 6);
    // Honk when held up by something that is not waiting at a light.
    if (target < 1 && gap < 6 && !c.waiting) {
      c.blockedT += dt;
      if (c.blockedT > HONK_AFTER_S && c.honkCd <= 0 && (!(blocker instanceof TrafficCar) || Math.random() < 0.02)) {
        c.honkCd = HONK_GAP_S + Math.random() * 3;
        this.onHonk(c);
      }
    } else c.blockedT = 0;
    if (target < 0.5 && gap < 4 && !c.waiting) {
      c.stuck += dt;
      if (c.stuck > STUCK_S) {
        c.ghost = GHOST_S;
        c.stuck = 0;
      }
    } else if (c.speed > 1) c.stuck = 0;
    c.speed += Math.max(-18 * dt, Math.min(t.acc * 0.55 * dt, target - c.speed));
    if (!c.advance(c.speed * dt, () => this.extend(c))) {
      this.remove(c);
      return;
    }
    c.place(dt, this.world);
  }

  /** Something coming the other way in the lane we would overtake in, within a distance ahead. */
  private oncoming(c: TrafficCar, shift: number, ahead: number): boolean {
    const sa = Math.sin(c.a), ca = Math.cos(c.a);
    for (const o of this.cars) {
      if (o === c || Math.cos(o.a - c.a) > -0.3) continue;
      const dx = o.x - c.x, dz = o.z - c.z;
      const fw = dx * sa + dz * ca;
      if (fw < -5 || fw > ahead) continue;
      // Right of forward is (-cos a, sin a); the overtaking line is shift metres that way.
      const right = -dx * ca + dz * sa;
      if (Math.abs(right - (shift - c.side)) < 3) return true;
    }
    return false;
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
    // Passengers: a pillion on some bikes, people in the back of some autos.
    const people = type === 'bike' ? (Math.random() < 0.35 ? 1 : 0) : type === 'auto' ? Math.floor(Math.random() * 3) : 0;
    for (let k = 1; k <= people; k++) car.mesh.add(seatedFigure(type, k, PASSENGER_SHIRTS[Math.floor(Math.random() * PASSENGER_SHIRTS.length)]));
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
