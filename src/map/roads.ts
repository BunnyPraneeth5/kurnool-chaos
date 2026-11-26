import * as THREE from 'three';
import type { MapData, Pt } from './types';
import { FlatMeshBuilder, SolidMeshBuilder } from './meshBuilder';
import { groundY } from './terrain';
import type { Road } from './types';

// Road ribbons merged per 500 m chunk so the renderer can cull off-screen chunks
// while keeping draw calls low on phones.
// Bigger roads sit slightly higher so they draw over smaller ones where they overlap.
export const ROAD_CHUNK = 500; // roads are light; buildings use 250 m chunks
const BRIDGE_LIFT = 0.5;
const MAX_MITER = 2.5;
const DISC_SEGMENTS = 12;

interface RoadStyle {
  y: number;
  color: number;
}
// Bigger roads are lighter so the main routes read clearly from above.
const STYLE: Record<string, RoadStyle> = {
  service: { y: 0.08, color: 0x5b5566 },
  living_street: { y: 0.08, color: 0x5b5566 },
  residential: { y: 0.1, color: 0x645e6f },
  unclassified: { y: 0.1, color: 0x645e6f },
  road: { y: 0.1, color: 0x645e6f },
  tertiary: { y: 0.12, color: 0x716a7b },
  tertiary_link: { y: 0.12, color: 0x716a7b },
  secondary: { y: 0.14, color: 0x7d7486 },
  secondary_link: { y: 0.14, color: 0x7d7486 },
  primary: { y: 0.16, color: 0x887e8f },
  primary_link: { y: 0.16, color: 0x887e8f },
  trunk: { y: 0.16, color: 0x8f8494 },
  trunk_link: { y: 0.16, color: 0x8f8494 },
};
const BRIDGE_COLOR = 0x9a8f9c;
const DEFAULT_STYLE = STYLE.residential;

export function roadStyle(kind: string): RoadStyle {
  return STYLE[kind] ?? DEFAULT_STYLE;
}

/** Height of a road's surface, including the bridge lift. */
export function roadY(kind: string, bridge: boolean): number {
  return roadStyle(kind).y + (bridge ? BRIDGE_LIFT : 0);
}

const ROAD_STEP = 16; // m between points, so roads follow the ground (the terrain grid is 20 m)

/**
 * A road's points (extra ones every 8 m) and its surface height at each. Roads follow the
 * ground; bridges run straight from the ground at one end to the ground at the other.
 */
export function roadProfile(road: Road): { pts: Pt[]; y: number[] } {
  const layer = roadY(road.kind, road.bridge);
  const pts: Pt[] = [];
  const lift: number[] = [];
  // Extra points every ROAD_STEP, carrying the flyover lift along linearly.
  road.pts.forEach((b, i) => {
    const lb = road.lift?.[i] ?? 0;
    if (i) {
      const a = road.pts[i - 1];
      const la = road.lift?.[i - 1] ?? 0;
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / ROAD_STEP));
      for (let k = 1; k < n; k++) {
        pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
        lift.push(la + ((lb - la) * k) / n);
      }
    }
    pts.push(b);
    lift.push(lb);
  });
  if (!road.bridge) return { pts, y: pts.map(([x, z], i) => groundY(x, z) + layer + lift[i]) };
  const total = pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0) || 1;
  const y0 = groundY(pts[0][0], pts[0][1]);
  const y1 = groundY(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  let along = 0;
  return {
    pts,
    y: pts.map((p, i) => {
      if (i) along += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      return y0 + ((y1 - y0) * along) / total + layer + lift[i];
    }),
  };
}

/** Left-side offset (unit normal times miter scale) at each point of a polyline. */
function offsets(pts: Pt[]): [number, number][] {
  const n = pts.length;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    let n0x = 0, n0z = 0, n1x = 0, n1z = 0;
    if (i > 0) {
      const dx = pts[i][0] - prev[0], dz = pts[i][1] - prev[1];
      const l = Math.hypot(dx, dz) || 1;
      n0x = -dz / l;
      n0z = dx / l;
    }
    if (i < n - 1) {
      const dx = next[0] - pts[i][0], dz = next[1] - pts[i][1];
      const l = Math.hypot(dx, dz) || 1;
      n1x = -dz / l;
      n1z = dx / l;
    }
    if (i === 0) {
      n0x = n1x;
      n0z = n1z;
    }
    if (i === n - 1) {
      n1x = n0x;
      n1z = n0z;
    }
    let mx = n0x + n1x, mz = n0z + n1z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) {
      out.push([n1x, n1z]);
      continue;
    }
    mx /= ml;
    mz /= ml;
    const cos = mx * n1x + mz * n1z;
    const scale = Math.min(MAX_MITER, 1 / Math.max(cos, 1e-3));
    out.push([mx * scale, mz * scale]);
  }
  return out;
}

