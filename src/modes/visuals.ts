import * as THREE from 'three';

// World pieces for game rounds: a light pillar over the current hunt target
// (seen over the buildings and through the fog) and a police light bar.

export class Beacon {
  private readonly group = new THREE.Group();
  private readonly pillarMat = new THREE.MeshBasicMaterial({ color: 0xffc247, transparent: true, opacity: 0.35, depthWrite: false, fog: false });
  private readonly ringMat = new THREE.MeshBasicMaterial({ color: 0xffc247, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, fog: false });

  constructor(scene: THREE.Scene) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 220, 12, 1, true), this.pillarMat);
    pillar.position.y = 110;
    const ring = new THREE.Mesh(new THREE.RingGeometry(26, 30, 40).rotateX(-Math.PI / 2), this.ringMat);
    ring.position.y = 0.3;
    this.group.add(pillar, ring);
    this.group.visible = false;
    this.group.renderOrder = 2;
    scene.add(this.group);
  }

  set(target: { x: number; z: number } | null, timeMs: number): void {
    this.group.visible = !!target;
    if (!target) return;
    this.group.position.set(target.x, 0, target.z);
    this.pillarMat.opacity = 0.28 + 0.12 * Math.sin(timeMs / 300);
  }
}

// One shared light bar look, cloned per car; the flashing changes shared materials.
const red = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
const blue = new THREE.MeshBasicMaterial({ color: 0x2a5cff });
let signMat: THREE.MeshBasicMaterial | null = null;

function policeSign(): THREE.MeshBasicMaterial {
  if (signMat) return signMat;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#f4f4f4';
    g.fillRect(0, 0, 128, 32);
    g.fillStyle = '#1b2a6b';
    g.font = 'bold 24px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('POLICE', 64, 17);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  signMat = new THREE.MeshBasicMaterial({ map: tex });
  return signMat;
}

const BAR = 'policebar';

function makeBar(): THREE.Group {
  const g = new THREE.Group();
  g.name = BAR;
  const l = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.3), red);
  l.position.x = 0.42;
  const r = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.3), blue);
  r.position.x = -0.42;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.2, 0.32), policeSign());
  g.add(l, r, sign);
  g.position.set(0, 1.78, -0.2); // on the roof of the sedan model
  return g;
}

/** Add or remove the light bar on a car model. */
export function setPoliceLook(car: THREE.Object3D | null | undefined, on: boolean): void {
  if (!car) return;
  const bar = car.getObjectByName(BAR);
  if (on && !bar) car.add(makeBar());
  else if (!on && bar) car.remove(bar);
}

/** Flash all light bars (call once per frame). */
export function flashLightBars(timeMs: number): void {
  const phase = Math.floor(timeMs / 220) % 2 === 0;
  red.color.setHex(phase ? 0xff2a2a : 0x4a0d0d);
  blue.color.setHex(phase ? 0x10164a : 0x2a5cff);
}
