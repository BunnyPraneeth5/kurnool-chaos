import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { VEHICLES, type VehicleType } from './params';

// Low-poly vehicles built from boxes (the car is the demo's makeCar()). Each body is one
// merged mesh with vertex colours, shared between vehicles of the same type and colour.
// The nose points along +z.

type Part = [w: number, h: number, d: number, x: number, y: number, z: number, color: number];

const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const shadowMat = new THREE.MeshBasicMaterial({
  color: 0x140f24,
  transparent: true,
  opacity: 0.34,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

const GLASS = 0x212943;
const TYRE = 0x121217;
const LAMP = 0xfff2b8;
const TAIL = 0xeb241f;
const DARK = 0x23232b;
const TRIM = 0xe8e2d2;

/** Left and right copies of a part at +x and -x. */
function pair(w: number, h: number, d: number, x: number, y: number, z: number, color: number): Part[] {
  return [
    [w, h, d, x, y, z, color],
    [w, h, d, -x, y, z, color],
  ];
}

function carParts(c: number): Part[] {
  const w = 1.9, len = 4.3;
  const wx = w / 2 - 0.05, wz = len * 0.31;
  return [
    [w, 0.65, len, 0, 0.675, 0, c],
    [w * 0.86, 0.6, 2.2, 0, 1.3, -0.2, GLASS],
    [w * 0.9, 0.08, 2.07, 0, 1.64, -0.2, c],
    ...pair(0.28, 0.7, 0.7, wx, 0.35, wz, TYRE),
    ...pair(0.28, 0.7, 0.7, wx, 0.35, -wz, TYRE),
    ...pair(0.42, 0.16, 0.08, w * 0.3, 0.75, len / 2, LAMP),
    ...pair(0.42, 0.16, 0.08, w * 0.3, 0.75, -len / 2, TAIL),
  ];
}

/** Three wheels, open sides, a black canvas hood. */
function autoParts(c: number): Part[] {
  return [
    [1.4, 0.55, 1.9, 0, 0.7, -0.4, c], // passenger tub
    [0.85, 0.7, 0.75, 0, 0.75, 0.92, c], // front cowl
    [0.8, 0.5, 0.06, 0, 1.38, 1.18, GLASS], // windscreen
    [1.42, 0.14, 2.35, 0, 1.84, -0.12, DARK], // hood
    [1.4, 0.85, 0.12, 0, 1.36, -1.3, DARK], // back
    ...pair(0.08, 0.85, 0.08, 0.66, 1.36, 0.32, DARK),
    ...pair(0.08, 0.75, 0.08, 0.4, 1.42, 1.15, DARK),
    [1.2, 0.2, 0.4, 0, 1.05, -0.85, 0x6b3a2a], // seat
    [1.44, 0.1, 1.92, 0, 0.92, -0.4, 0x1d7a46], // green stripe
    [0.22, 0.55, 0.55, 0, 0.28, 1.05, TYRE],
    ...pair(0.22, 0.55, 0.55, 0.66, 0.28, -0.85, TYRE),
    [0.28, 0.18, 0.08, 0, 0.9, 1.31, LAMP],
    ...pair(0.18, 0.14, 0.06, 0.55, 0.75, -1.36, TAIL),
  ];
}

function bikeParts(c: number): Part[] {
  return [
    [0.16, 0.62, 0.62, 0, 0.31, 0.68, TYRE],
    [0.2, 0.62, 0.62, 0, 0.31, -0.68, TYRE],
    [0.26, 0.28, 1.15, 0, 0.55, 0, DARK], // frame and engine
    [0.38, 0.26, 0.55, 0, 0.82, 0.22, c], // tank
    [0.3, 0.12, 0.7, 0, 0.78, -0.38, DARK], // seat
    [0.28, 0.2, 0.3, 0, 0.72, -0.82, c], // tail
    [0.3, 0.3, 0.2, 0, 0.92, 0.68, c], // headlamp cowl
    [0.2, 0.14, 0.04, 0, 0.94, 0.79, LAMP],
    [0.68, 0.06, 0.06, 0, 1.12, 0.52, DARK], // handlebar
    [0.14, 0.1, 0.04, 0, 0.72, -0.98, TAIL],
  ];
}

function busParts(c: number): Part[] {
  const w = 2.6, len = 9.6;
  const parts: Part[] = [
    [w, 1.15, len, 0, 1.07, 0, c],
    [w * 0.96, 0.95, len * 0.97, 0, 2.12, 0, GLASS], // window band
    [w, 0.5, len, 0, 2.84, 0, TRIM], // roof
    [w * 0.98, 0.16, len * 0.99, 0, 1.72, 0, TRIM],
    ...pair(0.34, 0.95, 0.95, w / 2 - 0.1, 0.48, 3.1, TYRE),
    ...pair(0.34, 0.95, 0.95, w / 2 - 0.1, 0.48, -2.9, TYRE),
    ...pair(0.4, 0.2, 0.08, 0.85, 0.95, len / 2, LAMP),
    ...pair(0.3, 0.3, 0.08, 0.95, 0.95, -len / 2, TAIL),
    [1.7, 0.34, 0.08, 0, 2.82, len / 2, DARK], // destination board
  ];
  // Window pillars.
  for (let z = -3.6; z <= 3.6; z += 1.2) parts.push([w * 0.99, 0.95, 0.14, 0, 2.12, z, c]);
  return parts;
}

function lorryParts(c: number): Part[] {
  const w = 2.5;
  return [
    [w, 1.35, 2.0, 0, 1.45, 2.75, c], // cab
    [w * 0.94, 0.75, 1.9, 0, 2.5, 2.76, GLASS],
    [w, 0.16, 2.0, 0, 2.94, 2.75, c],
    [2.0, 0.35, 7.2, 0, 0.8, -0.1, DARK], // chassis
    [w, 1.7, 5.1, 0, 1.85, -1.2, 0x8a6a45], // load body
    [w * 1.01, 0.18, 5.12, 0, 2.75, -1.2, c],
    [w * 1.01, 0.18, 5.12, 0, 1.15, -1.2, c],
    ...pair(0.36, 1.0, 1.0, w / 2 - 0.1, 0.5, 2.7, TYRE),
    ...pair(0.36, 1.0, 1.0, w / 2 - 0.1, 0.5, -1.7, TYRE),
    ...pair(0.36, 1.0, 1.0, w / 2 - 0.1, 0.5, -2.85, TYRE),
    ...pair(0.38, 0.2, 0.08, 0.85, 1.05, 3.78, LAMP),
    ...pair(0.3, 0.2, 0.08, 0.95, 0.85, -3.76, TAIL),
  ];
}

const PARTS: Record<VehicleType, (colour: number) => Part[]> = {
  car: carParts,
  auto: autoParts,
  bike: bikeParts,
  bus: busParts,
  lorry: lorryParts,
};

function mergeParts(parts: Part[]): THREE.BufferGeometry {
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
  if (!merged) throw new Error('Could not build a vehicle model');
  for (const g of geos) g.dispose();
  return merged;
}

const cache = new Map<string, THREE.BufferGeometry>();

export function buildVehicleMesh(type: VehicleType, colour: number, shadow = true): THREE.Object3D {
  const key = `${type}:${colour}`;
  let geo = cache.get(key);
  if (!geo) cache.set(key, (geo = mergeParts(PARTS[type](colour))));
  const mesh = new THREE.Mesh(geo, bodyMat);
  mesh.rotation.order = 'YXZ';
  mesh.userData.vehicle = type;
  if (shadow) {
    const t = VEHICLES[type];
    const s = new THREE.Mesh(new THREE.PlaneGeometry(t.w + 0.7, t.len + 0.6).rotateX(-Math.PI / 2), shadowMat);
    s.position.y = 0.2;
    mesh.add(s);
  }
  return mesh;
}

// Damage looks (task M.12): the same vertex colours, darkened. Shared, so a dented car costs
// no new material.
const dentMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xa29a92 });
const burntMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0x2e2a2a });

