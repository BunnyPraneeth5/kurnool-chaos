import * as THREE from 'three';
import type { MapData } from './types';
import { FlatMeshBuilder, drapePolygon } from './meshBuilder';
import { LAYER_Y } from './ground';
import { groundY } from './terrain';

// Rivers, canals and tanks, laid on the ground (which the build lowers to the water level
// under water), in 500 m chunks so off-screen water is not drawn.

const CHUNK = 500;
const MAX_EDGE = 20; // m, the terrain grid size

export function buildWater(map: MapData): THREE.Group {
  const chunks = new Map<string, FlatMeshBuilder>();
  const pick = (x: number, z: number): FlatMeshBuilder => {
    const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let mb = chunks.get(k);
    if (!mb) chunks.set(k, (mb = new FlatMeshBuilder()));
    return mb;
  };
  const deep = new THREE.Color(0x3f5f9e);
  const surface = (x: number, z: number): number => groundY(x, z) + LAYER_Y.water;
  for (const w of map.water) drapePolygon(pick, w.pts, w.holes ?? [], surface, deep, MAX_EDGE);

  const mat = new THREE.MeshPhongMaterial({
    vertexColors: true,
    specular: 0xffc7a0,
    shininess: 60,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  const group = new THREE.Group();
  group.name = 'water';
  for (const [k, mb] of chunks) {
    if (mb.empty) continue;
    const mesh = new THREE.Mesh(mb.build(), mat);
    mesh.name = `water ${k}`;
    group.add(mesh);
  }
  return group;
}
