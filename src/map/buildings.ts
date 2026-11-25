import * as THREE from 'three';
import type { Building, MapData, Pt } from './types';
import type { QualitySettings } from '../world/quality';
import { SolidMeshBuilder } from './meshBuilder';
import { makeRng, pointInRing } from '../util/rng';
import { STYLE, WALL_H, compoundWall } from './buildingStyle';

// Extruded building footprints merged per 250 m chunk (MAP-SPEC: Buildings), one material.
// Kurnool styles (task K.2): each style has its own colours and wall pattern. The wall
// patterns live in one texture atlas (one row of 8 bays per pattern, one floor tall); the
// shader picks the row from the style and the floor, so the city stays one draw call per
// chunk. Market streets get shutters and colourful signboards on the ground floor, the old
// city small shuttered windows, colony houses a compound wall, outskirts and sheds sloped
// sheet roofs. Flat roofs keep the parapet band and black water tanks.

export const BUILDING_CHUNK = 250;
const FLOOR_M = 3.2; // one window bay / one floor
const BAYS = 8; // the atlas is 8 bays wide
const ROWS = 8; // and 8 patterns tall
const TEX_M = FLOOR_M * BAYS; // metres of wall per texture width
const PARAPET = 0.5;
const TANK_CHANCE = 0.15;

// Wall UV: u = metres along the wall / TEX_M, v = STYLE_V * style + floors above the ground.
// The shader splits v back into style and floor. Style 7 = plain surface (roofs, parapets, walls).
const STYLE_V = 64;
const PLAIN_STYLE = 7;
const PLAIN_V = PLAIN_STYLE * STYLE_V + 0.5;

// Atlas rows.
const ROW = { plain: 0, windows: 1, oldWindows: 2, shops: 3, campus: 4, colony: 5, sheet: 6, oldGround: 7 } as const;

const PALETTES: Record<number, number[]> = {
  // Cream, pale yellow, light blue, pink, mint, white, unpainted grey. Cream and white repeat (more common).
  [STYLE.plain]: [0xf1e3c6, 0xf3e39b, 0xb9d4e6, 0xefb7c0, 0xbfe3cf, 0xf4f1ea, 0xa9a6a3, 0xf1e3c6, 0xf4f1ea, 0xe8d8b8],
  // Old city: lime wash, ochre, faded indigo, terracotta, pale green, dusty pink.
  [STYLE.old]: [0xe9dcc0, 0xd9b26a, 0x8fa9c9, 0xc98f6f, 0xb8c9a3, 0xe7e2d8, 0xd7a9a0, 0xe9dcc0],
  // Colony houses: bright pastels.
  [STYLE.colony]: [0xf2b8c6, 0xb9e3c6, 0xa9d1ef, 0xcdb8e8, 0xf5e6c4, 0xf7c8a0, 0xf4f1ea, 0xe9f0a0],
  // Market blocks above the shops: concrete and cream.
  [STYLE.market]: [0xd8d3ca, 0xece4d4, 0xc9c4bd, 0xe6d6b8, 0xbfcad3, 0xf0e6c8],
  // Campuses: white, cream, pale yellow, sandstone.
  [STYLE.campus]: [0xf4f1ea, 0xefe2c0, 0xe8d8a8, 0xd9c7b5, 0xf4f1ea],
  // Outskirts: cement, mud, whitewash.
  [STYLE.outskirts]: [0xb8b2a8, 0xc9a882, 0xe8e4dc, 0xa9a39a, 0xd9c3a0, 0xe8e4dc],
  // Sheds and godowns.
  [STYLE.industrial]: [0xa7adb3, 0x8f979e, 0xb9b4a8, 0x7f8f9f],
};
const SHEET_ROOFS = [0x9a9a94, 0x9a9a94, 0xa85a3c, 0x4f6f8f, 0x8a8f86];
const ROOF_GREY = new THREE.Color(0x8f8a86);
const TANK = new THREE.Color(0x26252c);

