import * as THREE from 'three';
import type { MapData } from './types';
import { terrain } from './terrain';

// Heights of the flat layers above the ground, in metres. Steps are small so vehicles still
// look grounded; the camera's near plane grows with height to avoid flicker.
export const LAYER_Y = {
  ground: 0,
  water: 0.04,
} as const;

const MARGIN = 2500; // ground beyond the map edge, hidden by fog
const CHUNK_CELLS = 32; // 640 m chunks of the 20 m terrain grid, culled when off screen
const SKIRT_CELL = 200;

const base = new THREE.Color(0x5a4b4a);
const warm = new THREE.Color(0x66503f);
const cool = new THREE.Color(0x4d4652);
const rock = new THREE.Color(0x7a6f68);

/** Dusty ground colour with gentle variation, greyer rock on steep slopes. */
function groundColour(out: THREE.Color, x: number, z: number, slope: number): THREE.Color {
  const n = Math.sin(x * 0.0021 + Math.cos(z * 0.0017) * 2) * 0.5 + Math.sin(z * 0.0031 - x * 0.0011) * 0.5;
  out.copy(base).lerp(n > 0 ? warm : cool, Math.abs(n) * 0.6);
  return out.lerp(rock, Math.min(1, Math.max(0, (slope - 0.12) * 3)));
}

/** The ground: the terrain grid in chunks, plus a coarse skirt out to the fog. */
export function buildGround(map: MapData): THREE.Group {
  const t = terrain();
  const m = t.meta;
  const group = new THREE.Group();
  group.name = 'ground';
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const c = new THREE.Color();

  for (let cj = 0; cj < m.h - 1; cj += CHUNK_CELLS) {
    for (let ci = 0; ci < m.w - 1; ci += CHUNK_CELLS) {
      const nw = Math.min(CHUNK_CELLS, m.w - 1 - ci) + 1;
      const nh = Math.min(CHUNK_CELLS, m.h - 1 - cj) + 1;
      const pos = new Float32Array(nw * nh * 3);
      const nor = new Float32Array(nw * nh * 3);
      const col = new Float32Array(nw * nh * 3);
      for (let j = 0; j < nh; j++) {
        for (let i = 0; i < nw; i++) {
          const gi = ci + i, gj = cj + j;
          const k = (j * nw + i) * 3;
          const x = m.x0 + gi * m.cell;
          const z = m.z0 + gj * m.cell;
          // Normal from the slope (central differences), so chunk edges join without seams.
          const dx = (t.at(gi + 1, gj) - t.at(gi - 1, gj)) / (2 * m.cell);
          const dz = (t.at(gi, gj + 1) - t.at(gi, gj - 1)) / (2 * m.cell);
          const l = Math.hypot(dx, 1, dz);
          pos[k] = x;
          pos[k + 1] = t.at(gi, gj) + LAYER_Y.ground;
          pos[k + 2] = z;
          nor[k] = -dx / l;
          nor[k + 1] = 1 / l;
          nor[k + 2] = -dz / l;
          groundColour(c, x, z, Math.hypot(dx, dz));
          col[k] = c.r;
          col[k + 1] = c.g;
          col[k + 2] = c.b;
        }
      }
      const idx: number[] = [];
      for (let j = 0; j < nh - 1; j++) {
        for (let i = 0; i < nw - 1; i++) {
          const a = j * nw + i, b = a + 1, d = a + nw, e = d + 1;
          idx.push(a, d, b, b, d, e);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = `ground ${ci},${cj}`;
      group.add(mesh);
    }
  }

  // Skirt: a coarse grid out to the fog, kept below the detailed ground everywhere it overlaps.
  const b = map.bounds;
  const sx0 = b.minX - MARGIN, sz0 = b.minZ - MARGIN;
  const sw = Math.ceil((b.maxX - b.minX + 2 * MARGIN) / SKIRT_CELL) + 1;
  const sh = Math.ceil((b.maxZ - b.minZ + 2 * MARGIN) / SKIRT_CELL) + 1;
  const pos = new Float32Array(sw * sh * 3);
  const col = new Float32Array(sw * sh * 3);
  for (let j = 0; j < sh; j++) {
    for (let i = 0; i < sw; i++) {
      const x = sx0 + i * SKIRT_CELL, z = sz0 + j * SKIRT_CELL;
      let lo = Infinity;
      for (let dz = -SKIRT_CELL; dz <= SKIRT_CELL; dz += m.cell * 2) for (let dx = -SKIRT_CELL; dx <= SKIRT_CELL; dx += m.cell * 2) lo = Math.min(lo, t.height(x + dx, z + dz));
      const k = (j * sw + i) * 3;
      pos[k] = x;
      pos[k + 1] = lo - 2;
      pos[k + 2] = z;
      groundColour(c, x, z, 0);
      col[k] = c.r;
      col[k + 1] = c.g;
      col[k + 2] = c.b;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < sh - 1; j++) {
    for (let i = 0; i < sw - 1; i++) {
      const a = j * sw + i, bb = a + 1, d = a + sw, e = d + 1;
      idx.push(a, d, bb, bb, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const skirt = new THREE.Mesh(g, mat);
  skirt.name = 'ground skirt';
  group.add(skirt);
  return group;
}
