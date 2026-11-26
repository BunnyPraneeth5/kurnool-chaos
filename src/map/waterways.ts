import * as THREE from 'three';
import type { MapData, Pt, Waterway } from './types';
import { FlatMeshBuilder, SolidMeshBuilder } from './meshBuilder';
import { box, clipRuns, offsetLine } from './props';
import { LAYER_Y } from './ground';

// Rivers and canals that OSM only has as centre lines (follow-up to Phase K): the KC
// (Kurnool-Cuddapah) Canal gets low concrete walls along both banks, with gaps where roads
// cross it; the Handri and other river lines get sandy banks; the KC Canal's aqueduct over
// the Handri is a raised concrete trough on piers. The water itself is drawn by water.ts
// (except the aqueduct, whose water is up in the trough).

const WALL_H = 0.7;
const WALL_T = 0.25;
const SAND_W = 7;
const SAND_Y = 0.025;
const AQUEDUCT_H = 4.5;
const AQUEDUCT_RAMP = 25;
const PIER_EVERY = 12;
const ROAD_GAP = 2; // m beyond a road's edge kept free of canal walls

/** True near any road surface (for gaps in canal walls). */
function roadNear(map: MapData): (x: number, z: number) => boolean {
  const cell = 32;
  const grid = new Map<string, { a: Pt; b: Pt; r: number }[]>();
  for (const road of map.roads) {
    const r = road.width / 2 + ROAD_GAP;
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1];
      const b = road.pts[i];
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
  return (x, z) => {
    for (const s of grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? []) {
      const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1];
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - s.a[0]) * dx + (z - s.a[1]) * dz) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(x - (s.a[0] + dx * t), z - (s.a[1] + dz * t)) < s.r) return true;
    }
    return false;
  };
}

/** A thin wall along a polyline: both faces and a top. */
function wall(mb: SolidMeshBuilder, line: Pt[], h: number, c: THREE.Color): void {
  const l = offsetLine(line, WALL_T / 2);
  const r = offsetLine(line, -WALL_T / 2);
  for (let i = 1; i < line.length; i++) {
    const dx = line[i][0] - line[i - 1][0], dz = line[i][1] - line[i - 1][1];
    const L = Math.hypot(dx, dz) || 1;
    for (const [E, s] of [[l, 1], [r, -1]] as const) {
      const nx = (-dz / L) * s, nz = (dx / L) * s;
      const p0 = mb.vertex(E[i - 1][0], 0, E[i - 1][1], nx, 0, nz, 0.875, 0.125, c);
      const p1 = mb.vertex(E[i][0], 0, E[i][1], nx, 0, nz, 0.875, 0.125, c);
      const p2 = mb.vertex(E[i][0], h, E[i][1], nx, 0, nz, 0.875, 0.125, c);
      const p3 = mb.vertex(E[i - 1][0], h, E[i - 1][1], nx, 0, nz, 0.875, 0.125, c);
      mb.tri(p0, p1, p2);
      mb.tri(p0, p2, p3);
    }
    const t = [l[i - 1], l[i], r[i], r[i - 1]].map((p) => mb.vertex(p[0], h, p[1], 0, 1, 0, 0.875, 0.125, c));
    mb.tri(t[0], t[1], t[2]);
    mb.tri(t[0], t[2], t[3]);
  }
}

