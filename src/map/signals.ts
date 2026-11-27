import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapData } from './types';
import { groundY } from './terrain';
import { junctionsOf, lightFor, type Junction } from '../ai/junctions';

// Junction scenery (task H.6): signal poles with red/amber/green lamps facing the traffic
// that stops there, and a traffic policeman on a stand at Raj Vihar and C-Camp. All poles
// are one mesh and all lamps one instanced mesh, so phones pay a few draw calls in total.

const LAMP_ON = { red: new THREE.Color(0xff3a2a), amber: new THREE.Color(0xffb020), green: new THREE.Color(0x3cff6a) };
const LAMP_OFF = new THREE.Color(0x1d1b22);
const ORDER = ['red', 'amber', 'green'] as const;

interface Policeman {
  j: Junction;
  body: THREE.Group;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
}

export class JunctionScenery {
  readonly group = new THREE.Group();
  private lamps: THREE.InstancedMesh | null = null;
  /** per approach: junction, group, first lamp index */
  private readonly heads: { j: Junction; g: 0 | 1; i: number; last: string }[] = [];
  private readonly police: Policeman[] = [];

  constructor(map: MapData) {
    this.group.name = 'junctions';
    const all = junctionsOf(map).list;
    const poleGeos: THREE.BufferGeometry[] = [];
    const lampAt: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const j of all) {
      if (j.police) {
        this.police.push(this.policeman(j));
        continue;
      }
      for (const a of j.approaches) {
        const y = groundY(a.pole[0], a.pole[1]);
        const face = a.heading + Math.PI; // the lamps look back at arriving traffic
        q.setFromAxisAngle(up, face);
        const pole = new THREE.BoxGeometry(0.16, 3.6, 0.16).translate(0, 1.8, 0);
        const head = new THREE.BoxGeometry(0.42, 1.15, 0.3).translate(0, 3.9, 0);
        for (const g of [pole, head]) {
          g.applyMatrix4(m.compose(new THREE.Vector3(a.pole[0], y, a.pole[1]), q, new THREE.Vector3(1, 1, 1)));
          poleGeos.push(g);
        }
        const first = lampAt.length;
        for (let k = 0; k < 3; k++) {
          const local = new THREE.Vector3(0, 4.25 - k * 0.35, 0.17).applyQuaternion(q);
          lampAt.push(new THREE.Matrix4().compose(new THREE.Vector3(a.pole[0], y, a.pole[1]).add(local), q, new THREE.Vector3(1, 1, 1)));
        }
        this.heads.push({ j, g: a.group, i: first, last: '' });
      }
    }
    if (poleGeos.length) {
      const merged = mergeGeometries(poleGeos);
      for (const g of poleGeos) g.dispose();
      if (merged) this.group.add(new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ color: 0x2a2a30 })));
      const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.26, 0.08), new THREE.MeshBasicMaterial({ color: 0xffffff }), lampAt.length);
      lampAt.forEach((mm, k) => {
        lamps.setMatrixAt(k, mm);
        lamps.setColorAt(k, LAMP_OFF);
      });
      lamps.instanceMatrix.needsUpdate = true;
      this.group.add(lamps);
      this.lamps = lamps;
    }
  }

  /** A traffic policeman in khaki and a white cap, on a striped round stand. */
  private policeman(j: Junction): Policeman {
    const y = groundY(j.x, j.z);
    const g = new THREE.Group();
    g.position.set(j.x, y, j.z);
    const mat = (c: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color: c });
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.9, 16), mat(0xe8e2d2));
    stand.position.y = 0.45;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.22, 0.25, 16), mat(0xd13b32));
    band.position.y = 0.6;
    // Umbrella over the stand (Kurnool summers).
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.6, 0.08), mat(0x55555e));
    pole.position.set(0.7, 2.2, 0);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.6, 12), mat(0xd13b32));
    shade.position.set(0.7, 3.6, 0);
    const body = new THREE.Group();
    body.position.y = 0.9;
    const box = (w: number, h: number, d: number, c: number, x: number, yy: number, z = 0): THREE.Mesh => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
      b.position.set(x, yy, z);
      return b;
    };
    body.add(box(0.26, 0.8, 0.26, 0x6b5a3a, 0.14, 0.4), box(0.26, 0.8, 0.26, 0x6b5a3a, -0.14, 0.4));
    body.add(box(0.6, 0.72, 0.34, 0xb59a62, 0, 1.16), box(0.36, 0.36, 0.36, 0xd9a07c, 0, 1.72), box(0.42, 0.12, 0.42, 0xf4f4f4, 0, 1.94));
    const arm = (side: number): THREE.Object3D => {
      const a = new THREE.Group();
      a.position.set(side * 0.38, 1.48, 0);
      const m = box(0.16, 0.66, 0.16, 0xb59a62, 0, -0.33);
      const glove = box(0.17, 0.14, 0.17, 0xf4f4f4, 0, -0.68);
      a.add(m, glove);
      body.add(a);
      return a;
    };
    const armL = arm(1);
    const armR = arm(-1);
    g.add(stand, band, pole, shade, body);
    this.group.add(g);
    return { j, body, armL, armR };
  }

  /** Lamp colours and the policemen's arms for the time now. */
  update(nowMs: number): void {
    const lamps = this.lamps;
    if (lamps) {
      let dirty = false;
      for (const h of this.heads) {
        const light = lightFor(h.j, h.g, nowMs);
        if (light === h.last) continue;
        h.last = light;
        ORDER.forEach((c, k) => lamps.setColorAt(h.i + k, c === light ? LAMP_ON[c] : LAMP_OFF));
        dirty = true;
      }
      if (dirty && lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
    }
    for (const p of this.police) {
      // Face the direction that has green and wave it through; both arms out when all stop.
      const a0 = p.j.approaches.find((a) => a.group === 0);
      const l0 = lightFor(p.j, 0, nowMs);
      const l1 = lightFor(p.j, 1, nowMs);
      const go = l0 === 'green' ? 0 : l1 === 'green' ? 1 : -1;
      const axis = (a0?.heading ?? 0) + (go === 1 ? Math.PI / 2 : 0);
      p.body.rotation.y += (axis - p.body.rotation.y) * 0.1;
      const wave = Math.sin(nowMs / 180) * 0.6;
      if (go < 0) {
        p.armL.rotation.set(0, 0, Math.PI / 2);
        p.armR.rotation.set(0, 0, -Math.PI / 2);
      } else {
        p.armL.rotation.set(-1.2 + wave, 0, 0.2);
        p.armR.rotation.set(0, 0, -Math.PI / 2);
      }
    }
  }
}
