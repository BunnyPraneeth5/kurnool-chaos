import * as THREE from 'three';
import type { MapData } from './types';
import { groundY } from './terrain';
import { loadTeluguFont, TELUGU_FONT } from '../util/fonts';

// Hospitals (task M.7): the map build exports the OSM hospitals (84) with a spot at the road
// in front of each. A player whose health runs out gets up there. Each spot has a small
// white HOSPITAL signboard (English + Telugu, a red cross); all signs share one texture and
// are two instanced meshes, so 84 signs cost two draw calls.

/** Telugu for "hospital" (Bunny check). */
export const HOSPITAL_TE = 'ఆసుపత్రి';

export interface Hospital {
  name: string;
  x: number;
  z: number;
  /** the way the sign faces (towards the road) */
  a: number;
}

export function hospitals(map: MapData): Hospital[] {
  return map.hospitals ?? [];
}

/** The hospital nearest a point (null if the map has none). */
export function nearestHospital(map: MapData, x: number, z: number): Hospital | null {
  let best: Hospital | null = null;
  let bd = Infinity;
  for (const h of hospitals(map)) {
    const d = Math.hypot(h.x - x, h.z - z);
    if (d < bd) {
      bd = d;
      best = h;
    }
  }
  return best;
}

function drawBoard(c: HTMLCanvasElement): void {
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas not available for the hospital signs');
  g.fillStyle = '#f6f3ec';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#c8302c';
  g.lineWidth = 8;
  g.strokeRect(8, 8, c.width - 16, c.height - 16);
  // Red cross on the left.
  g.fillStyle = '#d6342e';
  g.fillRect(44, 58, 84, 28);
  g.fillRect(72, 30, 28, 84);
  g.fillStyle = '#c8302c';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 48px system-ui, sans-serif';
  g.fillText('HOSPITAL', 300, 52);
  g.font = `bold 40px "${TELUGU_FONT}", "Nirmala UI", sans-serif`;
  g.fillText(HOSPITAL_TE, 300, 108);
}

export function buildHospitals(map: MapData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hospitals';
  const list = hospitals(map);
  if (!list.length) return group;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 144;
  drawBoard(c);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  void loadTeluguFont().then((ok) => {
    if (!ok) return;
    drawBoard(c);
    tex.needsUpdate = true;
  });
  const face = new THREE.MeshBasicMaterial({ map: tex });
  const back = new THREE.MeshLambertMaterial({ color: 0xf6f3ec });
  const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(2.8, 0.8, 0.1), [back, back, back, back, face, face], list.length);
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 2.6, 0.12), new THREE.MeshLambertMaterial({ color: 0x5b5b66 }), list.length * 2);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  list.forEach((h, i) => {
    const y = groundY(h.x, h.z);
    q.setFromAxisAngle(up, h.a);
    panels.setMatrixAt(i, m.compose(p.set(h.x, y + 2.5, h.z), q, one));
    for (const [k, side] of [[0, -1.2], [1, 1.2]] as const) {
      p.set(h.x + Math.cos(h.a) * side, y + 1.3, h.z - Math.sin(h.a) * side);
      posts.setMatrixAt(i * 2 + k, m.compose(p, q, one));
    }
  });
  group.add(panels, posts);
  return group;
}