/** The aqueduct: raised trough with water, side walls, slab and piers. */
function aqueduct(mb: SolidMeshBuilder, water: FlatMeshBuilder, ww: Waterway, concrete: THREE.Color, blue: THREE.Color): void {
  // Resample to 5 m pieces with a height profile that ramps up from both ends.
  const pts: Pt[] = [];
  const hs: number[] = [];
  let total = 0;
  for (let i = 1; i < ww.pts.length; i++) total += Math.hypot(ww.pts[i][0] - ww.pts[i - 1][0], ww.pts[i][1] - ww.pts[i - 1][1]);
  const hAt = (s: number): number => {
    const t = Math.min(1, Math.min(s, total - s) / AQUEDUCT_RAMP);
    return AQUEDUCT_H * t * t * (3 - 2 * t);
  };
  let along = 0;
  pts.push(ww.pts[0]);
  hs.push(hAt(0));
  for (let i = 1; i < ww.pts.length; i++) {
    const a = ww.pts[i - 1], b = ww.pts[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(L / 5));
    for (let k = 1; k <= n; k++) {
      pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      hs.push(hAt(along + (L * k) / n));
    }
    along += L;
  }
  const hw = ww.w / 2;
  const inL = offsetLine(pts, hw), inR = offsetLine(pts, -hw);
  const outL = offsetLine(pts, hw + 0.5), outR = offsetLine(pts, -hw - 0.5);
  let nextPier = PIER_EVERY / 2;
  along = 0;
  for (let i = 1; i < pts.length; i++) {
    const y0 = hs[i - 1] + LAYER_Y.water, y1 = hs[i] + LAYER_Y.water;
    const dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1];
    const L = Math.hypot(dx, dz) || 1;
    // Water surface in the trough.
    const w0 = water.vertex(inL[i - 1][0], y0, inL[i - 1][1], blue);
    const w1 = water.vertex(inL[i][0], y1, inL[i][1], blue);
    const w2 = water.vertex(inR[i][0], y1, inR[i][1], blue);
    const w3 = water.vertex(inR[i - 1][0], y0, inR[i - 1][1], blue);
    water.tri(w0, w1, w2);
    water.tri(w0, w2, w3);
    // Trough walls: outer face from under the slab to the rim, inner face from the water to the rim, rim top.
    for (const [O, I, s] of [[outL, inL, 1], [outR, inR, -1]] as const) {
      const nx = (-dz / L) * s, nz = (dx / L) * s;
      const lo0 = Math.max(0, y0 - 1.0), lo1 = Math.max(0, y1 - 1.0);
      const rim0 = y0 + 0.6, rim1 = y1 + 0.6;
      const q = [mb.vertex(O[i - 1][0], lo0, O[i - 1][1], nx, 0, nz, 0.875, 0.125, concrete), mb.vertex(O[i][0], lo1, O[i][1], nx, 0, nz, 0.875, 0.125, concrete), mb.vertex(O[i][0], rim1, O[i][1], nx, 0, nz, 0.875, 0.125, concrete), mb.vertex(O[i - 1][0], rim0, O[i - 1][1], nx, 0, nz, 0.875, 0.125, concrete)];
      mb.tri(q[0], q[1], q[2]);
      mb.tri(q[0], q[2], q[3]);
      const k = [mb.vertex(I[i - 1][0], y0 - 0.05, I[i - 1][1], -nx, 0, -nz, 0.875, 0.125, concrete), mb.vertex(I[i][0], y1 - 0.05, I[i][1], -nx, 0, -nz, 0.875, 0.125, concrete), mb.vertex(I[i][0], rim1, I[i][1], -nx, 0, -nz, 0.875, 0.125, concrete), mb.vertex(I[i - 1][0], rim0, I[i - 1][1], -nx, 0, -nz, 0.875, 0.125, concrete)];
      mb.tri(k[0], k[1], k[2]);
      mb.tri(k[0], k[2], k[3]);
      const t = [mb.vertex(O[i - 1][0], rim0, O[i - 1][1], 0, 1, 0, 0.875, 0.125, concrete), mb.vertex(O[i][0], rim1, O[i][1], 0, 1, 0, 0.875, 0.125, concrete), mb.vertex(I[i][0], rim1, I[i][1], 0, 1, 0, 0.875, 0.125, concrete), mb.vertex(I[i - 1][0], rim0, I[i - 1][1], 0, 1, 0, 0.875, 0.125, concrete)];
      mb.tri(t[0], t[1], t[2]);
      mb.tri(t[0], t[2], t[3]);
    }
    // Underside of the slab.
    if (hs[i] > 1.2) {
      const b = [outL[i - 1], outL[i], outR[i], outR[i - 1]].map((p, k) => mb.vertex(p[0], (k === 1 || k === 2 ? y1 : y0) - 1.0, p[1], 0, -1, 0, 0.875, 0.125, concrete));
      mb.tri(b[0], b[1], b[2]);
      mb.tri(b[0], b[2], b[3]);
    }
    while (nextPier <= along + L) {
      const t = (nextPier - along) / L;
      const h = hs[i - 1] + (hs[i] - hs[i - 1]) * t;
      if (h > 1.5) box(mb, pts[i - 1][0] + dx * t, pts[i - 1][1] + dz * t, Math.atan2(dx, dz), 1.0, ww.w + 0.6, 0, h - 0.95, concrete);
      nextPier += PIER_EVERY;
    }
    along += L;
  }
}

export function buildWaterways(map: MapData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'waterways';
  const solid = new SolidMeshBuilder();
  const sand = new FlatMeshBuilder();
  const trough = new FlatMeshBuilder();
  const concrete = new THREE.Color(0xb3ada3);
  const sandC = new THREE.Color(0xb59a74);
  const blue = new THREE.Color(0x3f5f9e);
  const near = roadNear(map);

  for (const ww of map.waterways) {
    if (ww.part === 'culvert') continue;
    if (ww.part === 'aqueduct') {
      aqueduct(solid, trough, ww, concrete, blue);
      continue;
    }
    if (ww.kind === 'canal') {
      for (const side of [1, -1]) {
        const edge = offsetLine(ww.pts, side * (ww.w / 2 + WALL_T / 2));
        for (const run of clipRuns(edge, (x, z) => !near(x, z))) wall(solid, run, WALL_H, concrete);
      }
    } else {
      // Sandy river bed and banks across the whole width; the satellite water outlines
      // (in water.ts) lie on top where the river actually has water.
      const left = offsetLine(ww.pts, ww.w / 2 + SAND_W);
      const right = offsetLine(ww.pts, -(ww.w / 2 + SAND_W));
      for (let i = 1; i < ww.pts.length; i++) {
        const q = [left[i - 1], left[i], right[i], right[i - 1]].map((p) => sand.vertex(p[0], SAND_Y, p[1], sandC));
        sand.tri(q[0], q[1], q[2]);
        sand.tri(q[0], q[2], q[3]);
      }
    }
  }

  if (!solid.empty) {
    const m = new THREE.Mesh(solid.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.name = 'canal walls and aqueduct';
    group.add(m);
  }
  if (!sand.empty) {
    const m = new THREE.Mesh(sand.build(), new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -1 }));
    m.name = 'river banks';
    group.add(m);
  }
  if (!trough.empty) {
    const m = new THREE.Mesh(trough.build(), new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0xffc7a0, shininess: 60 }));
    m.name = 'aqueduct water';
    group.add(m);
  }
  return group;
}
