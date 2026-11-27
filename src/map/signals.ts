import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapData } from './types';
import { groundY } from './terrain';
import { junctionsOf, lightFor, type Junction } from '../ai/junctions';

// Junction scenery (task H.6): signal poles with red/amber/green lamps facing the traffic
// that stops there, and a traffic policeman on a stand at Raj Vihar and C-Camp. All poles
// and lamps are merged per 500 m chunk (one mesh and one instanced mesh each), so phones only
// draw the few chunks on screen.

const LAMP_ON = { red: new THREE.Color(0xff3a2a), amber: new THREE.Color(0xffb020), green: new THREE.Color(0x3cff6a) };
const LAMP_OFF = new THREE.Color(0x1d1b22);
const ORDER = ['red', 'amber', 'green'] as const;
const policeMat = new THREE.MeshLambertMaterial({ vertexColors: true });

interface Policeman {
  j: Junction;
  body: THREE.Group;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
}

const CHUNK = 500; // m: poles and lamps are merged per chunk so off-screen ones are culled

interface Head {
  j: Junction;
  g: 0 | 1;
  lamps: THREE.InstancedMesh;
  i: number;
  last: string;
}

export class JunctionScenery {
  readonly group = new THREE.Group();
  /** per approach: junction, group, its chunk's lamps and first lamp index */
  private readonly heads: Head[] = [];
  private readonly police: Policeman[] = [];

  constructor(map: MapData) {
    this.group.name = 'junctions';
    const all = junctionsOf(map).list;
    const chunks = new Map<string, { poles: THREE.BufferGeometry[]; lamps: THREE.Matrix4[]; heads: Omit<Head, 'lamps'>[] }>();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    for (const j of all) {
      if (j.police) {
        this.police.push(this.policeman(j));
        continue;
      }
      const key = `${Math.floor(j.x / CHUNK)},${Math.floor(j.z / CHUNK)}`;
      let c = chunks.get(key);
      if (!c) chunks.set(key, (c = { poles: [], lamps: [], heads: [] }));
      for (const a of j.approaches) {
        const y = groundY(a.pole[0], a.pole[1]);
        const face = a.heading + Math.PI; // the lamps look back at arriving traffic
        q.setFromAxisAngle(up, face);
        const pole = new THREE.BoxGeometry(0.16, 3.6, 0.16).translate(0, 1.8, 0);
        const head = new THREE.BoxGeometry(0.42, 1.15, 0.3).translate(0, 3.9, 0);
        for (const g of [pole, head]) {
          g.applyMatrix4(m.compose(new THREE.Vector3(a.pole[0], y, a.pole[1]), q, one));
          c.poles.push(g);
        }
        const first = c.lamps.length;
        for (let k = 0; k < 3; k++) {
          const local = new THREE.Vector3(0, 4.25 - k * 0.35, 0.17).applyQuaternion(q);
          c.lamps.push(new THREE.Matrix4().compose(new THREE.Vector3(a.pole[0], y, a.pole[1]).add(local), q, one));
        }
        c.heads.push({ j, g: a.group, i: first, last: '' });
      }
    }
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x2a2a30 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lampGeo = new THREE.BoxGeometry(0.26, 0.26, 0.08);
    for (const c of chunks.values()) {
      const merged = mergeGeometries(c.poles);
      for (const g of c.poles) g.dispose();
      if (merged) this.group.add(new THREE.Mesh(merged, poleMat));
      const lamps = new THREE.InstancedMesh(lampGeo, lampMat, c.lamps.length);
      c.lamps.forEach((mm, k) => {
        lamps.setMatrixAt(k, mm);
        lamps.setColorAt(k, LAMP_OFF);
      });
      lamps.instanceMatrix.needsUpdate = true;
      lamps.computeBoundingSphere();
      this.group.add(lamps);
      for (const h of c.heads) this.heads.push({ ...h, lamps });
    }
  }

  /** A traffic policeman in khaki and a white cap, on a striped round stand. */
  private policeman(j: Junction): Policeman {
    const y = groundY(j.x, j.z);
    const g = new THREE.Group();
    g.position.set(j.x, y, j.z);
    // Few meshes: the stand and umbrella, the body, and the two arms (vertex colours).
    const part = (geo: THREE.BufferGeometry, colour: number, x: number, yy: number, z = 0): THREE.BufferGeometry => {
      const out = geo.toNonIndexed().translate(x, yy, z);
      geo.dispose();
      const c = new THREE.Color(colour);
      const n = out.attributes.position.count;
      const cols = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b], i * 3);
      out.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      out.deleteAttribute('uv');
      return out;
    };
    const merge = (parts: THREE.BufferGeometry[]): THREE.Mesh => {
      const geo = mergeGeometries(parts);
      if (!geo) throw new Error('Could not build the traffic policeman');
      return new THREE.Mesh(geo, policeMat);
    };
    const box = (w: number, h: number, d: number, c: number, x: number, yy: number, z = 0): THREE.BufferGeometry => part(new THREE.BoxGeometry(w, h, d), c, x, yy, z);
    // The stand, its red band and the umbrella (Kurnool summers).
    g.add(
      merge([
        part(new THREE.CylinderGeometry(1.2, 1.3, 0.9, 16), 0xe8e2d2, 0, 0.45),
        part(new THREE.CylinderGeometry(1.22, 1.22, 0.25, 16), 0xd13b32, 0, 0.6),
        box(0.08, 2.6, 0.08, 0x55555e, 0.7, 2.2),
        part(new THREE.ConeGeometry(1.6, 0.6, 12), 0xd13b32, 0.7, 3.6),
      ]),
    );
    const body = new THREE.Group();
    body.position.y = 0.9;
    body.add(merge([box(0.26, 0.8, 0.26, 0x6b5a3a, 0.14, 0.4), box(0.26, 0.8, 0.26, 0x6b5a3a, -0.14, 0.4), box(0.6, 0.72, 0.34, 0xb59a62, 0, 1.16), box(0.36, 0.36, 0.36, 0xd9a07c, 0, 1.72), box(0.42, 0.12, 0.42, 0xf4f4f4, 0, 1.94)]));
    const arm = (side: number): THREE.Object3D => {
      const a = merge([box(0.16, 0.66, 0.16, 0xb59a62, 0, -0.33), box(0.17, 0.14, 0.17, 0xf4f4f4, 0, -0.68)]);
      a.position.set(side * 0.38, 1.48, 0);
      body.add(a);
      return a;
    };
    const armL = arm(1);
    const armR = arm(-1);
    g.add(body);
    this.group.add(g);
    return { j, body, armL, armR };
  }

  /** Lamp colours and the policemen's arms for the time now. */
  update(nowMs: number): void {
    const dirty = new Set<THREE.InstancedMesh>();
    for (const h of this.heads) {
      const light = lightFor(h.j, h.g, nowMs);
      if (light === h.last) continue;
      h.last = light;
      ORDER.forEach((c, k) => h.lamps.setColorAt(h.i + k, c === light ? LAMP_ON[c] : LAMP_OFF));
      dirty.add(h.lamps);
    }
    for (const l of dirty) if (l.instanceColor) l.instanceColor.needsUpdate = true;
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
