import type * as THREE from 'three';
import type { CollisionWorld } from '../map/collision';
import type { MapData } from '../map/types';
import type { Bumper } from '../vehicles/hull';
import { flashLightBars } from '../modes/visuals';
import { RoadGraph } from './graph';
import { Traffic, type Obstacle, type TrafficCar } from './traffic';
import { Cops, type CopEvent } from './cops';
import { junctionsOf, lightFor, type Junctions } from './junctions';

// The city's local life: traffic, cops and heat (TASKS 5.2, 5.3). Each player has their
// own; none of it is synced (PRD: synced traffic and cops are out of scope).

const CRIME_COOLDOWN_S = 3;

export class Life {
  readonly graph: RoadGraph;
  readonly traffic: Traffic;
  readonly cops: Cops;
  /** Game rounds turn cops off (a Chor–Police round has its own police). */
  calm = false;
  private crimeCd = 0;
  private readonly obstacles: Obstacle[] = [];
  readonly junctions: Junctions;
  private lastPos: { x: number; z: number } | null = null;
  /** Set for the frame in which the player ran a red light: whether a cop or traffic policeman saw it. */
  ranRed: { seen: boolean } | null = null;

  constructor(map: MapData, scene: THREE.Scene, world: CollisionWorld, trafficCount: number, shadows: boolean) {
    this.graph = new RoadGraph(map);
    this.traffic = new Traffic(scene, this.graph, world, trafficCount, shadows);
    this.cops = new Cops(scene, this.graph, world, shadows);
    this.junctions = junctionsOf(map, this.graph);
  }

  /** Did the player just drive past a red light's stop line? */
  private checkRed(f: { x: number; z: number; a: number; speed: number }): void {
    this.ranRed = null;
    const last = this.lastPos;
    this.lastPos = { x: f.x, z: f.z };
    if (!last || Math.abs(f.speed) < 3 || Math.hypot(f.x - last.x, f.z - last.z) > 10) return;
    const now = Date.now();
    for (const j of this.junctions.near(f.x, f.z, 70)) {
      for (const ap of j.approaches) {
        if (lightFor(j, ap.group, now) !== 'red') continue;
        const ux = Math.sin(ap.heading), uz = Math.cos(ap.heading);
        const fwNow = (f.x - ap.stop[0]) * ux + (f.z - ap.stop[1]) * uz;
        const fwPrev = (last.x - ap.stop[0]) * ux + (last.z - ap.stop[1]) * uz;
        const lat = (f.x - ap.stop[0]) * uz - (f.z - ap.stop[1]) * ux;
        if (!(fwPrev < 0 && fwNow >= 0) || Math.abs(lat) > ap.hw + 1.5) continue;
        if (Math.cos(f.a - ap.heading) < 0.6) continue;
        const seen = j.police || this.cops.cops.some((c) => Math.hypot(c.x - f.x, c.z - f.z) < 120);
        this.ranRed = { seen };
        return;
      }
    }
  }

  /**
   * One frame. `parked` are vehicles that do not move, `moving` the player's own vehicle,
   * friends' vehicles and the player on foot (traffic stops for them).
   */
  update(dt: number, focus: { x: number; z: number; a: number; speed: number; driving: boolean }, parked: readonly Bumper[], moving: readonly Bumper[]): CopEvent | null {
    this.crimeCd = Math.max(0, this.crimeCd - dt);
    const o = this.obstacles;
    o.length = 0;
    for (const b of parked) o.push({ body: b, still: true });
    for (const b of moving) o.push({ body: b });
    for (const c of this.cops.cops) o.push({ body: c });
    this.traffic.update(dt, focus, o);
    if (focus.driving) this.checkRed(focus);
    else this.ranRed = null;
    flashLightBars(performance.now());
    if (this.calm) {
      if (this.cops.heat) this.cops.clear();
      return null;
    }
    return this.cops.update(dt, focus);
  }

  /** Vehicles the player's vehicle bumps into (traffic gives way, cops too). */
  solid(): Bumper[] {
    return [...this.traffic.solid(), ...this.cops.cops];
  }

  isCop(b: Bumper): boolean {
    return (this.cops.cops as Bumper[]).includes(b);
  }

  isTraffic(b: Bumper): b is TrafficCar {
    return (this.traffic.cars as Bumper[]).includes(b);
  }

  /** A crime: raise the heat (at most once every 3 s). True if it counted. */
  crime(n: number, at: { x: number; z: number }): boolean {
    if (this.calm || this.crimeCd > 0) return false;
    this.crimeCd = CRIME_COOLDOWN_S;
    this.cops.add(n, at);
    return true;
  }
}