/** Show a vehicle's damage: clean above 60 health, dented and dull below, burnt out when blown up. */
export function setDamageLook(mesh: THREE.Object3D, hp: number, blown = false): void {
  if (!(mesh instanceof THREE.Mesh)) return;
  const mat = blown || hp <= 0 ? burntMat : hp < 60 ? dentMat : bodyMat;
  if (mesh.material !== mat) mesh.material = mat;
}

const RIDER = 'rider';
const riderCache = new Map<number, THREE.BufferGeometry>();

/** Show (with a shirt colour) or remove the person on a bike. Other vehicles hide their driver. */
export function setRider(mesh: THREE.Object3D, shirt: number | null): void {
  const old = mesh.getObjectByName(RIDER);
  if (old) mesh.remove(old);
  if (shirt === null || mesh.userData.vehicle !== 'bike') return;
  let geo = riderCache.get(shirt);
  if (!geo) {
    riderCache.set(
      shirt,
      (geo = mergeParts([
        [0.46, 0.62, 0.3, 0, 1.22, -0.18, shirt],
        [0.32, 0.32, 0.32, 0, 1.7, -0.1, 0xd9a07c],
        [0.34, 0.1, 0.34, 0, 1.9, -0.1, 0x241c2e],
        ...pair(0.14, 0.18, 0.55, 0.18, 0.9, -0.02, 0x2b2a4a),
        ...pair(0.14, 0.55, 0.18, 0.24, 0.62, 0.22, 0x2b2a4a),
        ...pair(0.12, 0.12, 0.62, 0.28, 1.24, 0.18, shirt),
      ])),
    );
  }
  const rider = new THREE.Mesh(geo, bodyMat);
  rider.name = RIDER;
  mesh.add(rider);
}

