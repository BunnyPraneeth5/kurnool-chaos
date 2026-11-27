import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapData, Pt } from './types';
import type { CollisionWorld } from './collision';
import type { QualitySettings } from '../world/quality';
import { SolidMeshBuilder } from './meshBuilder';
import { groundY } from './terrain';
import { bordersOf, MEDIAN_H, PLANTER_H, type BreakItem, type BreakKind } from './borders';

// Drawing the roads and borders (Phase R): static pieces merged per 500 m chunk (dividers,
// lights, flyover barriers, footpaths, islands, speed breakers, station walls, bridge
// railings, stone edges, embankments, ghats, road works, checkpost booths), and the
// breakable pieces (railings, fence panels, barricades, cones) as instanced meshes per chunk,
// so a broken one simply changes its matrix to lying on the ground.

const CHUNK = 250; // borders are dense near roads and water: smaller chunks cull more (checked: 15-35% fewer triangles)
const C = (hex: number): THREE.Color => new THREE.Color(hex);
const YELLOW = C(0xf2c230);
const BLACK = C(0x1c1c22);
const CONCRETE = C(0xb8b2a6);
const SOIL = C(0x4f6b34);
const BUSH = C(0x3f7a3a);
const PAVE_A = C(0xc4b9a2);
const PAVE_B = C(0xb2a790);
const POLE = C(0x8d9096);
const LAMP = C(0xfff1b8);
const WALL = C(0xd9cfb8);
const WALL_CAP = C(0x9a5a40);
const STEEL = C(0xa7adb3);
const STONE = C(0x8c8577);
const EARTH = C(0x6d7a45);
const EARTH_SIDE = C(0x7a6748);
const GHAT = C(0xc9bda3);
const DUG = C(0x6b4a2e);
const BOOTH = C(0xeceae4);
const BOOTH_ROOF = C(0x2c5aa8);

const up = (): [number, number, number] => [0, 1, 0];

