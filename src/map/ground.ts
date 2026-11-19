import * as THREE from 'three';
import type { MapData } from './types';

// Heights of the flat layers, in metres. Steps are small so vehicles still look
// grounded; the camera's near plane grows with height to avoid flicker.
export const LAYER_Y = {
  ground: 0,
  water: 0.04,
} as const;

const MARGIN = 2500; // ground beyond the map edge, hidden by fog

/** One big dusty ground plane with gentle colour variation. */
export function buildGround(map: MapData): THREE.Mesh {
  const b = map.bounds;
  const w = b.maxX - b.minX + MARGIN * 2;
  const h = b.maxZ - b.minZ + MARGIN * 2;
  const geo = new THREE.PlaneGeometry(w, h, 96, 96);
  geo.rotateX(-Math.PI / 2);
  geo.translate((b.minX + b.maxX) / 2, LAYER_Y.ground, (b.minZ + b.maxZ) / 2);

  const pos = geo.attributes.position;
  const base = new THREE.Color(0x5a4b4a);
  const warm = new THREE.Color(0x66503f);
  const cool = new THREE.Color(0x4d4652);
  const c = new THREE.Color();
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const n = Math.sin(x * 0.0021 + Math.cos(z * 0.0017) * 2) * 0.5 + Math.sin(z * 0.0031 - x * 0.0011) * 0.5;
    c.copy(base).lerp(n > 0 ? warm : cool, Math.abs(n) * 0.6);
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));

  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'ground';
  mesh.renderOrder = 0;
  return mesh;
}