/** Draws the wall atlas and the matching lit-window (emissive) atlas. */
function atlasTextures(anisotropy: number): { map: THREE.CanvasTexture; lit: THREE.CanvasTexture } {
  const T = 64;
  const S = T * BAYS;
  const wall = document.createElement('canvas');
  const lit = document.createElement('canvas');
  wall.width = lit.width = S;
  wall.height = lit.height = T * ROWS;
  const g = wall.getContext('2d');
  const l = lit.getContext('2d');
  if (!g || !l) throw new Error('2D canvas not available for building textures');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, T * ROWS);
  l.fillStyle = '#000000';
  l.fillRect(0, 0, S, T * ROWS);
  const rng = makeRng(20261125);
  // Row r is drawn upside down in the canvas (textures are flipped): top-left of bay bx in row r.
  const at = (r: number, bx: number): [number, number] => [bx * T, (ROWS - 1 - r) * T];
  const rect = (c: CanvasRenderingContext2D, col: string, x: number, y: number, w: number, h: number): void => {
    c.fillStyle = col;
    c.fillRect(x, y, w, h);
  };
  const glow = (x: number, y: number, w: number, h: number, chance: number): void => {
    if (rng() < chance) rect(l, rng() < 0.5 ? '#ffcf8a' : '#ffe2b0', x, y, w, h);
  };

  for (let bx = 0; bx < BAYS; bx++) {
    // Row 1, ordinary windows (bay 0 plain). Window from 0.7 m to 2.3 m above the floor, 1.4 m wide.
    if (bx > 0) {
      const [x0, y0] = at(ROW.windows, bx);
      const x = x0 + 18, y = y0 + 18;
      rect(g, '#d9d2c8', x - 3, y + 32, 34, 4); // sill
      rect(g, '#4a4f66', x, y, 28, 32);
      rect(g, '#5d6480', x + 13, y, 2, 32); // mullion
      glow(x, y, 28, 32, 0.35);
    }
    // Row 2, old city and outskirts: small windows with painted wooden shutters, more wall.
    if (bx !== 0 && bx !== 5) {
      const [x0, y0] = at(ROW.oldWindows, bx);
      const x = x0 + 22, y = y0 + 20;
      const shutter = ['#4f7f6a', '#3f6390', '#7a4b33', '#5f8f8a'][Math.floor(rng() * 4)];
      rect(g, '#3a3530', x, y, 20, 26);
      glow(x, y, 20, 26, 0.3);
      rect(g, shutter, x - 9, y, 8, 26);
      rect(g, shutter, x + 21, y, 8, 26);
      rect(g, '#cfc6b4', x - 10, y + 26, 40, 3); // sill
      rect(g, '#b9ae98', x - 10, y - 5, 40, 3); // lintel
    }
    // Row 3, market ground floor: signboard band, then a rolling shutter (open or closed) between pillars.
    {
      const [x0, y0] = at(ROW.shops, bx);
      rect(g, '#bdb7ad', x0, y0, T, T); // pillars and fascia
      const board = ['#d62f2f', '#f2c12e', '#2f6fd6', '#2f9e4f', '#ef7d22', '#c2338f', '#f4f1ea', '#20a3a3'][bx];
      rect(g, board, x0 + 2, y0 + 2, T - 4, 16);
      const ink = board === '#f2c12e' || board === '#f4f1ea' ? '#7a1f1f' : '#ffffff';
      for (let k = 0, cx = x0 + 7; k < 4; k++) {
        const w = 6 + Math.floor(rng() * 7);
        rect(g, ink, cx, y0 + 7, w, 6); // "lettering"
        cx += w + 3;
      }
      rect(l, board, x0 + 2, y0 + 2, T - 4, 16); // boards glow a little at dusk
      const open = rng() < 0.45;
      const sx = x0 + 5, sy = y0 + 22, sw = T - 10, sh = T - 22;
      if (open) {
        rect(g, '#2c241e', sx, sy, sw, sh);
        for (let k = 0; k < 5; k++) {
          rect(g, ['#c94f3d', '#e0b040', '#3f7fc9', '#5fae5f', '#e07fb0'][k], sx + 3 + k * 10, sy + 10 + Math.floor(rng() * 14), 7, 10);
        }
        rect(l, '#ffd59a', sx, sy, sw, sh);
      } else {
        const col = ['#8d9096', '#4d6fa3', '#4f8a5b', '#6b6e74'][Math.floor(rng() * 4)];
        rect(g, col, sx, sy, sw, sh);
        g.fillStyle = 'rgba(0,0,0,0.18)';
        for (let yy = sy + 3; yy < sy + sh; yy += 4) g.fillRect(sx, yy, sw, 1);
      }
    }
    // Row 4, campus: a long ribbon of windows across every bay (bay 0 plain).
    if (bx > 0) {
      const [x0, y0] = at(ROW.campus, bx);
      rect(g, '#455066', x0, y0 + 20, T, 22);
      rect(g, '#d9d2c8', x0, y0 + 42, T, 4);
      for (let k = 0; k < 4; k++) rect(g, '#6a7590', x0 + k * 16, y0 + 20, 2, 22);
      glow(x0, y0 + 20, T, 22, 0.4);
    }
    // Row 5, colony houses: barred windows under a concrete sunshade (bay 0 plain).
    if (bx > 0) {
      const [x0, y0] = at(ROW.colony, bx);
      const x = x0 + 16, y = y0 + 20;
      rect(g, '#9c958a', x - 6, y - 7, 44, 5); // sunshade (chajja)
      rect(g, '#40465a', x, y, 32, 26);
      glow(x, y, 32, 26, 0.35);
      g.fillStyle = '#c8c8c8';
      for (let k = 4; k < 32; k += 6) g.fillRect(x + k, y, 1, 26);
      g.fillRect(x, y + 13, 32, 1);
    }
    // Row 6, sheds: corrugated sheet with a high vent every other bay.
    {
      const [x0, y0] = at(ROW.sheet, bx);
      for (let k = 0; k < T; k += 4) rect(g, k % 8 === 0 ? '#e8e8e8' : '#c4c4c4', x0 + k, y0, 2, T);
      if (bx % 2 === 0) rect(g, '#3a3f48', x0 + 18, y0 + 6, 28, 8);
    }
    // Row 7, old city ground floor: doors and narrow shop shutters.
    {
      const [x0, y0] = at(ROW.oldGround, bx);
      const kind = bx % 3;
      if (kind === 0) {
        rect(g, '#6b4a33', x0 + 20, y0 + 18, 24, 46); // wooden door
        rect(g, '#8a6a4f', x0 + 31, y0 + 18, 2, 46);
      } else if (kind === 1) {
        rect(g, ['#4d6fa3', '#4f8a5b', '#8d9096'][Math.floor(rng() * 3)], x0 + 8, y0 + 22, 48, 42);
        g.fillStyle = 'rgba(0,0,0,0.2)';
        for (let yy = y0 + 25; yy < y0 + 64; yy += 4) g.fillRect(x0 + 8, yy, 48, 1);
      } else {
        rect(g, '#2c241e', x0 + 10, y0 + 24, 44, 40); // open shop
        rect(l, '#ffd59a', x0 + 10, y0 + 24, 44, 40);
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

// Style -> atlas row for the ground floor and for upper floors. Shop rows are not tinted by the wall colour.
const ATLAS_GLSL = /* glsl */ `
float atlasUntint = 0.0;
vec4 atlasSample(sampler2D tex, vec2 uv) {
  float s = floor(uv.y / ${STYLE_V.toFixed(1)});
  float vf = uv.y - s * ${STYLE_V.toFixed(1)};
  bool ground = vf < 1.0;
  float row = ${ROW.windows.toFixed(1)};
  if (s == ${STYLE.old.toFixed(1)}) row = ground ? ${ROW.oldGround.toFixed(1)} : ${ROW.oldWindows.toFixed(1)};
  else if (s == ${STYLE.colony.toFixed(1)}) row = ${ROW.colony.toFixed(1)};
  else if (s == ${STYLE.market.toFixed(1)}) row = ground ? ${ROW.shops.toFixed(1)} : ${ROW.windows.toFixed(1)};
  else if (s == ${STYLE.campus.toFixed(1)}) row = ${ROW.campus.toFixed(1)};
  else if (s == ${STYLE.outskirts.toFixed(1)}) row = ${ROW.oldWindows.toFixed(1)};
  else if (s == ${STYLE.industrial.toFixed(1)}) row = ${ROW.sheet.toFixed(1)};
  else if (s == ${PLAIN_STYLE.toFixed(1)}) row = ${ROW.plain.toFixed(1)};
  atlasUntint = row == ${ROW.shops.toFixed(1)} ? 1.0 : 0.0;
  vec2 cont = vec2(uv.x, vf / ${ROWS.toFixed(1)});
  vec2 auv = vec2(uv.x, (row + fract(vf)) / ${ROWS.toFixed(1)});
  return textureGrad(tex, auv, dFdx(cont), dFdy(cont));
}
`;

function patchAtlas(mat: THREE.MeshLambertMaterial): void {
  const swap = (src: string, from: string, to: string): string => {
    if (!src.includes(from)) throw new Error(`Building shader patch failed: "${from}" not found (three.js changed?)`);
    return src.replace(from, to);
  };
  const chunk = THREE.ShaderChunk;
  const mapChunk = swap(chunk.map_fragment, 'texture2D( map, vMapUv )', 'atlasSample( map, vMapUv )');
  const litChunk = swap(chunk.emissivemap_fragment, 'texture2D( emissiveMap, vEmissiveMapUv )', 'atlasSample( emissiveMap, vEmissiveMapUv )');
  const colChunk = swap(chunk.color_fragment, 'diffuseColor *= vColor;', 'diffuseColor.rgb *= mix( vColor.rgb, vec3( 1.0 ), atlasUntint );');
  mat.onBeforeCompile = (shader) => {
    let fs = shader.fragmentShader;
    fs = swap(fs, '#include <common>', `#include <common>\n${ATLAS_GLSL}`);
    fs = swap(fs, '#include <map_fragment>', mapChunk);
    fs = swap(fs, '#include <color_fragment>', colChunk);
    if (fs.includes('#include <emissivemap_fragment>')) fs = fs.replace('#include <emissivemap_fragment>', litChunk);
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => 'kurnool-building-atlas';
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

const wallC = new THREE.Color();
const bandC = new THREE.Color();
const roofC = new THREE.Color();
const white = new THREE.Color(0xffffff);

/** Walls of a ring from y0 to y1 with the style's pattern (or plain), floors counted from the ground. */
function walls(mb: SolidMeshBuilder, ring: Pt[], y0: number, y1: number, styleV: number | null, uOff: number, c: THREE.Color): void {
  const n = ring.length;
  let along = 0;
  for (let k = 0; k < n; k++) {
    const a = ring[k];
    const e = ring[(k + 1) % n];
    const dx = e[0] - a[0];
    const dz = e[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    // Rings have positive shoelace area, so the outward normal of edge (dx, dz) is (dz, -dx).
    const nx = dz / len;
    const nz = -dx / len;
    const u0 = uOff + along / TEX_M;
    const u1 = uOff + (along + len) / TEX_M;
    const v0 = styleV === null ? PLAIN_V : styleV + y0 / FLOOR_M;
    const v1 = styleV === null ? PLAIN_V : styleV + y1 / FLOOR_M;
    const p0 = mb.vertex(a[0], y0, a[1], nx, 0, nz, u0, v0, c);
    const q0 = mb.vertex(e[0], y0, e[1], nx, 0, nz, u1, v0, c);
    const q1 = mb.vertex(e[0], y1, e[1], nx, 0, nz, u1, v1, c);
    const p1 = mb.vertex(a[0], y1, a[1], nx, 0, nz, u0, v1, c);
    mb.tri(p0, q0, q1);
    mb.tri(p0, q1, p1);
    along += len;
  }
}

/** Gable roof over a four-cornered house, ridge along the longer sides. Returns false if the ring does not suit. */
function gableRoof(mb: SolidMeshBuilder, ring: Pt[], h: number, roof: THREE.Color, gable: THREE.Color): boolean {
  if (ring.length !== 4) return false;
  const len = (i: number): number => Math.hypot(ring[(i + 1) % 4][0] - ring[i][0], ring[(i + 1) % 4][1] - ring[i][1]);
  const k = len(0) + len(2) >= len(1) + len(3) ? 0 : 1; // long sides are k and k + 2
  const short = Math.min(len(k + 1), len((k + 3) % 4));
  if (short < 2.5) return false;
  const rise = Math.min(3, Math.max(0.8, short * 0.22));
  const [a, b, c, d] = [ring[k], ring[(k + 1) % 4], ring[(k + 2) % 4], ring[(k + 3) % 4]];
  const ridge0: Pt = [(d[0] + a[0]) / 2, (d[1] + a[1]) / 2];
  const ridge1: Pt = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
  const top = h + rise;
  const slope = (p: Pt, q: Pt, r1: Pt, r0: Pt): void => {
    // Normal from the plane through p, q and the ridge, pointing up.
    const ux = q[0] - p[0], uy = 0, uz = q[1] - p[1];
    const vx = r0[0] - p[0], vy = rise, vz = r0[1] - p[1];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    const i0 = mb.vertex(p[0], h, p[1], nx, ny, nz, 0, PLAIN_V, roof);
    const i1 = mb.vertex(q[0], h, q[1], nx, ny, nz, 0, PLAIN_V, roof);
    const i2 = mb.vertex(r1[0], top, r1[1], nx, ny, nz, 0, PLAIN_V, roof);
    const i3 = mb.vertex(r0[0], top, r0[1], nx, ny, nz, 0, PLAIN_V, roof);
    mb.tri(i0, i1, i2);
    mb.tri(i0, i2, i3);
  };
  slope(a, b, ridge1, ridge0);
  slope(c, d, ridge0, ridge1);
  const gableTri = (p: Pt, q: Pt, r: Pt): void => {
    const dx = q[0] - p[0], dz = q[1] - p[1];
    const L = Math.hypot(dx, dz) || 1;
    const nx = dz / L, nz = -dx / L;
    mb.tri(
      mb.vertex(p[0], h, p[1], nx, 0, nz, 0, PLAIN_V, gable),
      mb.vertex(q[0], h, q[1], nx, 0, nz, 0, PLAIN_V, gable),
      mb.vertex(r[0], top, r[1], nx, 0, nz, 0, PLAIN_V, gable),
    );
  };
  gableTri(b, c, ridge1);
  gableTri(d, a, ridge0);
  return true;
}

function flatRoof(mb: SolidMeshBuilder, ring: Pt[], h: number, c: THREE.Color): void {
  const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const idx = ring.map(([x, z]) => mb.vertex(x, h, z, 0, 1, 0, 0, PLAIN_V, c));
  for (const [p, q, r] of tris) mb.tri(idx[p], idx[q], idx[r]);
}

function waterTank(mb: SolidMeshBuilder, cx: number, cz: number, h: number): void {
  const R = 0.75;
  const H = 1.3;
  const sides = 8;
  const top = mb.vertex(cx, h + H, cz, 0, 1, 0, 0, PLAIN_V, TANK);
  const topRing: number[] = [];
  for (let s = 0; s < sides; s++) {
    const t0 = (s / sides) * Math.PI * 2;
    const t1 = ((s + 1) / sides) * Math.PI * 2;
    const tm = (t0 + t1) / 2;
    const nx = Math.cos(tm);
    const nz = Math.sin(tm);
    const x0 = cx + Math.cos(t0) * R, z0 = cz + Math.sin(t0) * R;
    const x1 = cx + Math.cos(t1) * R, z1 = cz + Math.sin(t1) * R;
    const w0 = mb.vertex(x0, h, z0, nx, 0, nz, 0, PLAIN_V, TANK);
    const w1 = mb.vertex(x1, h, z1, nx, 0, nz, 0, PLAIN_V, TANK);
    const w2 = mb.vertex(x1, h + H, z1, nx, 0, nz, 0, PLAIN_V, TANK);
    const w3 = mb.vertex(x0, h + H, z0, nx, 0, nz, 0, PLAIN_V, TANK);
    mb.tri(w0, w1, w2);
    mb.tri(w0, w2, w3);
    topRing.push(mb.vertex(x0, h + H, z0, 0, 1, 0, 0, PLAIN_V, TANK));
  }
  for (let s = 0; s < sides; s++) mb.tri(top, topRing[s], topRing[(s + 1) % sides]);
}

/** Thin compound wall (both faces) along open polylines. */
function compound(mb: SolidMeshBuilder, lines: Pt[][], c: THREE.Color): void {
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const e = line[i];
      const dx = e[0] - a[0];
      const dz = e[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      for (const side of [1, -1]) {
        const nx = (side * dz) / len;
        const nz = (-side * dx) / len;
        const p0 = mb.vertex(a[0], 0, a[1], nx, 0, nz, 0, PLAIN_V, c);
        const q0 = mb.vertex(e[0], 0, e[1], nx, 0, nz, 0, PLAIN_V, c);
        const q1 = mb.vertex(e[0], WALL_H, e[1], nx, 0, nz, 0, PLAIN_V, c);
        const p1 = mb.vertex(a[0], WALL_H, a[1], nx, 0, nz, 0, PLAIN_V, c);
        mb.tri(p0, q0, q1);
        mb.tri(p0, q1, p1);
      }
    }
  }
}

function addBuilding(mb: SolidMeshBuilder, b: Building, i: number): void {
  const ring = b.pts;
  const n = ring.length;
  const rng = makeRng((i * 2654435761) >>> 0);
  const style = b.style in PALETTES ? b.style : STYLE.plain;
  const pal = PALETTES[style];
  wallC.setHex(pal[Math.floor(rng() * pal.length)]);
  bandC.copy(wallC).lerp(white, 0.25);
  roofC.copy(wallC).lerp(ROOF_GREY, 0.65).multiplyScalar(0.8);
  // Tiny height offset so neighbouring roofs never share a plane (no z-fighting).
  const h = b.h + (i % 7) * 0.03;
  const styleV = style * STYLE_V;
  const uOff = Math.floor(rng() * BAYS) / BAYS; // start at a random bay, so neighbours differ

  let cx = 0;
  let cz = 0;
  for (const p of ring) {
    cx += p[0];
    cz += p[1];
  }
  cx /= n;
  cz /= n;

  const sloped =
    (style === STYLE.industrial || (style === STYLE.outskirts && rng() < 0.45)) && n === 4 && Math.abs(ringArea(ring)) < 1500;
  if (sloped) {
    walls(mb, ring, 0, h, styleV, uOff, wallC);
    roofC.setHex(SHEET_ROOFS[Math.floor(rng() * SHEET_ROOFS.length)]);
    if (gableRoof(mb, ring, h, roofC, wallC)) return;
    roofC.copy(wallC).lerp(ROOF_GREY, 0.65).multiplyScalar(0.8);
    flatRoof(mb, ring, h, roofC);
    return;
  }

  const body = h >= 6 ? h - PARAPET : h;
  walls(mb, ring, 0, body, styleV, uOff, wallC);
  if (body < h) walls(mb, ring, body, h, null, 0, bandC);
  flatRoof(mb, ring, h, roofC);
  if (rng() < TANK_CHANCE && Math.abs(ringArea(ring)) > 50 && pointInRing(cx, cz, ring)) waterTank(mb, cx, cz, h);

  const wall = compoundWall(b);
  if (wall) compound(mb, wall, bandC);
}

export function buildBuildings(map: MapData, quality: QualitySettings, anisotropy: number): THREE.Group {
  const chunks = new Map<string, SolidMeshBuilder>();
  const chunkFor = (x: number, z: number): SolidMeshBuilder => {
    const k = `${Math.floor(x / BUILDING_CHUNK)},${Math.floor(z / BUILDING_CHUNK)}`;
    let mb = chunks.get(k);
    if (!mb) chunks.set(k, (mb = new SolidMeshBuilder()));
    return mb;
  };

  map.buildings.forEach((b, i) => {
    if (b.pts.length < 3) return;
    const [x, z] = b.pts[0];
    addBuilding(chunkFor(x, z), b, i);
  });

  const tex = atlasTextures(anisotropy);
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: tex.map,
    emissive: quality.litWindows ? 0xffffff : 0x000000,
    emissiveMap: quality.litWindows ? tex.lit : null,
    emissiveIntensity: 0.85,
  });
  if (!quality.litWindows) tex.lit.dispose();
  patchAtlas(mat);

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
