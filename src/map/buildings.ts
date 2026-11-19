import * as THREE from 'three';
import type { MapData, Pt } from './types';
import type { QualitySettings } from '../world/quality';
import { SolidMeshBuilder } from './meshBuilder';
import { makeRng, pointInRing } from '../util/rng';

// Extruded building footprints merged per 500 m chunk (MAP-SPEC: Buildings).
// Warm Indian city palette, window texture on walls, a lighter parapet band on top,
// darker flat roofs and black water tanks on some roofs.

export const BUILDING_CHUNK = 500;
const TILE_M = 3.2; // one window bay / one floor
const BAYS = 8; // the texture holds 8 x 8 bays; bay column 0 is plain wall
const TEX_M = TILE_M * BAYS;
const PARAPET = 0.5;
const PLAIN_U = 0.5 / BAYS; // centre of the plain column
const PLAIN_V = 0.5;
const TANK_CHANCE = 0.15;

// Cream, pale yellow, light blue, pink, mint, white, unpainted grey. Cream and white repeat (more common).
const PALETTE = [0xf1e3c6, 0xf3e39b, 0xb9d4e6, 0xefb7c0, 0xbfe3cf, 0xf4f1ea, 0xa9a6a3, 0xf1e3c6, 0xf4f1ea, 0xe8d8b8];
const ROOF_GREY = new THREE.Color(0x8f8a86);
const TANK = new THREE.Color(0x26252c);

function windowTextures(anisotropy: number): { map: THREE.CanvasTexture; lit: THREE.CanvasTexture } {
  const T = 64;
  const S = T * BAYS;
  const wall = document.createElement('canvas');
  const lit = document.createElement('canvas');
  wall.width = wall.height = lit.width = lit.height = S;
  const g = wall.getContext('2d');
  const l = lit.getContext('2d');
  if (!g || !l) throw new Error('2D canvas not available for building textures');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  l.fillStyle = '#000000';
  l.fillRect(0, 0, S, S);
  const rng = makeRng(20261119);
  for (let by = 0; by < BAYS; by++) {
    for (let bx = 1; bx < BAYS; bx++) {
      // Window from 0.7 m to 2.3 m above the floor, 1.4 m wide (canvas y runs downwards).
      const x = bx * T + 18;
      const y = by * T + 18;
      g.fillStyle = '#d9d2c8';
      g.fillRect(x - 3, y + 32, 34, 4); // sill
      g.fillStyle = '#4a4f66';
      g.fillRect(x, y, 28, 32);
      g.fillStyle = '#5d6480';
      g.fillRect(x + 13, y, 2, 32); // mullion
      if (rng() < 0.35) {
        l.fillStyle = rng() < 0.5 ? '#ffcf8a' : '#ffe2b0';
        l.fillRect(x, y, 28, 32);
      }
    }
  }
  const make = (c: HTMLCanvasElement): THREE.CanvasTexture => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    return t;
  };
  return { map: make(wall), lit: make(lit) };
}