export class BorderMeshes {
  readonly group = new THREE.Group();
  private readonly slots: { mesh: THREE.InstancedMesh; i: number; item: BreakItem }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(
    map: MapData,
    private readonly world: CollisionWorld,
    quality: QualitySettings,
  ) {
    this.group.name = 'roads and borders';
    const b = bordersOf(map);
    const chunks = new Map<string, SolidMeshBuilder>();
    const at = (x: number, z: number): SolidMeshBuilder => {
      const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
      let mb = chunks.get(k);
      if (!mb) chunks.set(k, (mb = new SolidMeshBuilder()));
      return mb;
    };
    const low = quality.level === 'low';

    /* Dividers: striped black-and-yellow sides, planted or concrete top. */
    for (const md of b.medians) {
      const h = md.planter ? PLANTER_H : MEDIAN_H;
      const base = (p: Pt): number => groundY(p[0], p[1]) + md.y - 0.05;
      band(at, md.l, md.r, base, h, md.planter ? SOIL : CONCRETE, !low);
      if (md.planter) {
        // Small plants along the middle.
        const every = low ? 10 : 5;
        let next = every / 2;
        let along = 0;
        for (let i = 1; i < md.l.length; i++) {
          const c0: Pt = [(md.l[i - 1][0] + md.r[i - 1][0]) / 2, (md.l[i - 1][1] + md.r[i - 1][1]) / 2];
          const c1: Pt = [(md.l[i][0] + md.r[i][0]) / 2, (md.l[i][1] + md.r[i][1]) / 2];
          const L = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
          while (next <= along + L && L > 0) {
            const t = (next - along) / L;
            const x = c0[0] + (c1[0] - c0[0]) * t, z = c0[1] + (c1[1] - c0[1]) * t;
            const y = groundY(x, z) + md.y + h;
            box(at(x, z), x, z, Math.atan2(c1[0] - c0[0], c1[1] - c0[1]), 0.7, 0.55, y - 0.05, y + 0.45, BUSH);
            next += every;
          }
          along += L;
        }
      }
    }
    for (const l of b.lights) {
      const mb = at(l.x, l.z);
      const y = groundY(l.x, l.z) + l.y;
      box(mb, l.x, l.z, l.h, 0.2, 0.2, y, y + 9, POLE);
      box(mb, l.x, l.z, l.h + Math.PI / 2, 3.6, 0.12, y + 8.8, y + 9, POLE);
      const ux = Math.sin(l.h), uz = Math.cos(l.h);
      for (const s of [-1.75, 1.75]) box(mb, l.x - uz * s, l.z + ux * s, l.h, 0.6, 0.3, y + 8.6, y + 8.85, LAMP);
    }
    /* Flyover and bridge centre barriers. */
    for (const br of b.barriers) {
      for (let i = 1; i < br.pts.length; i++) {
        const [x0, z0] = br.pts[i - 1], [x1, z1] = br.pts[i];
        const L = Math.hypot(x1 - x0, z1 - z0);
        if (L < 0.01) continue;
        const h = Math.atan2(x1 - x0, z1 - z0);
        const mb = at(x0, z0);
        const y = Math.min(br.y[i - 1], br.y[i]);
        box(mb, (x0 + x1) / 2, (z0 + z1) / 2, h, L + 0.05, 0.55, y - 0.05, y + 0.8, CONCRETE);
      }
    }
    /* Footpaths: paving on top, a face down to the ground on the outside. */
    for (const f of b.footpaths) {
      const top = (p: Pt): number => groundY(p[0], p[1]) + f.y + 0.2;
      for (let i = 1; i < f.l.length; i++) {
        const mb = at(f.l[i][0], f.l[i][1]);
        const col = i % 2 ? PAVE_A : PAVE_B;
        quad(mb, [f.l[i - 1], top(f.l[i - 1])], [f.l[i], top(f.l[i])], [f.r[i], top(f.r[i])], [f.r[i - 1], top(f.r[i - 1])], up(), col);
        face(mb, f.r[i - 1], f.r[i], (p) => groundY(p[0], p[1]), top, PAVE_B, f.l[i]);
      }
    }
    /* Junction islands: a raised green disc with a striped kerb. */
    for (const is of b.islands) {
      const r = is.ring;
      let cx = 0, cz = 0;
      for (const p of r) {
        cx += p[0];
        cz += p[1];
      }
      cx /= r.length;
      cz /= r.length;
      const mb = at(cx, cz);
      const y = (p: Pt): number => groundY(p[0], p[1]) + 0.32;
      const c = mb.vertex(cx, groundY(cx, cz) + 0.32, cz, 0, 1, 0, 0, 0, SOIL);
      for (let i = 0; i < r.length; i++) {
        const p = r[i], q = r[(i + 1) % r.length];
        const a = mb.vertex(p[0], y(p), p[1], 0, 1, 0, 0, 0, SOIL);
        const bb = mb.vertex(q[0], y(q), q[1], 0, 1, 0, 0, 0, SOIL);
        mb.tri(c, a, bb);
        face(mb, p, q, (pp) => groundY(pp[0], pp[1]), y, i % 2 ? YELLOW : BLACK, [cx, cz]);
      }
      if (!low) for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const rad = Math.hypot(r[0][0] - cx, r[0][1] - cz) * 0.55;
        const x = cx + Math.sin(a) * rad, z = cz + Math.cos(a) * rad;
        box(mb, x, z, a, 0.8, 0.8, groundY(x, z) + 0.3, groundY(x, z) + 0.9, BUSH);
      }
    }
    /* Speed breakers: a low striped hump across the road. */
    for (const bp of b.bumps) {
      const mb = at(bp.x, bp.z);
      const n = Math.max(2, Math.round(bp.hw));
      for (let k = 0; k < n * 2; k++) {
        const t0 = -bp.hw + (k * bp.hw) / n, t1 = t0 + bp.hw / n;
        const tm = (t0 + t1) / 2;
        // Across the road is the right of the road heading: (-cos a, sin a).
        const x = bp.x - Math.cos(bp.a) * tm, z = bp.z + Math.sin(bp.a) * tm;
        const y = groundY(x, z) + 0.1;
        box(mb, x, z, bp.a, 1.2, bp.hw / n + 0.02, y - 0.05, y + 0.12, k % 2 ? YELLOW : BLACK);
      }
    }
    /* Station walls, bridge railings, stone edges by the water. */
    for (const w of b.stationWalls) {
      for (let i = 1; i < w.length; i++) {
        const [x0, z0] = w[i - 1], [x1, z1] = w[i];
        const L = Math.hypot(x1 - x0, z1 - z0);
        if (L < 0.01) continue;
        const x = (x0 + x1) / 2, z = (z0 + z1) / 2, h = Math.atan2(x1 - x0, z1 - z0);
        const g = Math.min(groundY(x0, z0), groundY(x1, z1));
        box(at(x, z), x, z, h, L + 0.05, 0.25, g - 0.3, g + 2.2, WALL);
        box(at(x, z), x, z, h, L + 0.05, 0.32, g + 2.2, g + 2.35, WALL_CAP);
      }
    }
    for (const rl of b.bridgeRails) {
      for (let i = 1; i < rl.pts.length; i++) {
        const [x0, z0] = rl.pts[i - 1], [x1, z1] = rl.pts[i];
        const L = Math.hypot(x1 - x0, z1 - z0);
        if (L < 0.01) continue;
        const x = (x0 + x1) / 2, z = (z0 + z1) / 2, h = Math.atan2(x1 - x0, z1 - z0);
        const y = (rl.y[i - 1] + rl.y[i]) / 2;
        const mb = at(x, z);
        box(mb, x, z, h, L + 0.02, 0.08, y + 0.85, y + 0.95, STEEL);
        box(mb, x, z, h, L + 0.02, 0.06, y + 0.45, y + 0.52, STEEL);
        const posts = Math.max(1, Math.round(L / 2.5));
        for (let k = 0; k < posts; k++) {
          const t = k / posts;
          box(mb, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, h, 0.1, 0.1, y - 0.05, y + 0.95, STEEL);
        }
      }
    }
    for (const [a, c] of b.stoneEdges) {
      const x = (a[0] + c[0]) / 2, z = (a[1] + c[1]) / 2;
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const g = groundY(x, z);
      box(at(x, z), x, z, Math.atan2(c[0] - a[0], c[1] - a[1]), L + 0.05, 0.4, g - 0.4, g + 0.55, STONE);
    }
    /* Embankments: an earth mound along the river. */
    for (const [a, c] of b.bunds) {
      const mb = at(a[0], a[1]);
      const dx = c[0] - a[0], dz = c[1] - a[1];
      const L = Math.hypot(dx, dz) || 1;
      const nx = -dz / L, nz = dx / L;
      const prof: [number, number][] = [[-2.6, 0], [-1.1, 0.9], [1.1, 0.9], [2.6, 0]];
      for (let k = 1; k < prof.length; k++) {
        const [o0, h0] = prof[k - 1], [o1, h1] = prof[k];
        const p = (pt: Pt, o: number, hh: number): [Pt, number] => {
          const xx = pt[0] + nx * o, zz = pt[1] + nz * o;
          return [[xx, zz], groundY(xx, zz) + hh - 0.05];
        };
        quad(mb, p(a, o0, h0), p(c, o0, h0), p(c, o1, h1), p(a, o1, h1), up(), k === 2 ? EARTH : EARTH_SIDE);
      }
    }
    /* Ghats: stone steps down to the water, with two small pillars. */
    for (const gh of b.ghats) {
      const mb = at(gh.x, gh.z);
      const ux = Math.sin(gh.a), uz = Math.cos(gh.a); // towards the water
      const g = groundY(gh.x, gh.z);
      for (let k = 0; k < 6; k++) {
        const x = gh.x + ux * (k * 0.8 + 0.4), z = gh.z + uz * (k * 0.8 + 0.4);
        box(mb, x, z, gh.a, 0.85, 12, g - 0.3 * (k + 1) - 1.2, g - 0.3 * k + 0.05, GHAT);
      }
      for (const s of [-6.3, 6.3]) {
        const x = gh.x - uz * s, z = gh.z + ux * s;
        box(mb, x, z, gh.a, 0.6, 0.6, g, g + 1.6, GHAT);
      }
    }
    /* Road works: a dug patch; checkpost booths. */
    for (const w of b.works) {
      const mb = at(w[0][0], w[0][1]);
      const y = (p: Pt): number => groundY(p[0], p[1]) + 0.19;
      quad(mb, [w[0], y(w[0])], [w[1], y(w[1])], [w[2], y(w[2])], [w[3], y(w[3])], up(), DUG);
    }
    for (const bt of b.booths) {
      const mb = at(bt.x, bt.z);
      const g = groundY(bt.x, bt.z);
      box(mb, bt.x, bt.z, bt.a, 2, 2, g, g + 2.3, BOOTH);
      box(mb, bt.x, bt.z, bt.a, 2.4, 2.4, g + 2.3, g + 2.5, BOOTH_ROOF);
    }

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const mb of chunks.values()) if (!mb.empty) this.group.add(new THREE.Mesh(mb.build(), mat));
    this.buildBreakables(b.breakables);
  }

  /* ---------- breakable pieces ---------- */

  private buildBreakables(items: readonly BreakItem[]): void {
    const geos: Record<BreakKind, THREE.BufferGeometry> = {
      // Flat double-sided panels keep these cheap: 8 triangles each.
      rail: panelGeo([
        { kind: 'post', z: -1.95, y0: 0, y1: 1.0, w: 0.08, col: 0x9aa0a6 },
        { kind: 'bar', y0: 0.5, y1: 0.6, len: 4, col: 0xc9ced3 },
        { kind: 'bar', y0: 0.9, y1: 1.0, len: 4, col: 0xc9ced3 },
      ]),
      fence: panelGeo([
        { kind: 'post', z: -1.95, y0: -0.1, y1: 1.8, w: 0.2, col: 0xb9b2a6 },
        { kind: 'bar', y0: 0.25, y1: 1.65, len: 3.9, col: 0x7f8f86 },
      ]),
      barrier: pieceGeo([
        [0.35, 0.3, 1.4, 0, 0.25, 0, 0xe2571e],
        [0.36, 0.25, 1.42, 0, 0.52, 0, 0xf4f1ea],
        [0.35, 0.3, 1.4, 0, 0.8, 0, 0xe2571e],
        [0.7, 0.1, 0.3, 0, 0.05, -0.55, 0x333333],
        [0.7, 0.1, 0.3, 0, 0.05, 0.55, 0x333333],
      ]),
      cone: (() => {
        const cone = paint(new THREE.ConeGeometry(0.22, 0.7, 8).translate(0, 0.35, 0), 0xf26a1b);
        const band = paint(new THREE.CylinderGeometry(0.15, 0.17, 0.1, 8).translate(0, 0.38, 0), 0xf4f1ea);
        const foot = paint(new THREE.BoxGeometry(0.45, 0.05, 0.45).translate(0, 0.025, 0), 0x222222);
        const g = mergeGeometries([cone, band, foot]);
        if (!g) throw new Error('Could not build the cone');
        return g;
      })(),
    };
    const nominal: Record<BreakKind, number> = { rail: 4, fence: 4, barrier: 1.4, cone: 1 };
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const groups = new Map<string, BreakItem[]>();
    for (const it of items) {
      const k = `${it.kind}:${Math.floor(it.x / CHUNK)},${Math.floor(it.z / CHUNK)}`;
      let l = groups.get(k);
      if (!l) groups.set(k, (l = []));
      l.push(it);
    }
    for (const [k, list] of groups) {
      const kind = k.split(':')[0] as BreakKind;
      const mesh = new THREE.InstancedMesh(geos[kind], mat, list.length);
      list.forEach((it, i) => {
        this.slots[it.id] = { mesh, i, item: it };
        mesh.setMatrixAt(i, this.pose(it, nominal[kind], false));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
    this.nominal = nominal;
  }

  private nominal: Record<BreakKind, number> = { rail: 4, fence: 4, barrier: 1.4, cone: 1 };

  /** Standing, or lying broken beside where it stood. */
  private pose(it: BreakItem, nominal: number, broken: boolean): THREE.Matrix4 {
    const scale = it.kind === 'cone' || it.kind === 'barrier' ? 1 : it.len / nominal;
    this.s.set(1, 1, scale);
    // Seeded by id so every screen shows the same wreck.
    const r = ((it.id * 2654435761) % 1000) / 1000;
    if (!broken) {
      this.e.set(0, it.a, 0);
      this.v.set(it.x, it.y, it.z);
    } else if (it.kind === 'rail' || it.kind === 'fence') {
      this.e.set(0, it.a + (r - 0.5) * 0.4, (r < 0.5 ? 1 : -1) * 1.45);
      this.v.set(it.x, it.y - 0.1, it.z);
    } else {
      // Knocked away: a couple of metres off, lying on its side.
      const ang = r * Math.PI * 2;
      const away = it.kind === 'cone' ? 2.5 : 1.8;
      const x = it.x + Math.sin(ang) * away, z = it.z + Math.cos(ang) * away;
      this.e.set(Math.PI / 2, it.a + r * 3, 0);
      this.v.set(x, Math.max(it.y - 0.2, groundY(x, z)) + 0.15, z);
    }
    this.q.setFromEuler(this.e);
    return this.m.compose(this.v, this.q, this.s);
  }

  /** Show pieces that broke or were fixed. */
  update(): void {
    const ids = this.world.drainChanges();
    if (!ids.length) return;
    const touched = new Set<THREE.InstancedMesh>();
    for (const id of ids) {
      const slot = this.slots[id];
      if (!slot) continue;
      slot.mesh.setMatrixAt(slot.i, this.pose(slot.item, this.nominal[slot.item.kind], !!this.world.broken[id]));
      touched.add(slot.mesh);
    }
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
  }
}

/* ---------- geometry helpers ---------- */

type V = [Pt, number];

function quad(mb: SolidMeshBuilder, a: V, b: V, c: V, d: V, n: [number, number, number], col: THREE.Color): void {
  const i0 = mb.vertex(a[0][0], a[1], a[0][1], n[0], n[1], n[2], 0, 0, col);
  const i1 = mb.vertex(b[0][0], b[1], b[0][1], n[0], n[1], n[2], 0, 0, col);
  const i2 = mb.vertex(c[0][0], c[1], c[0][1], n[0], n[1], n[2], 0, 0, col);
  const i3 = mb.vertex(d[0][0], d[1], d[0][1], n[0], n[1], n[2], 0, 0, col);
  mb.tri(i0, i1, i2);
  mb.tri(i0, i2, i3);
}

/** A vertical face from p to q between bottom(p) and top(p), facing away from `inside`. */
function face(mb: SolidMeshBuilder, p: Pt, q: Pt, bottom: (p: Pt) => number, top: (p: Pt) => number, col: THREE.Color, inside: Pt): void {
  const dx = q[0] - p[0], dz = q[1] - p[1];
  const l = Math.hypot(dx, dz) || 1;
  let nx = -dz / l, nz = dx / l;
  if ((inside[0] - p[0]) * nx + (inside[1] - p[1]) * nz > 0) {
    nx = -nx;
    nz = -nz;
  }
  quad(mb, [p, bottom(p)], [q, bottom(q)], [q, top(q)], [p, top(p)], [nx, 0, nz], col);
}

/** A raised band between two edge lines: striped sides (black and yellow every metre) and a top. */
function band(at: (x: number, z: number) => SolidMeshBuilder, l: Pt[], r: Pt[], base: (p: Pt) => number, h: number, topCol: THREE.Color, striped: boolean): void {
  let along = 0;
  for (let i = 1; i < l.length && i < r.length; i++) {
    const mb = at(l[i][0], l[i][1]);
    const top = (p: Pt): number => base(p) + h;
    quad(mb, [l[i - 1], top(l[i - 1])], [l[i], top(l[i])], [r[i], top(r[i])], [r[i - 1], top(r[i - 1])], up(), topCol);
    // Sides in 2 m pieces of alternating colour.
    for (const [E, other] of [[l, r], [r, l]] as const) {
      const a = E[i - 1], b = E[i];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      // Low quality: one face per segment, alternating colours, instead of a stripe every 2 m.
      const n = striped ? Math.max(1, Math.round(L / 2)) : 1;
      for (let k = 0; k < n; k++) {
        const p: Pt = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
        const q: Pt = [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n];
        face(mb, p, q, base, top, (striped ? Math.floor(along / 2 + k) : i) % 2 ? YELLOW : BLACK, other[i]);
      }
    }
    along += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
  }
}

/** An upright box: w along heading h (forward = (sin h, cos h)), d across, from y0 to y1. */
function box(mb: SolidMeshBuilder, x: number, z: number, h: number, w: number, d: number, y0: number, y1: number, col: THREE.Color): void {
  const ux = Math.sin(h) * (w / 2), uz = Math.cos(h) * (w / 2);
  const nx = -Math.cos(h) * (d / 2), nz = Math.sin(h) * (d / 2);
  const c: Pt[] = [
    [x - ux - nx, z - uz - nz],
    [x + ux - nx, z + uz - nz],
    [x + ux + nx, z + uz + nz],
    [x - ux + nx, z - uz + nz],
  ];
  quad(mb, [c[0], y1], [c[1], y1], [c[2], y1], [c[3], y1], up(), col);
  for (let k = 0; k < 4; k++) {
    const p = c[k], q = c[(k + 1) % 4];
    face(mb, p, q, () => y0, () => y1, col, [x, z]);
  }
}

function paint(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) g.dispose();
  ng.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = ng.attributes.position.count;
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return ng;
}

/** Boxes [w, h, d, x, y, z, colour] merged into one geometry (local z along the piece). */
function pieceGeo(parts: [number, number, number, number, number, number, number][]): THREE.BufferGeometry {
  const g = mergeGeometries(parts.map(([w, h, d, x, y, z, col]) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), col)));
  if (!g) throw new Error('Could not build a breakable piece');
  return g;
}

type PanelPart = { kind: 'post'; z: number; y0: number; y1: number; w: number; col: number } | { kind: 'bar'; y0: number; y1: number; len: number; col: number };

/** Flat parts for a railing or fence piece: posts as two crossed quads, bars as one quad (local z along the piece). */
function panelGeo(parts: PanelPart[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const q = (a: number[], b: number[], cc: number[], d: number[], n: number[]): void => {
    for (const v of [a, b, cc, a, cc, d]) {
      pos.push(v[0], v[1], v[2]);
      nor.push(n[0], n[1], n[2]);
      col.push(c.r, c.g, c.b);
    }
  };
  for (const p of parts) {
    c.setHex(p.col);
    if (p.kind === 'post') {
      const h = p.w / 2;
      q([-h, p.y0, p.z], [h, p.y0, p.z], [h, p.y1, p.z], [-h, p.y1, p.z], [0, 0, 1]);
      q([0, p.y0, p.z - h], [0, p.y0, p.z + h], [0, p.y1, p.z + h], [0, p.y1, p.z - h], [1, 0, 0]);
    } else {
      const h = p.len / 2;
      q([0, p.y0, -h], [0, p.y0, h], [0, p.y1, h], [0, p.y1, -h], [1, 0, 0]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
