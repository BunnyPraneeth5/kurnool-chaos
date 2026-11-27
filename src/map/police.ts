import * as THREE from 'three';
import type { MapData } from './types';
import { groundY } from './terrain';
import { loadTeluguFont, TELUGU_FONT } from '../util/fonts';

// Police stations (task H.5): the 5 OSM police stations keep their real buildings; each
// gets a blue POLICE STATION signboard (English + Telugu) at the road in front of it.
// Busted players are put on foot at that spot (see game.ts).

const TE = 'పోలీస్ స్టేషన్';

export interface Station {
  name: string;
  x: number;
  z: number;
  /** the way the sign faces (towards the road), forward = (sin, cos) */
  a: number;
}

export function policeStations(map: MapData): Station[] {
  return map.police ?? [];
}

/** The station nearest a point (null if the map has none). */
export function nearestStation(map: MapData, x: number, z: number): Station | null {
  let best: Station | null = null;
  let bd = Infinity;
  for (const s of policeStations(map)) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

function drawBoard(c: HTMLCanvasElement, name: string): void {
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas not available for the police station signs');
  g.fillStyle = '#1b3f8f';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#f4f1e6';
  g.lineWidth = 6;
  g.strokeRect(8, 8, c.width - 16, c.height - 16);
  g.fillStyle = '#f4f1e6';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 50px system-ui, sans-serif';
  g.fillText('POLICE STATION', c.width / 2, 58);
  g.font = `bold 42px "${TELUGU_FONT}", "Nirmala UI", sans-serif`;
  g.fillText(TE, c.width / 2, 120);
  g.font = '24px system-ui, sans-serif';
  let label = name;
  while (g.measureText(label).width > c.width - 40 && label.length > 4) label = `${label.slice(0, -2)}…`;
  g.fillText(label, c.width / 2, 172);
}

export function buildPoliceStations(map: MapData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'police-stations';
  const postMat = new THREE.MeshLambertMaterial({ color: 0x5b5b66 });
  const backMat = new THREE.MeshLambertMaterial({ color: 0x1b3f8f });
  const post = new THREE.BoxGeometry(0.2, 3.4, 0.2);
  for (const s of policeStations(map)) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 200;
    drawBoard(c, s.name);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    void loadTeluguFont().then((ok) => {
      if (!ok) return;
      drawBoard(c, s.name);
      tex.needsUpdate = true;
    });
    const face = new THREE.MeshBasicMaterial({ map: tex });
    const board = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.64, 0.15), [backMat, backMat, backMat, backMat, face, face]);
    panel.position.y = 3.3;
    for (const px of [-1.8, 1.8]) {
      const p = new THREE.Mesh(post, postMat);
      p.position.set(px, 1.7, -0.05);
      board.add(p);
    }
    board.add(panel);
    board.position.set(s.x, groundY(s.x, s.z), s.z);
    board.rotation.y = s.a;
    group.add(board);
  }
  return group;
}
