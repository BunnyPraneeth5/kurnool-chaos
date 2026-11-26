import * as THREE from 'three';
import type { MapData, Pt, RailRun } from './types';
import { SolidMeshBuilder } from './meshBuilder';
import { box, boxRing, offsetLine } from './props';
import { groundY } from './terrain';

// Railway (follow-up to Phase K): the Guntakal - Kurnool - Dhone main line and the station
// sidings from OSM. Ballast and sleepers come from one repeating texture, the two rails are
// thin strips at Indian broad gauge (1.676 m). Bridges that cross water (the Tungabhadra
// and the Handri) stand 6 m high on piers with girder sides; other OSM bridges (over roads
// and drains) stay at ground level with low side rails. The electrified line gets overhead
// line masts and the contact wire. Where a road crosses the track at ground level there are
// raised red-and-white barrier booms on both sides.

const CHUNK = 500;
const GAUGE = 1.676;
const BALLAST_W = 3.2;
const DECK_W = 4.6;
const GROUND_Y = 0.05; // ballast top on the ground (under the road layers, so roads cross on top)
const BRIDGE_H = 6;
const RAMP = 60; // m from a high bridge's ends to full height
const PIER_EVERY = 30;
const MAST_EVERY = 55;
const MAST_OFF = 2.7;
const WIRE_H = 5.6;
const SLEEPER_REPEAT = 1.3; // m of track per texture repeat (two sleepers)

// Texture rows: v 0..0.25 plain white (box() samples it), v 0.3..1 ballast across the track.
const BALLAST_V0 = 0.3;
const BALLAST_V1 = 1.0;

function trackTexture(): THREE.CanvasTexture {
  const W = 64;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas not available for the railway');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  // Canvas rows run top-down and the texture is flipped: v = 1 - y / H.
  const yOf = (v: number): number => (1 - v) * H;
  const b0 = yOf(BALLAST_V1);
  const b1 = yOf(BALLAST_V0);
  g.fillStyle = '#7b7268';
  g.fillRect(0, b0, W, b1 - b0);
  // Ballast speckle.
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = rnd() < 0.5 ? '#8c8379' : '#6a625a';
    g.fillRect(Math.floor(rnd() * W), b0 + Math.floor(rnd() * (b1 - b0)), 2, 2);
  }
  // Two concrete sleepers per repeat, 2.75 m long across the 3.2 m bed.
  const s0 = yOf(BALLAST_V0 + (BALLAST_V1 - BALLAST_V0) * 0.07);
  const s1 = yOf(BALLAST_V0 + (BALLAST_V1 - BALLAST_V0) * 0.93);
  g.fillStyle = '#a9a49b';
  for (const x of [6, 38]) g.fillRect(x, s1, 14, s0 - s1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/**
 * Resampled run (points at most `step` m apart) with the height of the track bed at each point:
 * on the ground it follows the terrain; high bridges run straight from the ground at one end to
 * the ground at the other, raised by the bridge height in the middle.
 */
function profile(run: RailRun, step: number): { p: Pt; h: number }[] {
  const pts = run.pts;
  // The build stores the track bed height at each point (the undug ground); fall back to the terrain.
  const base = run.y && run.y.length === pts.length ? run.y : pts.map(([x, z]) => groundY(x, z));
  const along: number[] = [0];
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = along[along.length - 1] || 1;
  const high = !!run.overWater;
  const straight = high || !!run.bridge; // bridges run straight between their ends
  const top = Math.min(BRIDGE_H, total / 6);
  const g0 = base[0];
  const g1 = base[base.length - 1];
  const out: { p: Pt; h: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[i];
    const n = i === 0 ? 1 : Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = i === 0 ? 1 : 1; k <= n; k++) {
      const t = i === 0 ? 1 : k / n;
      const p: Pt = i === 0 ? b : [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const s = i === 0 ? 0 : along[i - 1] + (along[i] - along[i - 1]) * t;
      let h: number;
      if (straight) {
        h = g0 + ((g1 - g0) * s) / total;
        if (high) {
          const r = Math.min(1, Math.min(s, total - s) / RAMP);
          h += top * r * r * (3 - 2 * r);
        }
      } else h = i === 0 ? base[0] : base[i - 1] + (base[i] - base[i - 1]) * t;
      out.push({ p, h });
    }
  }
  return out;
}

export interface LevelCrossing {
  x: number;
  z: number;
  rx: number; // unit vector along the road
  rz: number;
  hw: number; // road half width
}

/** Level crossings: where OSM marks one (railway=level_crossing), placed on the road by the build. */
export function levelCrossings(map: MapData): LevelCrossing[] {
  return map.props.crossings.map((c) => ({ x: c.x, z: c.z, rx: Math.sin(c.a), rz: Math.cos(c.a), hw: c.hw }));
}

/** Barrier posts at a level crossing: road edges, 4.5 m either side of the track. */
function crossingPosts(c: LevelCrossing): Pt[] {
  const nx = -c.rz, nz = c.rx;
  const out: Pt[] = [];
  for (const along of [-4.5, 4.5]) for (const side of [-1, 1]) out.push([c.x + c.rx * along + nx * side * (c.hw + 0.6), c.z + c.rz * along + nz * side * (c.hw + 0.6)]);
  return out;
}

/** Overhead line masts beside electrified ground-level track: [x, z, heading of the track]. */
function masts(map: MapData): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const run of map.rail) {
    if (!run.electric || run.overWater) continue;
    let along = 0;
    let next = MAST_EVERY / 2;
    const left = offsetLine(run.pts, MAST_OFF);
    for (let i = 1; i < run.pts.length; i++) {
      const a = run.pts[i - 1];
      const b = run.pts[i];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (next <= along + L) {
        const t = (next - along) / L;
        const la = left[i - 1], lb = left[i];
        out.push([la[0] + (lb[0] - la[0]) * t, la[1] + (lb[1] - la[1]) * t, Math.atan2(b[0] - a[0], b[1] - a[1])]);
        next += MAST_EVERY;
      }
      along += L;
    }
  }
  return out;
}

