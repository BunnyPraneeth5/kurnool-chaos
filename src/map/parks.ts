import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapData, Pt } from './types';
import type { QualitySettings } from '../world/quality';
import { FlatMeshBuilder } from './meshBuilder';
import { makeRng, pointInRing } from '../util/rng';

// Green park patches plus low-poly trees, instanced per 500 m chunk.

const PARK_Y = 0.02;
const M2_PER_TREE = 140;
const MAX_TREES_PER_PARK = 40;
const TREE_CHUNK = 500;

function area(r: Pt[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i];
    const q = r[(i + 1) % r.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}

function treeGeometry(): THREE.BufferGeometry {
  const paint = (g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry => {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.deleteAttribute('uv');
    const c = new THREE.Color(hex);
    const cols = new Float32Array(ng.attributes.position.count * 3);
    for (let i = 0; i < cols.length; i += 3) {
      cols[i] = c.r;
      cols[i + 1] = c.g;
      cols[i + 2] = c.b;
    }
    ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return ng;
  };
  // Open four-sided trunk (8 triangles); its top is hidden inside the canopy.
  const trunk = paint(new THREE.CylinderGeometry(0.18, 0.22, 2.2, 4, 1, true).translate(0, 1.1, 0), 0x6b4a35);
  const canopy = paint(new THREE.IcosahedronGeometry(1.9, 0).translate(0, 3.5, 0), 0x55804c);
  const merged = mergeGeometries([trunk, canopy]);
  if (!merged) throw new Error('Could not build the tree model');
  return merged;
}

export function buildParks(map: MapData, quality: QualitySettings): THREE.Group {
  const group = new THREE.Group();
  group.name = 'parks';

  const mb = new FlatMeshBuilder();
  const green = new THREE.Color();
  const trees: { x: number; z: number; s: number; r: number; tint: number }[] = [];

  map.parks.forEach((park, i) => {
    const ring = park.pts;
    if (ring.length < 3) return;
    const rng = makeRng((i * 2246822519 + 7) >>> 0);
    green.setHSL(0.27 + rng() * 0.06, 0.32, 0.3 + rng() * 0.06);
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    const idx = ring.map(([x, z]) => mb.vertex(x, PARK_Y, z, green));
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) mb.tri(idx[a], idx[b], idx[c]);

    // Trees at random spots inside the park.
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of ring) {
      x0 = Math.min(x0, x); z0 = Math.min(z0, z);
      x1 = Math.max(x1, x); z1 = Math.max(z1, z);
    }
    const want = Math.floor(Math.min(MAX_TREES_PER_PARK, area(ring) / M2_PER_TREE) * quality.treeDensity);
    for (let t = 0, placed = 0; t < want * 6 && placed < want; t++) {
      const x = x0 + rng() * (x1 - x0);
      const z = z0 + rng() * (z1 - z0);
      if (!pointInRing(x, z, ring)) continue;
      trees.push({ x, z, s: 0.8 + rng() * 0.6, r: rng() * Math.PI * 2, tint: rng() });
      placed++;
    }
  });

  if (!mb.empty) {
    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    group.add(new THREE.Mesh(mb.build(), mat));
  }

  // One instanced mesh per 500 m chunk, so trees out of view are culled.
  const byChunk = new Map<string, typeof trees>();
  for (const t of trees) {
    const k = `${Math.floor(t.x / TREE_CHUNK)},${Math.floor(t.z / TREE_CHUNK)}`;
    let list = byChunk.get(k);
    if (!list) byChunk.set(k, (list = []));
    list.push(t);
  }
  if (byChunk.size) {
    const geo = treeGeometry();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    for (const [key, list] of byChunk) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((t, i) => {
        q.setFromAxisAngle(up, t.r);
        p.set(t.x, 0, t.z);
        s.setScalar(t.s);
        mesh.setMatrixAt(i, m.compose(p, q, s));
        mesh.setColorAt(i, c.setHSL(0.25 + t.tint * 0.1, 0.25, 0.85 + t.tint * 0.3));
      });
      mesh.computeBoundingSphere();
      mesh.name = `trees ${key}`;
      group.add(mesh);
    }
  }
  return group;
}
