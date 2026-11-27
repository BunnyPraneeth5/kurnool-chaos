import type * as THREE from 'three';
import type { CollisionWorld } from '../map/collision';
import type { Pt } from '../map/types';
import { setPoliceLook } from '../modes/visuals';
import { Agent, angDiff } from './agent';
import { stats } from '../ui/stats';
import { sound } from '../audio/sound';
import type { RoadGraph } from './graph';

// Cops and heat (TASKS 5.3), ported from the demo onto the road graph. Heat 1 to 3 brings
// that many cops. They spawn on the roads 140 to 320 m away, follow the shortest road path
// to you (re-planned about once a second, so dead ends do not trap them), and drive straight
// at you when they can see you within 30 m. Stop near a cop for 1.3 s and you are busted;
// stay 58 m clear of every cop for 10 s and the heat drops a star (new heat first gives
// the cops 20 s to get to you, or they would give up while still driving over). Local to each player.

export const MAX_HEAT = 3;
const SPAWN_MIN = 140;
const SPAWN_MAX = 320;
const DIRECT_M = 30;
const BUST_M = 7;
const BUST_SPEED = 4;
const BUST_S = 1.3;
const COOL_M = 58;
const COOL_S = 10;
const SEARCH_S = 20; // after new heat, cops get this long to reach you before it can cool
const REPLAN_S = 1;
const TOP = 27; // m/s
const COP_COLOUR = 0xf4f1ea;

export type CopEvent = 'busted' | 'lost' | 'cooler';

export class Cop extends Agent {
  replan = 0;
}

export class Cops {
  readonly cops: Cop[] = [];
  heat = 0;
  private bustT = 0;
  private coolT = 0;
  /** 0..1 while a bust is building up (for the HUD). */
  bustLevel = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly graph: RoadGraph,
    private readonly world: CollisionWorld,
    private readonly shadows: boolean,
  ) {}

  add(n: number, target: { x: number; z: number }): void {
    stats.stars += Math.min(n, MAX_HEAT - this.heat);
    if (this.heat < MAX_HEAT) sound.beep(520, 0.25, 'square');
    this.heat = Math.min(MAX_HEAT, this.heat + n);
    this.coolT = -SEARCH_S;
    for (let tries = 0; this.cops.length < this.heat && tries < 40; tries++) this.spawn(target);
  }

  clear(): void {
    for (const c of this.cops) this.scene.remove(c.mesh);
    this.cops.length = 0;
    this.heat = 0;
    this.bustT = this.coolT = this.bustLevel = 0;
  }

  /** Move the cops after `target` (the player). Returns what happened, if anything. */
  update(dt: number, target: { x: number; z: number; speed: number }): CopEvent | null {
    if (this.heat === 0) return null;
    // Top up (a spawn may have failed on a quiet road).
    if (this.cops.length < this.heat) this.spawn(target);
    let nearest = Infinity;
    for (const c of this.cops) nearest = Math.min(nearest, this.drive(c, dt, target));

    if (nearest < BUST_M && Math.abs(target.speed) < BUST_SPEED) {
      this.bustT += dt;
      if (this.bustT > BUST_S) {
        this.clear();
        return 'busted';
      }
    } else this.bustT = Math.max(0, this.bustT - dt * 0.5);
    this.bustLevel = this.bustT / BUST_S;

    if (nearest > COOL_M) {
      this.coolT += dt;
      if (this.coolT > COOL_S) {
        this.coolT = 0;
        this.heat--;
        // The furthest cop gives up.
        let far: Cop | null = null;
        let fd = -1;
        for (const c of this.cops) {
          const d = Math.hypot(c.x - target.x, c.z - target.z);
          if (d > fd) {
            fd = d;
            far = c;
          }
        }
        if (far) this.remove(far);
        if (this.heat === 0) {
          this.clear();
          return 'lost';
        }
        return 'cooler';
      }
    } else this.coolT = 0;
    return null;
  }

  private remove(c: Cop): void {
    const i = this.cops.indexOf(c);
    if (i >= 0) this.cops.splice(i, 1);
    this.scene.remove(c.mesh);
  }

  private drive(c: Cop, dt: number, t: { x: number; z: number }): number {
    const d = Math.hypot(t.x - c.x, t.z - c.z);
    const direct = d < DIRECT_M && this.clearLine(c.px, c.pz, t.x, t.z);
    c.replan -= dt;
    if (direct) {
      c.path = [[t.x, t.z]];
      c.replan = 0;
    } else if (c.replan <= 0 || c.path.length === 0) {
      c.replan = REPLAN_S * (0.8 + Math.random() * 0.4);
      const from = this.graph.nearest(c.px, c.pz, 200);
      const to = this.graph.nearest(t.x, t.z, 400);
      const path = from && to ? this.graph.path(from, to) : null;
      if (path) {
        // Join the road from where we are, then follow it.
        c.path = path.slice(1);
        c.path.unshift([from!.x, from!.z]);
      } else if (!c.path.length) c.path = [[t.x, t.z]];
    }
    const next: Pt | undefined = c.path[0];
    const bend = next ? Math.abs(angDiff(Math.atan2(next[0] - c.px, next[1] - c.pz), c.a)) : 0;
    let target = TOP * (bend > 0.7 ? 0.35 : 1);
    if (direct && d < 6) target = 3;
    c.speed += Math.max(-26 * dt, Math.min(12 * dt, target - c.speed));
    c.advance(c.speed * dt, () => false);
    c.place(dt, this.world);
    return d;
  }

  /** No wall between two points (sampled every 2 m). */
  private clearLine(x0: number, z0: number, x1: number, z1: number): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2));
    for (let k = 1; k < n; k++) {
      const x = x0 + ((x1 - x0) * k) / n;
      const z = z0 + ((z1 - z0) * k) / n;
      if (this.world.collide(x, z, 0.6).hit) return false;
    }
    return true;
  }

  private spawn(t: { x: number; z: number }): void {
    for (let tries = 0; tries < 12; tries++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
      const p = this.graph.nearest(t.x + Math.sin(ang) * dist, t.z + Math.cos(ang) * dist, 80);
      if (!p) continue;
      const d = Math.hypot(p.x - t.x, p.z - t.z);
      if (d < SPAWN_MIN * 0.8 || d > SPAWN_MAX * 1.2) continue;
      const road = this.graph.map.roads[this.graph.map.graph.edges[p.edge].road];
      if (road.id === -1) continue;
      const y = this.world.heightAt(p.x, p.z, road.lift || road.bridge ? 1e9 : this.world.heightAt(p.x, p.z, -1e9) + 0.5);
      const c = new Cop('car', COP_COLOUR, p.x, p.z, Math.atan2(t.x - p.x, t.z - p.z), y, this.shadows);
      setPoliceLook(c.mesh, true);
      c.settle(this.world);
      this.cops.push(c);
      this.scene.add(c.mesh);
      return;
    }
  }
}
