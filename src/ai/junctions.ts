import type { MapData, Pt } from '../map/types';
import { RoadGraph, type Arc } from './graph';

// Controlled junctions (task H.6): traffic lights at the busiest junctions (4+ ways, 3+ of
// them trunk, primary or secondary, one trunk or primary) and a traffic policeman at Raj Vihar and C-Camp.
// Found from the road graph, so every screen has the same ones; the light cycle runs from
// the clock, so friends see (about) the same colours.

const MAJOR = /^(trunk|primary|secondary)(_link)?$/;
const MERGE_M = 25; // junction nodes this close are one junction (dual carriageways, small circles)
const POLICE_AT = ['rajvihar', 'ccamp'];
const POLICE_RANGE = 90; // m from the landmark pin

/** Seconds: green, amber, all red, for each of the two directions in turn. */
export const GREEN_S = 12;
export const AMBER_S = 3;
export const ALL_RED_S = 2;
export const CYCLE_S = 2 * (GREEN_S + AMBER_S + ALL_RED_S);

export type Light = 'green' | 'amber' | 'red';

export interface Approach {
  /** the arc that arrives at the junction */
  edge: number;
  from: number;
  /** end of the traffic lane: where vehicles stop */
  stop: Pt;
  /** heading of traffic arriving here, forward = (sin, cos) */
  heading: number;
  /** half width of the road */
  hw: number;
  /** 0 or 1: approaches in the same group (opposite each other) get green together */
  group: 0 | 1;
  /** signal pole beside the road */
  pole: Pt;
}

export interface Junction {
  id: number;
  x: number;
  z: number;
  nodes: Set<number>;
  approaches: Approach[];
  /** a traffic policeman instead of lights */
  police: boolean;
  /** seconds added to the clock so neighbouring junctions are not in step */
  offset: number;
}

export function lightFor(j: Junction, group: 0 | 1, nowMs: number): Light {
  let t = (nowMs / 1000 + j.offset) % CYCLE_S;
  if (group === 1) t = (t + CYCLE_S / 2) % CYCLE_S;
  if (t < GREEN_S) return 'green';
  if (t < GREEN_S + AMBER_S) return 'amber';
  return 'red';
}

function angDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Junctions {
  readonly list: Junction[] = [];
  /** `${edge}:${from}` of an arriving arc -> its junction and approach */
  private readonly byArc = new Map<string, { j: Junction; a: Approach }>();

  constructor(map: MapData, graph: RoadGraph) {
    const { nodes, edges } = map.graph;
    const roadOk = (r: number): boolean => {
      const road = map.roads[r];
      return road.id !== -1 && !road.bridge && !road.lift;
    };
    // Candidate nodes: 3+ road ends, at least one major road.
    const deg = new Map<number, { n: number; major: boolean }>();
    edges.forEach((e) => {
      if (!roadOk(e.road)) return;
      const major = MAJOR.test(map.roads[e.road].kind);
      for (const n of [e.a, e.b]) {
        const d = deg.get(n) ?? { n: 0, major: false };
        d.n++;
        d.major ||= major;
        deg.set(n, d);
      }
    });
    const cand = [...deg.entries()].filter(([, d]) => d.n >= 3 && d.major).map(([n]) => n);
    // Merge nearby candidates.
    const groupOf = new Map<number, number>();
    const groups: number[][] = [];
    for (const n of cand) {
      if (groupOf.has(n)) continue;
      const g: number[] = [n];
      groupOf.set(n, groups.length);
      for (let i = 0; i < g.length; i++) {
        const [x, z] = nodes[g[i]];
        for (const m of cand) {
          if (groupOf.has(m)) continue;
          if (Math.hypot(nodes[m][0] - x, nodes[m][1] - z) < MERGE_M) {
            groupOf.set(m, groups.length);
            g.push(m);
          }
        }
      }
      groups.push(g);
    }
    const policeSpots = POLICE_AT.map((id) => map.landmarks.find((l) => l.id === id)).filter((l): l is NonNullable<typeof l> => !!l);

    for (const g of groups) {
      const set = new Set(g);
      // Roads leading in from outside the junction.
      const arrive: Arc[] = [];
      const external = new Set<number>();
      const majorEdges = new Set<number>();
      let big = false;
      for (const n of g) {
        for (const out of graph.out[n]) {
          if (set.has(out.to) || !roadOk(out.road)) continue;
          external.add(out.edge);
          const kind = map.roads[out.road].kind;
          if (MAJOR.test(kind)) majorEdges.add(out.edge);
          if (/^(trunk|primary)/.test(kind)) big = true;
          // The reverse arc arrives here; keep it if traffic may drive that way.
          const back = graph.out[out.to].find((a) => a.edge === out.edge && a.to === n);
          if (back && back.legal && graph.length(back.edge) > 20) arrive.push(back);
        }
      }
      // Busy junctions only: 4+ ways, 3+ of them main roads, one trunk or primary.
      if (external.size < 4 || majorEdges.size < 3 || !big || arrive.length < 3) continue;
      const x = g.reduce((s, n) => s + nodes[n][0], 0) / g.length;
      const z = g.reduce((s, n) => s + nodes[n][1], 0) / g.length;
      const j: Junction = { id: this.list.length, x, z, nodes: set, approaches: [], police: false, offset: 0 };
      j.offset = (j.id * 7.3) % CYCLE_S;
      // Approaches, grouped by direction: opposite ways share a group.
      arrive.sort((p, q) => map.roads[q.road].width - map.roads[p.road].width);
      let axis = 0;
      arrive.forEach((arc, i) => {
        const lane = graph.lane(arc);
        if (lane.length < 2) return;
        const a = lane[lane.length - 2];
        const b = lane[lane.length - 1];
        const heading = Math.atan2(b[0] - a[0], b[1] - a[1]);
        if (i === 0) axis = heading;
        const group: 0 | 1 = Math.abs(angDiff(2 * heading, 2 * axis)) < Math.PI / 2 ? 0 : 1;
        const road = map.roads[arc.road];
        const hw = road.width / 2;
        // Pole on the left verge (left of forward (sin h, cos h) is (cos h, -sin h)).
        const out = hw - road.width * (road.oneway ? 0.15 : 0.25) + 1.3;
        const pole: Pt = [b[0] + Math.cos(heading) * out, b[1] - Math.sin(heading) * out];
        const ap: Approach = { edge: arc.edge, from: arc.from, stop: b, heading, hw, group, pole };
        j.approaches.push(ap);
        this.byArc.set(`${arc.edge}:${arc.from}`, { j, a: ap });
      });
      this.list.push(j);
    }
    // Traffic police at the named junctions (the controlled junction nearest each pin).
    for (const l of policeSpots) {
      let best: Junction | null = null;
      let bd = POLICE_RANGE;
      for (const j of this.list) {
        const d = Math.hypot(j.x - l.x, j.z - l.z);
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      if (best) best.police = true;
    }
  }

  /** The junction and approach an arc arrives at, if it is controlled. */
  approachOf(arc: Arc): { j: Junction; a: Approach } | null {
    return this.byArc.get(`${arc.edge}:${arc.from}`) ?? null;
  }

  /** Junctions within `r` metres. */
  near(x: number, z: number, r: number): Junction[] {
    return this.list.filter((j) => Math.abs(j.x - x) < r && Math.abs(j.z - z) < r);
  }
}

const cache = new WeakMap<MapData, Junctions>();

/** The junctions of a map (built once; the collision world and the game share them). */
export function junctionsOf(map: MapData, graph?: RoadGraph): Junctions {
  let j = cache.get(map);
  if (!j) cache.set(map, (j = new Junctions(map, graph ?? new RoadGraph(map))));
  return j;
}

/** Solid parts: signal poles (0.3 m) and the traffic policeman's stand (1.3 m). */
export function junctionWalls(map: MapData): Pt[][] {
  const out: Pt[][] = [];
  const square = (x: number, z: number, r: number): Pt[] => [[x - r, z - r], [x + r, z - r], [x + r, z + r], [x - r, z + r], [x - r, z - r]];
  for (const j of junctionsOf(map).list) {
    if (j.police) {
      const ring: Pt[] = [];
      for (let k = 0; k <= 8; k++) ring.push([j.x + Math.sin((k / 8) * Math.PI * 2) * 1.3, j.z + Math.cos((k / 8) * Math.PI * 2) * 1.3]);
      out.push(ring);
    } else for (const a of j.approaches) out.push(square(a.pole[0], a.pole[1], 0.15));
  }
  return out;
}