/** Solid railway parts (masts, barrier posts), for the collision world. */
export function railWalls(map: MapData): Pt[][] {
  const out: Pt[][] = [];
  const sq = (x: number, z: number, s: number): Pt[] => {
    const r = boxRing(x, z, 0, s, s);
    return [...r, r[0]];
  };
  for (const [x, z] of masts(map)) out.push(sq(x, z, 0.35));
  for (const c of levelCrossings(map)) for (const [x, z] of crossingPosts(c)) out.push(sq(x, z, 0.35));
  return out;
}

export function buildRail(map: MapData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'railway';
  const chunks = new Map<string, SolidMeshBuilder>();
  const wires = new Map<string, number[]>();
  const keyOf = (x: number, z: number): string => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
  const mbAt = (x: number, z: number): SolidMeshBuilder => {
    const k = keyOf(x, z);
    let mb = chunks.get(k);
    if (!mb) chunks.set(k, (mb = new SolidMeshBuilder()));
    return mb;
  };
  const wireAt = (x: number, z: number): number[] => {
    const k = keyOf(x, z);
    let l = wires.get(k);
    if (!l) wires.set(k, (l = []));
    return l;
  };

  const white = new THREE.Color(0xffffff);
  const steel = new THREE.Color(0x3d3a3f);
  const concrete = new THREE.Color(0xa8a29a);
  const girder = new THREE.Color(0x6f7479);
  const mastC = new THREE.Color(0x8a8f93);

  for (const run of map.rail) {
    const prof = profile(run, 10);
    const pts = prof.map((q) => q.p);
    const high = !!run.overWater;
    const bedW = high ? DECK_W : BALLAST_W;
    const L = offsetLine(pts, bedW / 2);
    const R = offsetLine(pts, -bedW / 2);
    const rails = [offsetLine(pts, GAUGE / 2), offsetLine(pts, -GAUGE / 2)];
    let along = 0;
    let nextPier = PIER_EVERY / 2;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (seg < 0.01) continue;
      const mb = mbAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      const y0 = prof[i - 1].h + GROUND_Y;
      const y1 = prof[i].h + GROUND_Y;
      const u0 = along / SLEEPER_REPEAT, u1 = (along + seg) / SLEEPER_REPEAT;
      const dx = (b[0] - a[0]) / seg, dz = (b[1] - a[1]) / seg;
      // Ballast top with sleepers.
      const t0 = mb.vertex(L[i - 1][0], y0, L[i - 1][1], 0, 1, 0, u0, BALLAST_V1, white);
      const t1 = mb.vertex(L[i][0], y1, L[i][1], 0, 1, 0, u1, BALLAST_V1, white);
      const t2 = mb.vertex(R[i][0], y1, R[i][1], 0, 1, 0, u1, BALLAST_V0, white);
      const t3 = mb.vertex(R[i - 1][0], y0, R[i - 1][1], 0, 1, 0, u0, BALLAST_V0, white);
      mb.tri(t0, t1, t2);
      mb.tri(t0, t2, t3);
      // Sides of the bed (deep on high bridges: the deck slab and girders).
      const sideC = high ? girder : concrete;
      for (const [E, s] of [[L, 1], [R, -1]] as const) {
        const nx = -dz * s, nz = dx * s;
        const ga = groundY(E[i - 1][0], E[i - 1][1]), gb = groundY(E[i][0], E[i][1]);
        const lo0 = high ? Math.max(ga, y0 - 1.4) : Math.min(ga, y0) - 0.1, lo1 = high ? Math.max(gb, y1 - 1.4) : Math.min(gb, y1) - 0.1;
        const hi0 = high ? y0 + 1.0 : y0, hi1 = high ? y1 + 1.0 : y1; // girder sides stand 1 m above the deck
        const p0 = mb.vertex(E[i - 1][0], lo0, E[i - 1][1], nx, 0, nz, 0.875, 0.125, sideC);
        const p1 = mb.vertex(E[i][0], lo1, E[i][1], nx, 0, nz, 0.875, 0.125, sideC);
        const p2 = mb.vertex(E[i][0], hi1, E[i][1], nx, 0, nz, 0.875, 0.125, sideC);
        const p3 = mb.vertex(E[i - 1][0], hi0, E[i - 1][1], nx, 0, nz, 0.875, 0.125, sideC);
        mb.tri(p0, p1, p2);
        mb.tri(p0, p2, p3);
        if (high) {
          // Inner face of the girder, so it reads from the deck too.
          const q0 = mb.vertex(E[i - 1][0], y0, E[i - 1][1], -nx, 0, -nz, 0.875, 0.125, sideC);
          const q1 = mb.vertex(E[i][0], y1, E[i][1], -nx, 0, -nz, 0.875, 0.125, sideC);
          mb.tri(q0, q1, p2);
          mb.tri(q0, p2, p3);
        }
      }
      // Low side rails on ground-level bridges (over drains and roads).
      if (run.bridge && !high) {
        for (const [E, s] of [[L, 1], [R, -1]] as const) {
          const nx = -dz * s, nz = dx * s;
          const p0 = mb.vertex(E[i - 1][0], y0, E[i - 1][1], nx, 0, nz, 0.875, 0.125, girder);
          const p1 = mb.vertex(E[i][0], y1, E[i][1], nx, 0, nz, 0.875, 0.125, girder);
          const p2 = mb.vertex(E[i][0], y1 + 0.9, E[i][1], nx, 0, nz, 0.875, 0.125, girder);
          const p3 = mb.vertex(E[i - 1][0], y0 + 0.9, E[i - 1][1], nx, 0, nz, 0.875, 0.125, girder);
          mb.tri(p0, p1, p2);
          mb.tri(p0, p2, p3);
        }
      }
      // The two rails: top and outer faces.
      for (const r of rails) {
        const w = 0.04;
        const ra = r[i - 1], rb = r[i];
        const nx = -dz, nz = dx;
        const top = (p: Pt, y: number, s: number): number => mb.vertex(p[0] + nx * w * s, y + 0.14, p[1] + nz * w * s, 0, 1, 0, 0.875, 0.125, steel);
        const q0 = top(ra, y0, 1), q1 = top(rb, y1, 1), q2 = top(rb, y1, -1), q3 = top(ra, y0, -1);
        mb.tri(q0, q1, q2);
        mb.tri(q0, q2, q3);
        for (const s of [1, -1]) {
          const f0 = mb.vertex(ra[0] + nx * w * s, y0, ra[1] + nz * w * s, nx * s, 0, nz * s, 0.875, 0.125, steel);
          const f1 = mb.vertex(rb[0] + nx * w * s, y1, rb[1] + nz * w * s, nx * s, 0, nz * s, 0.875, 0.125, steel);
          const f2 = mb.vertex(rb[0] + nx * w * s, y1 + 0.14, rb[1] + nz * w * s, nx * s, 0, nz * s, 0.875, 0.125, steel);
          const f3 = mb.vertex(ra[0] + nx * w * s, y0 + 0.14, ra[1] + nz * w * s, nx * s, 0, nz * s, 0.875, 0.125, steel);
          mb.tri(f0, f1, f2);
          mb.tri(f0, f2, f3);
        }
      }
      // Piers under high bridges.
      if (high) {
        while (nextPier <= along + seg) {
          const t = (nextPier - along) / seg;
          const deck = prof[i - 1].h + (prof[i].h - prof[i - 1].h) * t;
          const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
          const g = groundY(x, z);
          if (deck - g > 2) box(mb, x, z, Math.atan2(dx, dz), 1.6, DECK_W - 0.6, g - 0.5, deck - 1.3, concrete);
          nextPier += PIER_EVERY;
        }
        // Overhead wire on the high bridge too, carried by the girders (no masts in the river).
        if (run.electric) wireAt(a[0], a[1]).push(a[0], y0 + WIRE_H, a[1], b[0], y1 + WIRE_H, b[1]);
      } else if (run.electric) {
        wireAt(a[0], a[1]).push(a[0], y0 + WIRE_H, a[1], b[0], y1 + WIRE_H, b[1]);
      }
      along += seg;
    }
  }

  // Overhead line masts with a cantilever arm over the track.
  for (const [x, z, h] of masts(map)) {
    const mb = mbAt(x, z);
    const g0 = mb.count;
    box(mb, x, z, h, 0.3, 0.3, -0.3, 7.2, mastC);
    // Masts stand at offsetLine(+MAST_OFF), on the (-dz, dx) side; the arm reaches back over the track.
    const nx = Math.cos(h), nz = -Math.sin(h);
    box(mb, x + nx * 1.3, z + nz * 1.3, h + Math.PI / 2, 2.8, 0.12, 6.4, 6.55, mastC);
    mb.lift(g0, groundY(x, z));
  }

  // Level crossings: posts with raised red-and-white booms.
  const red = new THREE.Color(0xc62828);
  const post = new THREE.Color(0x3a3a3a);
  for (const c of levelCrossings(map)) {
    for (const [x, z] of crossingPosts(c)) {
      const mb = mbAt(x, z);
      const g0 = mb.count;
      box(mb, x, z, 0, 0.35, 0.35, -0.3, 1.1, post);
      for (let k = 0; k < 6; k++) box(mb, x, z, 0, 0.12, 0.12, 1.1 + k * 0.7, 1.8 + k * 0.7, k % 2 ? white : red);
      mb.lift(g0, groundY(x, z));
    }
  }

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: trackTexture() });
  for (const [k, mb] of chunks) {
    if (mb.empty) continue;
    const m = new THREE.Mesh(mb.build(), mat);
    m.name = `rail ${k}`;
    group.add(m);
  }
  const wireMat = new THREE.LineBasicMaterial({ color: 0x2a2730 });
  for (const [k, list] of wires) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
    g.computeBoundingSphere();
    const lines = new THREE.LineSegments(g, wireMat);
    lines.name = `rail wire ${k}`;
    group.add(lines);
  }
  return group;
}