function ringArea(r: Pt[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i];
    const q = r[(i + 1) % r.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function buildBuildings(map: MapData, quality: QualitySettings, anisotropy: number): THREE.Group {
  const chunks = new Map<string, SolidMeshBuilder>();
  const chunkFor = (x: number, z: number): SolidMeshBuilder => {
    const k = `${Math.floor(x / BUILDING_CHUNK)},${Math.floor(z / BUILDING_CHUNK)}`;
    let mb = chunks.get(k);
    if (!mb) chunks.set(k, (mb = new SolidMeshBuilder()));
    return mb;
  };

  const wallC = new THREE.Color();
  const bandC = new THREE.Color();
  const roofC = new THREE.Color();
  const white = new THREE.Color(0xffffff);

  map.buildings.forEach((b, i) => {
    const ring = b.pts;
    const n = ring.length;
    if (n < 3) return;
    const rng = makeRng((i * 2654435761) >>> 0);
    wallC.setHex(PALETTE[Math.floor(rng() * PALETTE.length)]);
    bandC.copy(wallC).lerp(white, 0.25);
    roofC.copy(wallC).lerp(ROOF_GREY, 0.65).multiplyScalar(0.8);
    // Tiny height offset so neighbouring roofs never share a plane (no z-fighting).
    const h = b.h + (i % 7) * 0.03;
    const body = h >= 6 ? h - PARAPET : h;

    let cx = 0;
    let cz = 0;
    for (const p of ring) {
      cx += p[0];
      cz += p[1];
    }
    cx /= n;
    cz /= n;
    const mb = chunkFor(cx, cz);

    // Walls. Rings have positive shoelace area, so the outward normal of edge (dx, dz) is (dz, -dx).
    let along = 0;
    for (let k = 0; k < n; k++) {
      const a = ring[k];
      const c = ring[(k + 1) % n];
      const dx = c[0] - a[0];
      const dz = c[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const nx = dz / len;
      const nz = -dx / len;
      const u0 = along / TEX_M;
      const u1 = (along + len) / TEX_M;
      const v1 = body / TEX_M;
      const a0 = mb.vertex(a[0], 0, a[1], nx, 0, nz, u0, 0, wallC);
      const b0 = mb.vertex(c[0], 0, c[1], nx, 0, nz, u1, 0, wallC);
      const b1 = mb.vertex(c[0], body, c[1], nx, 0, nz, u1, v1, wallC);
      const a1 = mb.vertex(a[0], body, a[1], nx, 0, nz, u0, v1, wallC);
      mb.tri(a0, b0, b1);
      mb.tri(a0, b1, a1);
      if (body < h) {
        const p0 = mb.vertex(a[0], body, a[1], nx, 0, nz, PLAIN_U, PLAIN_V, bandC);
        const q0 = mb.vertex(c[0], body, c[1], nx, 0, nz, PLAIN_U, PLAIN_V, bandC);
        const q1 = mb.vertex(c[0], h, c[1], nx, 0, nz, PLAIN_U, PLAIN_V, bandC);
        const p1 = mb.vertex(a[0], h, a[1], nx, 0, nz, PLAIN_U, PLAIN_V, bandC);
        mb.tri(p0, q0, q1);
        mb.tri(p0, q1, p1);
      }
      along += len;
    }

    // Flat roof.
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const roofIdx = ring.map(([x, z]) => mb.vertex(x, h, z, 0, 1, 0, PLAIN_U, PLAIN_V, roofC));
    for (const [p, q, r] of tris) mb.tri(roofIdx[p], roofIdx[q], roofIdx[r]);

    // Black water tank on some roofs.
    if (rng() < TANK_CHANCE && Math.abs(ringArea(ring)) > 50 && pointInRing(cx, cz, ring)) {
      const R = 0.75;
      const H = 1.3;
      const sides = 8;
      const top = mb.vertex(cx, h + H, cz, 0, 1, 0, PLAIN_U, PLAIN_V, TANK);
      const topRing: number[] = [];
      for (let s = 0; s < sides; s++) {
        const t0 = (s / sides) * Math.PI * 2;
        const t1 = ((s + 1) / sides) * Math.PI * 2;
        const tm = (t0 + t1) / 2;
        const nx = Math.cos(tm);
        const nz = Math.sin(tm);
        const x0 = cx + Math.cos(t0) * R, z0 = cz + Math.sin(t0) * R;
        const x1 = cx + Math.cos(t1) * R, z1 = cz + Math.sin(t1) * R;
        const w0 = mb.vertex(x0, h, z0, nx, 0, nz, PLAIN_U, PLAIN_V, TANK);
        const w1 = mb.vertex(x1, h, z1, nx, 0, nz, PLAIN_U, PLAIN_V, TANK);
        const w2 = mb.vertex(x1, h + H, z1, nx, 0, nz, PLAIN_U, PLAIN_V, TANK);
        const w3 = mb.vertex(x0, h + H, z0, nx, 0, nz, PLAIN_U, PLAIN_V, TANK);
        mb.tri(w0, w1, w2);
        mb.tri(w0, w2, w3);
        topRing.push(mb.vertex(x0, h + H, z0, 0, 1, 0, PLAIN_U, PLAIN_V, TANK));
      }
      for (let s = 0; s < sides; s++) mb.tri(top, topRing[s], topRing[(s + 1) % sides]);
    }
  });

  const tex = windowTextures(anisotropy);
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: tex.map,
    emissive: quality.litWindows ? 0xffffff : 0x000000,
    emissiveMap: quality.litWindows ? tex.lit : null,
    emissiveIntensity: 0.85,
  });
  if (!quality.litWindows) tex.lit.dispose();

  const group = new THREE.Group();
  group.name = 'buildings';
  for (const [key, mb] of chunks) {
    if (mb.empty) continue;
    const mesh = new THREE.Mesh(mb.build(), mat);
    mesh.name = `buildings ${key}`;
    group.add(mesh);
  }
  return group;
}
