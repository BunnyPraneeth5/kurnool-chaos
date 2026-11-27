import type { MapData, Pt } from '../map/types';

// The road graph for local traffic and cops: which way you can go from each node, the
// shape of each edge, the left-hand lane along it, and shortest paths.

/** One direction along a graph edge. */
export interface Arc {
  edge: number;
  from: number;
  to: number;
  road: number;
  len: number;
  /** false when it runs against a one-way road (only cops use it) */
  legal: boolean;
}

/** A point on the road graph: `edge`, `along` metres from its `a` end. */
export interface EdgePoint {
  edge: number;
  along: number;
  x: number;
  z: number;
  dist: number;
}

const CELL = 64;
const key = (i: number, j: number): number => (i + 2048) * 4096 + (j + 2048);

export class RoadGraph {
  /** Arcs leaving each node. */
  readonly out: Arc[][];
  private readonly cells = new Map<number, number[]>();
  private readonly shapes: Pt[][];

  constructor(readonly map: MapData) {
    const { nodes, edges } = map.graph;
    this.out = nodes.map(() => []);
    this.shapes = edges.map((e) => map.roads[e.road].pts.slice(e.i0, e.i1 + 1));
    edges.forEach((e, i) => {
      const oneway = map.roads[e.road].oneway;
      this.out[e.a].push({ edge: i, from: e.a, to: e.b, road: e.road, len: e.len, legal: true });
      this.out[e.b].push({ edge: i, from: e.b, to: e.a, road: e.road, len: e.len, legal: !oneway });
      const pts = this.shapes[i];
      for (let k = 1; k < pts.length; k++) {
        const [ax, az] = pts[k - 1];
        const [bx, bz] = pts[k];
        for (let x = Math.floor(Math.min(ax, bx) / CELL); x <= Math.floor(Math.max(ax, bx) / CELL); x++) {
          for (let z = Math.floor(Math.min(az, bz) / CELL); z <= Math.floor(Math.max(az, bz) / CELL); z++) {
            const c = key(x, z);
            let list = this.cells.get(c);
            if (!list) this.cells.set(c, (list = []));
            if (list[list.length - 1] !== i) list.push(i);
          }
        }
      }
    });
  }

  /** The edge's points in the direction of travel. */
  points(arc: Arc): Pt[] {
    const pts = this.shapes[arc.edge];
    return arc.from === this.map.graph.edges[arc.edge].a ? pts : pts.slice().reverse();
  }