/** Seat points on each model (seat 0 is the driver), in the model's own space. */
export const SEATS: Record<VehicleType, readonly [number, number, number][]> = {
  // Right-hand drive: the driver sits on the right (-x).
  car: [[-0.42, 0.75, 0.2], [0.42, 0.75, 0.2], [-0.42, 0.75, -0.8], [0.42, 0.75, -0.8]],
  auto: [[0, 0.75, 0.72], [-0.36, 0.95, -0.9], [0.36, 0.95, -0.9]],
  bike: [[0, 0, 0], [0, 0.04, -0.48]],
  bus: [[-0.8, 1.1, 3.9], [0.7, 1.1, 2.4], [-0.7, 1.1, 1.0], [0.7, 1.1, 1.0], [-0.7, 1.1, -0.6], [0.7, 1.1, -0.6], [-0.7, 1.1, -2.2], [0.7, 1.1, -2.2]],
  lorry: [[-0.6, 1.25, 2.9], [0, 1.25, 2.9], [0.6, 1.25, 2.9]],
};

const seatedCache = new Map<string, THREE.BufferGeometry>();

/**
 * A friend sitting in seat `seat` of a vehicle model (task H.4), to add as a child of the
 * vehicle mesh. On a bike the passenger sits astride behind the rider.
 */
export function seatedFigure(type: VehicleType, seat: number, shirt: number): THREE.Object3D {
  const astride = type === 'bike';
  const key = `${astride ? 'b' : 's'}:${shirt}`;
  let geo = seatedCache.get(key);
  if (!geo) {
    const parts: Part[] = astride
      ? [
          [0.44, 0.6, 0.28, 0, 1.24, -0.2, shirt],
          [0.3, 0.3, 0.3, 0, 1.7, -0.14, 0xd9a07c],
          [0.32, 0.1, 0.32, 0, 1.9, -0.14, 0x241c2e],
          ...pair(0.14, 0.18, 0.5, 0.18, 0.92, -0.05, 0x2b2a4a),
          ...pair(0.14, 0.5, 0.16, 0.22, 0.65, 0.15, 0x2b2a4a),
        ]
      : [
          [0.44, 0.6, 0.28, 0, 0.36, 0, shirt],
          [0.32, 0.32, 0.32, 0, 0.86, 0, 0xd9a07c],
          [0.34, 0.1, 0.34, 0, 1.06, 0, 0x241c2e],
          ...pair(0.15, 0.16, 0.5, 0.12, 0.02, 0.22, 0x2b2a4a),
        ];
    seatedCache.set(key, (geo = mergeParts(parts)));
  }
  const m = new THREE.Mesh(geo, bodyMat);
  const p = SEATS[type][seat] ?? SEATS[type][SEATS[type].length - 1];
  m.position.set(p[0], p[1], p[2]);
  m.name = 'seated';
  return m;
}