const PIER_EVERY = 25; // m along flyovers
const SLAB = 1.2; // deck thickness under the road surface
const PARAPET_H = 1.0;

/** How high a road's surface is above the ground under it, at each profile point. */
function liftAbove(road: Road, p: { pts: Pt[]; y: number[] }): number[] {
  const layer = roadY(road.kind, road.bridge);
  return p.pts.map(([x, z], i) => p.y[i] - layer - groundY(x, z));
}

/** Flyover piers: [x, z, heading, top] every 25 m where a deck is 3 m+ up, never on a road below. */
export function flyoverPiers(map: MapData): [number, number, number, number][] {
  const cell = 32;
  const grid = new Map<string, { a: Pt; b: Pt; r: number }[]>();
  for (const road of map.roads) {
    if (road.lift || road.bridge) continue;
    const r = road.width / 2 + 1.5;
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i];
      for (let x = Math.floor((Math.min(a[0], b[0]) - r) / cell); x <= Math.floor((Math.max(a[0], b[0]) + r) / cell); x++) {
        for (let z = Math.floor((Math.min(a[1], b[1]) - r) / cell); z <= Math.floor((Math.max(a[1], b[1]) + r) / cell); z++) {
          const k = `${x},${z}`;
          let l = grid.get(k);
          if (!l) grid.set(k, (l = []));
          l.push({ a, b, r });
        }
      }
    }
  }
  const onRoadBelow = (x: number, z: number): boolean =>
    (grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? []).some((s) => {
      const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1];
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - s.a[0]) * dx + (z - s.a[1]) * dz) / l2));
      return Math.hypot(x - (s.a[0] + dx * t), z - (s.a[1] + dz * t)) < s.r;
    });
  const out: [number, number, number, number][] = [];
  for (const road of map.roads) {
    if (!road.lift) continue;
    const p = roadProfile(road);
    const up = liftAbove(road, p);
    let along = 0;
    let next = PIER_EVERY / 2;
    for (let i = 1; i < p.pts.length; i++) {
      const a = p.pts[i - 1], b = p.pts[i];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (next <= along + L) {
        const t = (next - along) / (L || 1);
        const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        const h = up[i - 1] + (up[i] - up[i - 1]) * t;
        const top = p.y[i - 1] + (p.y[i] - p.y[i - 1]) * t - roadY(road.kind, road.bridge) - SLAB;
        if (h > 3 && !onRoadBelow(x, z)) out.push([x, z, Math.atan2(b[0] - a[0], b[1] - a[1]), top]);
        next += PIER_EVERY;
      }
      along += L;
    }
  }
  return out;
}

