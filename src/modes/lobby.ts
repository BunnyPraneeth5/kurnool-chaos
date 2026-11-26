import * as THREE from 'three';
import type { MapData } from '../map/types';
import type { CollisionWorld } from '../map/collision';
import { groundY } from '../map/terrain';
import type { Vehicle } from '../vehicles/vehicle';
import type { Spot } from './types';

// The room lobby (TASKS G.1) on the real Jagannatha Gattu summit from the terrain
// (task K.5): a paved plaza that follows the ground, a signboard in English and
// Telugu facing the city, players spread around it and the 8 parked cars in a ring.

/** Near the top of Jagannatha Gattu (above the IIITDM campus); the summit is searched around it. */
const PIN = { lat: 15.76463, lon: 78.03279 };
const SEARCH_M = 150;
const PLAZA_R = 24;
const SPAWN_R = 9;
const CAR_R = 18;
export const LOBBY_NAME_EN = 'Jagannatha Gattu';
export const LOBBY_NAME_TE = 'జగన్నాథ గట్టు'; // spelling confirmed by Bunny, 2026-11-27

export interface Lobby {
  x: number;
  z: number;
  y: number;
  /** facing the city (Raj Vihar), forward = (sin, cos) */
  heading: number;
}

/** lat/lon -> map metres, same equirectangular projection as scripts/osm/common.mjs. */
function project(map: MapData, lat: number, lon: number): [number, number] {
  const phi = (map.center.lat * Math.PI) / 180;
  const mLat = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
  const mLon = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
  return [(lon - map.center.lon) * mLon, (map.center.lat - lat) * mLat];
}

/** The highest ground near the pin. Throws if the pin is off the terrain (no silent fallback). */
export function findLobby(map: MapData): Lobby {
  const [px, pz] = project(map, PIN.lat, PIN.lon);
  const b = map.bounds;
  if (px < b.minX || px > b.maxX || pz < b.minZ || pz > b.maxZ) {
    throw new Error(`Jagannatha Gattu (${px.toFixed(0)}, ${pz.toFixed(0)}) is outside this map`);
  }
  let best = { x: px, z: pz, y: groundY(px, pz) };
  for (let dx = -SEARCH_M; dx <= SEARCH_M; dx += 5) {
    for (let dz = -SEARCH_M; dz <= SEARCH_M; dz += 5) {
      const y = groundY(px + dx, pz + dz);
      if (y > best.y) best = { x: px + dx, z: pz + dz, y };
    }
  }
  return { ...best, heading: Math.atan2(map.spawn.x - best.x, map.spawn.z - best.z) };
}

/** Where a player stands in the lobby: a small ring on the plaza, facing the city. */
export function lobbySpot(l: Lobby, slot: number): Spot {
  const a = l.heading + Math.PI + (slot * Math.PI) / 4;
  return { x: l.x + Math.sin(a) * SPAWN_R, z: l.z + Math.cos(a) * SPAWN_R, heading: l.heading };
}

/** Park the 8 shared cars in a ring on the plaza, noses out (same spots on every screen). */
export function parkLobbyCars(l: Lobby, cars: Vehicle[], world: CollisionWorld): void {
  cars.forEach((c, i) => {
    const a = l.heading + (i + 0.5) * ((Math.PI * 2) / cars.length);
    c.x = l.x + Math.sin(a) * CAR_R;
    c.z = l.z + Math.cos(a) * CAR_R;
    c.a = c.va = a;
    c.speed = 0;
    c.y = groundY(c.x, c.z);
    c.pushOut(world);
    c.settle(world);
    c.sync();
  });
}

function signTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 224;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas not available for the lobby signboard');
  g.fillStyle = '#1d5e3a';
  g.fillRect(0, 0, 512, 224);
  g.strokeStyle = '#f4f1e6';
  g.lineWidth = 8;
  g.strokeRect(10, 10, 492, 204);
  g.fillStyle = '#f4f1e6';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // Telugu needs a Telugu font: phones have Noto Sans Telugu, Windows has Nirmala UI.
  g.font = 'bold 64px "Noto Sans Telugu", "Nirmala UI", Gautami, sans-serif';
  g.fillText(LOBBY_NAME_TE, 256, 78);
  g.font = 'bold 50px system-ui, sans-serif';
  g.fillText(LOBBY_NAME_EN, 256, 158);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Plaza disc following the ground, a low kerb and the signboard. */
export function buildLobby(l: Lobby): THREE.Group {
  const group = new THREE.Group();
  group.name = 'lobby';

  // Plaza: a disc whose vertices sit just above the terrain.
  const disc = new THREE.CircleGeometry(PLAZA_R, 40, 0, Math.PI * 2).rotateX(-Math.PI / 2);
  const pos = disc.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = l.x + pos.getX(i);
    const z = l.z + pos.getZ(i);
    pos.setXYZ(i, x, groundY(x, z) + 0.22, z);
  }
  disc.computeVertexNormals();
  const plaza = new THREE.Mesh(disc, new THREE.MeshLambertMaterial({ color: 0xb9a68c, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  group.add(plaza);

  // Black-and-yellow kerb stones around the edge.
  const kerbGeo = new THREE.BoxGeometry(1.4, 0.3, 0.4);
  const yellow = new THREE.MeshLambertMaterial({ color: 0xf2c230 });
  const black = new THREE.MeshLambertMaterial({ color: 0x1c1c22 });
  const n = 72;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = l.x + Math.sin(a) * PLAZA_R;
    const z = l.z + Math.cos(a) * PLAZA_R;
    const k = new THREE.Mesh(kerbGeo, i % 2 ? yellow : black);
    k.position.set(x, groundY(x, z) + 0.3, z);
    k.rotation.y = a + Math.PI / 2;
    group.add(k);
  }

  // Signboard at the city side of the plaza, readable from the plaza and from below.
  const sx = l.x + Math.sin(l.heading) * (PLAZA_R - 3);
  const sz = l.z + Math.cos(l.heading) * (PLAZA_R - 3);
  const sy = groundY(sx, sz);
  const board = new THREE.Group();
  const face = new THREE.MeshBasicMaterial({ map: signTexture() });
  const back = new THREE.MeshLambertMaterial({ color: 0x1d5e3a });
  const panel = new THREE.Mesh(new THREE.BoxGeometry(8, 3.5, 0.25), [back, back, back, back, face, face]);
  panel.position.y = 4.4;
  const postMat = new THREE.MeshLambertMaterial({ color: 0x5b5b66 });
  for (const px of [-3.2, 3.2]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 4.4, 0.25), postMat);
    post.position.set(px, 2.2, 0);
    board.add(post);
  }
  board.add(panel);
  board.position.set(sx, sy, sz);
  board.rotation.y = l.heading; // face the city; the back face shows the same text
  group.add(board);
  return group;
}
