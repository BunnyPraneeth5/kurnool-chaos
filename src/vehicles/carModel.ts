import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VehicleParams } from './params';

// Low-poly car built from boxes, ported from the demo's makeCar().

type Part = [w: number, h: number, d: number, x: number, y: number, z: number, color: number];

const carMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const shadowMat = new THREE.MeshBasicMaterial({
  color: 0x140f24,
  transparent: true,
  opacity: 0.34,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

export function buildCarMesh(t: VehicleParams, colour: number): THREE.Object3D {
  const top = 0.35 + t.bodyH;
  const wx = t.w / 2 - 0.05;
  const wz = t.len * 0.31;
  const glass = 0x212943;
  const tyre = 0x121217;
  const parts: Part[] = [
    [t.w, t.bodyH, t.len, 0, 0.35 + t.bodyH / 2, 0, colour],
    [t.w * 0.86, t.cabH, t.cabLen, 0, top + t.cabH / 2, t.cabZ, glass],
    [t.w * 0.9, 0.08, t.cabLen * 0.94, 0, top + t.cabH + 0.04, t.cabZ, colour],
    [0.28, 0.7, 0.7, wx, 0.35, wz, tyre],
    [0.28, 0.7, 0.7, -wx, 0.35, wz, tyre],
    [0.28, 0.7, 0.7, wx, 0.35, -wz, tyre],
    [0.28, 0.7, 0.7, -wx, 0.35, -wz, tyre],
    [0.42, 0.16, 0.08, t.w * 0.3, 0.35 + t.bodyH * 0.62, t.len / 2, 0xfff2b8],
    [0.42, 0.16, 0.08, -t.w * 0.3, 0.35 + t.bodyH * 0.62, t.len / 2, 0xfff2b8],
    [0.42, 0.16, 0.08, t.w * 0.3, 0.35 + t.bodyH * 0.62, -t.len / 2, 0xeb241f],
    [0.42, 0.16, 0.08, -t.w * 0.3, 0.35 + t.bodyH * 0.62, -t.len / 2, 0xeb241f],
  ];
  const c = new THREE.Color();
  const geos = parts.map(([w, h, d, x, y, z, col]) => {
    const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    c.setHex(col);
    const n = g.attributes.position.count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return g;
  });
  const merged = mergeGeometries(geos);
  if (!merged) throw new Error('Could not build the car model');
  const mesh = new THREE.Mesh(merged, carMat);
  mesh.rotation.order = 'YXZ';
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(t.w + 0.7, t.len + 0.6).rotateX(-Math.PI / 2), shadowMat);
  shadow.position.y = 0.2;
  mesh.add(shadow);
  return mesh;
}
