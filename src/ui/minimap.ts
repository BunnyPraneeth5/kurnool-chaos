import * as THREE from 'three';
import type { MapData } from '../map/types';

// Minimap (TASKS 5.4), ported from the demo: the real roads, water and landmarks drawn once
// into a big picture, then a turning window of it around you each frame (what is ahead of the
// camera is up). Cops are red dots, friends dots in their colour, a game target a gold ring.
// Tap it to switch between close up and the whole city.

const M_PER_PX = 6; // the pre-drawn city picture
const SIZE = 132; // css px
const CLOSE_M = 900; // metres across, close up

export interface MapDot {
  x: number;
  z: number;
  colour: string;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing from index.html`);
  return e as T;
}

export class Minimap {
  private readonly canvas = el<HTMLCanvasElement>('minimap');
  private readonly g: CanvasRenderingContext2D;
  private readonly city: HTMLCanvasElement;
  private readonly dpr = Math.min(2, window.devicePixelRatio || 1);
  private whole = false;
  private readonly fwd = new THREE.Vector3();
  /** Friends (set by the room code). */
  friends: MapDot[] = [];
  /** Current game target, if any. */
  target: { x: number; z: number } | null = null;

  constructor(
    private readonly map: MapData,
    private readonly camera: THREE.Camera,
  ) {
    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('2D canvas not available for the minimap');
    this.g = g;
    this.canvas.width = this.canvas.height = SIZE * this.dpr;
    this.city = this.drawCity();
    el('mapbox').hidden = false;
    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.whole = !this.whole;
      this.canvas.classList.toggle('whole', this.whole);
    });
  }

  setVisible(on: boolean): void {
    const box = el('mapbox');
    if (box.classList.contains('nomap') === on) box.classList.toggle('nomap', !on);
  }

  private drawCity(): HTMLCanvasElement {
    const b = this.map.bounds;
    const c = document.createElement('canvas');
    c.width = Math.ceil((b.maxX - b.minX) / M_PER_PX);
    c.height = Math.ceil((b.maxZ - b.minZ) / M_PER_PX);
    const g = c.getContext('2d');
    if (!g) throw new Error('2D canvas not available for the minimap');
    const px = (x: number): number => (x - b.minX) / M_PER_PX;
    const pz = (z: number): number => (z - b.minZ) / M_PER_PX;
    g.fillStyle = '#2b2740';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#35603f';
    for (const p of this.map.parks) {
      g.beginPath();
      p.pts.forEach(([x, z], i) => (i ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z))));
      g.fill();
    }
    g.fillStyle = '#3f5fa8';
    for (const w of this.map.water) {
      g.beginPath();
      for (const ring of [w.pts, ...(w.holes ?? [])]) {
        ring.forEach(([x, z], i) => (i ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z))));
        g.closePath();
      }
      g.fill('evenodd');
    }
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // Small roads first, main roads on top and lighter.
    const order = [...this.map.roads].sort((a, b2) => a.width - b2.width);
    for (const r of order) {
      g.strokeStyle = r.width >= 11 ? '#d8c9a8' : r.width >= 9 ? '#a99db6' : '#7c7290';
      g.lineWidth = Math.max(1, r.width / M_PER_PX + (r.width >= 11 ? 1 : 0));
      g.beginPath();
      r.pts.forEach(([x, z], i) => (i ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z))));
      g.stroke();
    }
    const rw = this.map.airport.runway;
    g.save();
    g.translate(px(rw.x), pz(rw.z));
    g.rotate(-rw.heading);
    g.fillStyle = '#9a96a8';
    g.fillRect(-rw.w / M_PER_PX / 2, -rw.len / M_PER_PX / 2, rw.w / M_PER_PX, rw.len / M_PER_PX);
    g.restore();
    return c;
  }

  draw(x: number, z: number, cops: readonly { x: number; z: number }[]): void {
    const g = this.g;
    const S = SIZE * this.dpr;
    const b = this.map.bounds;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#2b2740';
    g.fillRect(0, 0, S, S);

    // World metres -> canvas px, centred on us (close) or on the whole city.
    const span = this.whole ? Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.98 : CLOSE_M;
    const k = S / span;
    const cx = this.whole ? (b.minX + b.maxX) / 2 : x;
    const cz = this.whole ? (b.minZ + b.maxZ) / 2 : z;
    this.camera.getWorldDirection(this.fwd);
    const yaw = Math.atan2(this.fwd.x, this.fwd.z); // forward = (sin, cos)
    const rot = this.whole ? 0 : yaw + Math.PI; // what is ahead points up

    g.translate(S / 2, S / 2);
    g.rotate(rot);
    const toX = (wx: number): number => (wx - cx) * k;
    const toZ = (wz: number): number => (wz - cz) * k;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.city, toX(b.minX), toZ(b.minZ), (b.maxX - b.minX) * k, (b.maxZ - b.minZ) * k);

    const dot = (wx: number, wz: number, r: number, fill: string): void => {
      g.fillStyle = fill;
      g.beginPath();
      g.arc(toX(wx), toZ(wz), r * this.dpr, 0, Math.PI * 2);
      g.fill();
    };
    // Landmarks: a small square and a short name, upright.
    g.font = `600 ${9 * this.dpr}px system-ui, sans-serif`;
    g.textAlign = 'center';
    for (const l of this.map.landmarks) {
      if (l.id === 'river') continue;
      const lx = toX(l.x), lz = toZ(l.z);
      g.fillStyle = '#ffc247';
      g.fillRect(lx - 2.5 * this.dpr, lz - 2.5 * this.dpr, 5 * this.dpr, 5 * this.dpr);
      if (!this.whole) {
        g.save();
        g.translate(lx, lz);
        g.rotate(-rot);
        g.fillStyle = '#fff3e0';
        g.fillText(l.nameEn.replace(/^Kurnool |^Govt\. /, ''), 0, -5 * this.dpr);
        g.restore();
      }
    }
    if (this.target) {
      g.strokeStyle = '#ffc247';
      g.lineWidth = 2.5 * this.dpr;
      g.beginPath();
      g.arc(toX(this.target.x), toZ(this.target.z), 6 * this.dpr, 0, Math.PI * 2);
      g.stroke();
    }
    for (const f of this.friends) dot(f.x, f.z, 3.5, f.colour);
    for (const c of cops) dot(c.x, c.z, 3.5, '#ff4d3d');

    // Us: an arrow pointing the way the camera looks.
    g.translate(toX(x), toZ(z));
    g.rotate(-yaw + Math.PI);
    const s = this.dpr;
    g.fillStyle = '#fff3e0';
    g.strokeStyle = '#1c1a3a';
    g.lineWidth = 2 * s;
    g.beginPath();
    g.moveTo(0, -9 * s);
    g.lineTo(6 * s, 7 * s);
    g.lineTo(0, 3 * s);
    g.lineTo(-6 * s, 7 * s);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
}