  /**
   * The left-hand lane along an arc (India drives on the left), with `trim` metres cut
   * from each end so vehicles curve through junctions.
   */
  lane(arc: Arc, trim = 5): Pt[] {
    const road = this.map.roads[arc.road];
    const off = road.width * (road.oneway ? 0.15 : 0.25);
    const pts = trimEnds(this.points(arc), Math.min(trim, arc.len * 0.3));
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      // Left of forward (ux, uz) is (uz, -ux).
      return [p[0] + (dz / l) * off, p[1] - (dx / l) * off];
    });
  }

  /** Closest point on any edge within `max` metres. */
  nearest(x: number, z: number, max = 120): EdgePoint | null {
    let best = null as EdgePoint | null;
    const ci = Math.floor(x / CELL);
    const cj = Math.floor(z / CELL);
    const rings = Math.ceil(max / CELL) + 1;
    const seen = new Set<number>();
    for (let ring = 0; ring <= rings; ring++) {
      for (let i = ci - ring; i <= ci + ring; i++) {
        for (let j = cj - ring; j <= cj + ring; j++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue;
          for (const e of this.cells.get(key(i, j)) ?? []) {
            if (seen.has(e)) continue;
            seen.add(e);
            const pts = this.shapes[e];
            let along = 0;
            for (let k = 1; k < pts.length; k++) {
              const [ax, az] = pts[k - 1];
              const dx = pts[k][0] - ax;
              const dz = pts[k][1] - az;
              const l = Math.hypot(dx, dz);
              if (l < 1e-6) continue;
              const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (l * l)));
              const px = ax + t * dx;
              const pz = az + t * dz;
              const d = Math.hypot(x - px, z - pz);
              if (d <= max && (!best || d < best.dist)) best = { edge: e, along: along + t * l, x: px, z: pz, dist: d };
              along += l;
            }
          }
        }
      }
      if (best && best.dist <= ring * CELL) break;
    }
    return best;
  }

  /**
   * Shortest road path (A*) between two points on the graph, as a polyline from `from` to
   * `to`. Ignores one-way signs (cops may drive against them), so dead ends never trap it.
   * Null if the two are not connected or the search runs too far.
   */
  path(from: EdgePoint, to: EdgePoint, maxVisits = 6000): Pt[] | null {
    const { nodes, edges } = this.map.graph;
    const start = edges[from.edge];
    const goal = edges[to.edge];
    if (from.edge === to.edge) return this.slice(from.edge, from.along, to.along);
    const cost = new Map<number, number>();
    const came = new Map<number, Arc>();
    const open = new MinHeap();
    const h = (n: number): number => Math.hypot(nodes[n][0] - to.x, nodes[n][1] - to.z);
    const startLen = this.length(from.edge);
    for (const [n, c] of [[start.a, from.along], [start.b, startLen - from.along]] as const) {
      if (c < (cost.get(n) ?? Infinity)) {
        cost.set(n, c);
        open.push(n, c + h(n));
      }
    }
    // Finishing costs: from either end of the goal edge to the goal point.
    const goalLen = this.length(to.edge);
    const finish = new Map<number, number>([[goal.a, to.along]]);
    finish.set(goal.b, Math.min(finish.get(goal.b) ?? Infinity, goalLen - to.along));
    let bestEnd = -1;
    let bestTotal = Infinity;
    const done = new Set<number>();
    while (open.size && done.size < maxVisits) {
      const top = open.pop();
      if (top.priority >= bestTotal) break;
      const n = top.id;
      if (done.has(n)) continue;
      done.add(n);
      const c = cost.get(n)!;
      const f = finish.get(n);
      if (f !== undefined && c + f < bestTotal) {
        bestTotal = c + f;
        bestEnd = n;
      }
      for (const arc of this.out[n]) {
        const next = c + arc.len + (arc.legal ? 0 : arc.len * 0.3);
        if (next >= (cost.get(arc.to) ?? Infinity)) continue;
        cost.set(arc.to, next);
        came.set(arc.to, arc);
        open.push(arc.to, next + h(arc.to));
      }
    }
    if (bestEnd < 0) return null;
    const arcs: Arc[] = [];
    let n = bestEnd;
    for (let a = came.get(n); a; a = came.get(n)) {
      arcs.push(a);
      n = a.from;
      if (arcs.length > maxVisits) return null;
    }
    arcs.reverse();
    // n is now the start-edge end the path leaves from, bestEnd the goal-edge end it arrives at.
    const endOf = (e: { a: number; b: number }, node: number, p: EdgePoint, len: number): number => {
      if (e.a === e.b) return p.along <= len / 2 ? 0 : len;
      return node === e.a ? 0 : len;
    };
    const out = this.slice(from.edge, from.along, endOf(start, n, from, startLen));
    for (const a of arcs) out.push(...this.points(a).slice(1));
    out.push(...this.slice(to.edge, endOf(goal, bestEnd, to, goalLen), to.along).slice(1));
    return out;
  }

  length(edge: number): number {
    const pts = this.shapes[edge];
    let s = 0;
    for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return s;
  }

  /** The part of an edge from `s0` to `s1` metres along it (either direction). */
  private slice(edge: number, s0: number, s1: number): Pt[] {
    const lo = Math.min(s0, s1);
    const hi = Math.max(s0, s1);
    const pts = this.shapes[edge];
    const out: Pt[] = [pointAlong(pts, lo)];
    let s = 0;
    for (let i = 1; i < pts.length; i++) {
      s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (s > lo && s < hi) out.push(pts[i]);
    }
    out.push(pointAlong(pts, hi));
    return s0 <= s1 ? out : out.reverse();
  }
}

/** The point `s` metres along a polyline (clamped to its ends). */
export function pointAlong(pts: Pt[], s: number): Pt {
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (s <= l && l > 0) {
      const t = Math.max(0, s / l);
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    }
    s -= l;
  }
  return pts[pts.length - 1];
}

function trimEnds(pts: Pt[], trim: number): Pt[] {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const lo = trim;
  const hi = total - trim;
  const out: Pt[] = [pointAlong(pts, lo)];
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (s > lo + 0.5 && s < hi - 0.5) out.push(pts[i]);
  }
  out.push(pointAlong(pts, hi));
  return out;
}

/** Small binary heap of node ids by priority. */
class MinHeap {
  private readonly items: { id: number; priority: number }[] = [];
  get size(): number {
    return this.items.length;
  }
  push(id: number, priority: number): void {
    const a = this.items;
    let i = a.length;
    a.push({ id, priority });
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].priority <= priority) break;
      a[i] = a[p];
      a[p] = { id, priority };
      i = p;
    }
  }
  pop(): { id: number; priority: number } {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= a.length) break;
        if (c + 1 < a.length && a[c + 1].priority < a[c].priority) c++;
        if (a[c].priority >= last.priority) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = last;
    }
    return top;
  }
}