/** Concrete deck sides, parapets and piers of flyovers and their ramps. */
function buildFlyovers(map: MapData): THREE.Mesh | null {
  const mb = new SolidMeshBuilder();
  const c = new THREE.Color(0xb7b0a6);
  const quad = (p: Pt, q: Pt, y0a: number, y0b: number, y1a: number, y1b: number, nx: number, nz: number): void => {
    const a0 = mb.vertex(p[0], y0a, p[1], nx, 0, nz, 0, 0, c);
    const b0 = mb.vertex(q[0], y0b, q[1], nx, 0, nz, 0, 0, c);
    const b1 = mb.vertex(q[0], y1b, q[1], nx, 0, nz, 0, 0, c);
    const a1 = mb.vertex(p[0], y1a, p[1], nx, 0, nz, 0, 0, c);
    mb.tri(a0, b0, b1);
    mb.tri(a0, b1, a1);
  };
  for (const road of map.roads) {
    if (!road.lift) continue;
    const p = roadProfile(road);
    const up = liftAbove(road, p);
    const hw = road.width / 2;
    const off = offsets(p.pts);
    for (let i = 1; i < p.pts.length; i++) {
      if (up[i - 1] < 0.6 && up[i] < 0.6) continue;
      const a = p.pts[i - 1], b = p.pts[i];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const L = Math.hypot(dx, dz) || 1;
      for (const side of [1, -1]) {
        const pa: Pt = [a[0] + off[i - 1][0] * hw * side, a[1] + off[i - 1][1] * hw * side];
        const pb: Pt = [b[0] + off[i][0] * hw * side, b[1] + off[i][1] * hw * side];
        const nx = (-dz / L) * side, nz = (dx / L) * side;
        const ya = p.y[i - 1], yb = p.y[i];
        // Slab side down to the ground on low ramps, else SLAB deep; parapet on top, both faces.
        const lowA = Math.max(groundY(pa[0], pa[1]) - 0.2, ya - SLAB), lowB = Math.max(groundY(pb[0], pb[1]) - 0.2, yb - SLAB);
        quad(pa, pb, lowA, lowB, ya + PARAPET_H, yb + PARAPET_H, nx, nz);
        quad(pa, pb, ya, yb, ya + PARAPET_H, yb + PARAPET_H, -nx, -nz);
      }
      // Underside where the deck is clear of the ground.
      if (up[i - 1] > SLAB + 0.5 && up[i] > SLAB + 0.5) {
        const l0: Pt = [a[0] + off[i - 1][0] * hw, a[1] + off[i - 1][1] * hw], r0: Pt = [a[0] - off[i - 1][0] * hw, a[1] - off[i - 1][1] * hw];
        const l1: Pt = [b[0] + off[i][0] * hw, b[1] + off[i][1] * hw], r1: Pt = [b[0] - off[i][0] * hw, b[1] - off[i][1] * hw];
        const q = [
          mb.vertex(l0[0], p.y[i - 1] - SLAB, l0[1], 0, -1, 0, 0, 0, c),
          mb.vertex(l1[0], p.y[i] - SLAB, l1[1], 0, -1, 0, 0, 0, c),
          mb.vertex(r1[0], p.y[i] - SLAB, r1[1], 0, -1, 0, 0, 0, c),
          mb.vertex(r0[0], p.y[i - 1] - SLAB, r0[1], 0, -1, 0, 0, 0, c),
        ];
        mb.tri(q[0], q[1], q[2]);
        mb.tri(q[0], q[2], q[3]);
      }
    }
  }
  // Piers: a column 1.6 m x 2.4 m from the ground to under the slab.
  for (const [x, z, h, top] of flyoverPiers(map)) {
    const ux = Math.sin(h), uz = Math.cos(h);
    const nx = -uz, nz = ux;
    const g = groundY(x, z) - 0.3;
    const pts: Pt[] = [
      [x - ux * 0.8 - nx * 1.2, z - uz * 0.8 - nz * 1.2],
      [x + ux * 0.8 - nx * 1.2, z + uz * 0.8 - nz * 1.2],
      [x + ux * 0.8 + nx * 1.2, z + uz * 0.8 + nz * 1.2],
      [x - ux * 0.8 + nx * 1.2, z - uz * 0.8 + nz * 1.2],
    ];
    for (let k = 0; k < 4; k++) {
      const p = pts[k], q = pts[(k + 1) % 4];
      const ex = q[0] - p[0], ez = q[1] - p[1];
      const l = Math.hypot(ex, ez) || 1;
      quad(p, q, g, g, top, top, ez / l, -ex / l);
    }
  }
  if (mb.empty) return null;
  const mesh = new THREE.Mesh(mb.build(), new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }));
  mesh.name = 'flyovers';
  return mesh;
}

