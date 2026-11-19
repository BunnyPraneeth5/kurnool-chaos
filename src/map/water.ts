import * as THREE from 'three';
import type { MapData } from './types';
import { FlatMeshBuilder } from './meshBuilder';
import { LAYER_Y } from './ground';

/** Rivers, canals and tanks as one flat mesh, triangulated with earcut via ShapeUtils. */
export function buildWater(map: MapData): THREE.Mesh {
  const mb = new FlatMeshBuilder();
  const deep = new THREE.Color(0x3f5f9e);
  const y = LAYER_Y.water;
  for (const w of map.water) {
    const contour = w.pts.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const base = w.pts.map(([x, z]) => mb.vertex(x, y, z, deep));
    for (const [a, b, c] of tris) mb.tri(base[a], base[b], base[c]);
  }
  const mat = new THREE.MeshPhongMaterial({
    vertexColors: true,
    specular: 0xffc7a0,
    shininess: 60,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(mb.build(), mat);
  mesh.name = 'water';
  return mesh;
}
