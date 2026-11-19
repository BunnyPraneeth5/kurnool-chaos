import * as THREE from 'three';
import type { MapData, Pt } from './types';
import { FlatMeshBuilder } from './meshBuilder';

// Road ribbons merged per 500 m chunk so the renderer can cull off-screen chunks
// while keeping draw calls low on phones.
// Bigger roads sit slightly higher so they draw over smaller ones where they overlap.
export const ROAD_CHUNK = 500;
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
    const { pts } = road;
    if (pts.length < 2) continue;
    const st = roadStyle(road.kind);
    const y = roadY(road.kind, road.bridge);
    const hw = road.width / 2;
    color.setHex(road.bridge ? BRIDGE_COLOR : st.color);
    const off = offsets(pts);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const mb = chunkFor((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      const l0 = mb.vertex(a[0] + off[i][0] * hw, y, a[1] + off[i][1] * hw, color);
      const r0 = mb.vertex(a[0] - off[i][0] * hw, y, a[1] - off[i][1] * hw, color);
      const l1 = mb.vertex(b[0] + off[i + 1][0] * hw, y, b[1] + off[i + 1][1] * hw, color);
      const r1 = mb.vertex(b[0] - off[i + 1][0] * hw, y, b[1] - off[i + 1][1] * hw, color);
      mb.tri(l0, r0, l1);
      mb.tri(r0, r1, l1);
    }
  }

  // Junction discs: at every node where two or more road pieces meet, a disc the
  // size and colour of the widest one closes the gaps between ribbons. Where a
  // bridge meets a normal road, the normal road wins so no raised cap sticks out.
  const widest = new Map<number, { hw: number; kind: string; bridge: boolean }>();
  const degree = new Map<number, number>();
  for (const e of map.graph.edges) {
    const road = map.roads[e.road];
    for (const n of [e.a, e.b]) {
      degree.set(n, (degree.get(n) ?? 0) + 1);
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
    const y = roadY(w.kind, w.bridge);
    color.setHex(w.bridge ? BRIDGE_COLOR : roadStyle(w.kind).color);
    const c = mb.vertex(x, y, z, color);
    const ring: number[] = [];
    for (let s = 0; s < DISC_SEGMENTS; s++) {
      const t = (s / DISC_SEGMENTS) * Math.PI * 2;
      ring.push(mb.vertex(x + Math.cos(t) * w.hw, y, z + Math.sin(t) * w.hw, color));
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
  for (const [key, mb] of chunks) {
    if (mb.empty) continue;
    const mesh = new THREE.Mesh(mb.build(), mat);
    mesh.name = `roads ${key}`;
    group.add(mesh);
  }
  return group;
}