/** All drivable roads as chunked ribbon meshes plus discs that fill junctions. */
export function buildRoads(map: MapData): THREE.Group {
  const chunks = new Map<string, FlatMeshBuilder>();
  const chunkFor = (x: number, z: number): FlatMeshBuilder => {
    const k = `${Math.floor(x / ROAD_CHUNK)},${Math.floor(z / ROAD_CHUNK)}`;
    let mb = chunks.get(k);
    if (!mb) chunks.set(k, (mb = new FlatMeshBuilder()));
    return mb;
  };
  const color = new THREE.Color();

  for (const road of map.roads) {
    if (road.pts.length < 2) continue;
    const st = roadStyle(road.kind);
    const { pts, y } = roadProfile(road);
    const hw = road.width / 2;
    color.setHex(road.bridge ? BRIDGE_COLOR : st.color);
    const off = offsets(pts);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const mb = chunkFor((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      // Edge points sit on the ground under them too (roads lie across slopes).
      const ya = y[i], yb = y[i + 1];
      const side = (px: number, pz: number, cy: number, cx: number, cz: number): number =>
        road.bridge ? cy : cy + groundY(px, pz) - groundY(cx, cz);
      const l0 = mb.vertex(a[0] + off[i][0] * hw, side(a[0] + off[i][0] * hw, a[1] + off[i][1] * hw, ya, a[0], a[1]), a[1] + off[i][1] * hw, color);
      const r0 = mb.vertex(a[0] - off[i][0] * hw, side(a[0] - off[i][0] * hw, a[1] - off[i][1] * hw, ya, a[0], a[1]), a[1] - off[i][1] * hw, color);
      const l1 = mb.vertex(b[0] + off[i + 1][0] * hw, side(b[0] + off[i + 1][0] * hw, b[1] + off[i + 1][1] * hw, yb, b[0], b[1]), b[1] + off[i + 1][1] * hw, color);
      const r1 = mb.vertex(b[0] - off[i + 1][0] * hw, side(b[0] - off[i + 1][0] * hw, b[1] - off[i + 1][1] * hw, yb, b[0], b[1]), b[1] - off[i + 1][1] * hw, color);
      mb.tri(l0, r0, l1);
      mb.tri(r0, r1, l1);
    }
  }

  // Junction discs: at every node where two or more road pieces meet, a disc the
  // size and colour of the widest one closes the gaps between ribbons. Where a
  // bridge meets a normal road, the normal road wins so no raised cap sticks out.
  const widest = new Map<number, { hw: number; kind: string; bridge: boolean }>();
  const degree = new Map<number, number>();
  const nodeLift = new Map<number, number>();
  for (const e of map.graph.edges) {
    const road = map.roads[e.road];
    for (const n of [e.a, e.b]) {
      degree.set(n, (degree.get(n) ?? 0) + 1);
      const l = road.lift?.[n === e.a ? e.i0 : e.i1] ?? 0;
      nodeLift.set(n, Math.max(nodeLift.get(n) ?? 0, l));
      const cur = widest.get(n);
      const hw = road.width / 2;
      const better =
        !cur ||
        (cur.bridge && !road.bridge) ||
        (cur.bridge === road.bridge &&
          (hw > cur.hw || (hw === cur.hw && roadY(road.kind, road.bridge) > roadY(cur.kind, cur.bridge))));
      if (better) widest.set(n, { hw, kind: road.kind, bridge: road.bridge });
    }
  }
  for (const [n, d] of degree) {
    if (d < 2) continue;
    const w = widest.get(n);
    if (!w) continue;
    const [x, z] = map.graph.nodes[n];
    const mb = chunkFor(x, z);
    const y = roadY(w.kind, w.bridge) + (nodeLift.get(n) ?? 0);
    color.setHex(w.bridge ? BRIDGE_COLOR : roadStyle(w.kind).color);
    const c = mb.vertex(x, y + groundY(x, z), z, color);
    const ring: number[] = [];
    for (let s = 0; s < DISC_SEGMENTS; s++) {
      const t = (s / DISC_SEGMENTS) * Math.PI * 2;
      const px = x + Math.cos(t) * w.hw, pz = z + Math.sin(t) * w.hw;
      ring.push(mb.vertex(px, y + groundY(px, pz), pz, color));
    }
    for (let s = 0; s < DISC_SEGMENTS; s++) mb.tri(c, ring[s], ring[(s + 1) % DISC_SEGMENTS]);
  }

  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const group = new THREE.Group();
  group.name = 'roads';
  const fly = buildFlyovers(map);
  if (fly) group.add(fly);
  for (const [key, mb] of chunks) {
    if (mb.empty) continue;
    const mesh = new THREE.Mesh(mb.build(), mat);
    mesh.name = `roads ${key}`;
    group.add(mesh);
  }
  return group;
}
