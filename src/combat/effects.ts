import * as THREE from 'three';

// Fighting effects (tasks M.8 to M.12): tracers, muzzle and hit flashes, splats, blasts,
// smoke and fire puffs, thrown things and the throw arc. Everything comes from fixed pools
// made once (nothing new per shot or hit, task M.13), so a fight costs no garbage.

interface Live {
  obj: THREE.Mesh | THREE.Line;
  t: number;
  life: number;
  kind: 'tracer' | 'flash' | 'splat' | 'blast' | 'puff';
  vy: number;
  grow: number;
  base: number;
}

const POOLS = { tracer: 24, flash: 16, splat: 24, blast: 6, puff: 60 } as const;

export class Effects {
  private readonly group = new THREE.Group();
  private readonly free: Record<Live['kind'], Live[]> = { tracer: [], flash: [], splat: [], blast: [], puff: [] };
  private readonly live: Live[] = [];
  private readonly arc: THREE.Line;
  private readonly arcPos: Float32Array;
  private readonly things: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    this.group.name = 'fight-effects';
    scene.add(this.group);
    const dot = new THREE.SphereGeometry(1, 8, 6);
    const disc = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2);
    for (let i = 0; i < POOLS.tracer; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xfff1a0, transparent: true }));
      this.add('tracer', line);
    }
    for (let i = 0; i < POOLS.flash; i++) this.add('flash', new THREE.Mesh(dot, new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, depthWrite: false })));
    for (let i = 0; i < POOLS.splat; i++) this.add('splat', new THREE.Mesh(disc, new THREE.MeshBasicMaterial({ color: 0x4fa8e8, transparent: true, depthWrite: false })));
    for (let i = 0; i < POOLS.blast; i++) this.add('blast', new THREE.Mesh(dot, new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, depthWrite: false })));
    for (let i = 0; i < POOLS.puff; i++) this.add('puff', new THREE.Mesh(dot, new THREE.MeshLambertMaterial({ color: 0x55525e, transparent: true, depthWrite: false })));
    // Throw arc preview: 24 points.
    const ag = new THREE.BufferGeometry();
    this.arcPos = new Float32Array(24 * 3);
    ag.setAttribute('position', new THREE.BufferAttribute(this.arcPos, 3));
    this.arc = new THREE.Line(ag, new THREE.LineDashedMaterial({ color: 0xfff3e0, dashSize: 0.5, gapSize: 0.3, transparent: true, opacity: 0.85 }));
    this.arc.visible = false;
    this.arc.frustumCulled = false;
    this.group.add(this.arc);
    // Thrown things in the air (balloons, tomatoes, firecrackers): 8 small balls.
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(dot, new THREE.MeshLambertMaterial({ color: 0xffffff }));
      m.visible = false;
      m.scale.setScalar(0.14);
      this.group.add(m);
      this.things.push(m);
    }
  }

  private add(kind: Live['kind'], obj: THREE.Mesh | THREE.Line): void {
    obj.visible = false;
    obj.frustumCulled = false;
    this.group.add(obj);
    this.free[kind].push({ obj, t: 0, life: 1, kind, vy: 0, grow: 0, base: 1 });
  }

  private take(kind: Live['kind'], life: number): Live | null {
    let e = this.free[kind].pop();
    if (!e) {
      // Pool empty: reuse the oldest live one of this kind.
      const i = this.live.findIndex((l) => l.kind === kind);
      if (i < 0) return null;
      e = this.live.splice(i, 1)[0];
    }
    e.t = 0;
    e.life = life;
    e.vy = 0;
    e.grow = 0;
    e.obj.visible = true;
    this.live.push(e);
    return e;
  }

  tracer(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, colour = 0xfff1a0): void {
    const e = this.take('tracer', 0.09);
    if (!e) return;
    const line = e.obj as THREE.Line;
    const pos = line.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, x0, y0, z0);
    pos.setXYZ(1, x1, y1, z1);
    pos.needsUpdate = true;
    (line.material as THREE.LineBasicMaterial).color.setHex(colour);
  }

  flash(x: number, y: number, z: number, size = 0.18, colour = 0xffd36b): void {
    const e = this.take('flash', 0.08);
    if (!e) return;
    e.obj.position.set(x, y, z);
    e.base = size;
    e.obj.scale.setScalar(size);
    ((e.obj as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(colour);
  }

  splat(x: number, y: number, z: number, radius: number, colour: number): void {
    const e = this.take('splat', 6);
    if (!e) return;
    e.obj.position.set(x, y + 0.22, z);
    e.base = radius;
    e.obj.scale.setScalar(radius);
    ((e.obj as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(colour);
  }

  blast(x: number, y: number, z: number, radius: number): void {
    const e = this.take('blast', 0.45);
    if (e) {
      e.obj.position.set(x, y + 0.6, z);
      e.base = radius * 0.25;
      e.grow = radius * 1.6;
    }
    for (let i = 0; i < 6; i++) this.puff(x + (Math.random() - 0.5) * radius, y + 0.5, z + (Math.random() - 0.5) * radius, i < 2 ? 'fire' : 'smoke', 0.9);
  }

  /** One puff of smoke or fire rising from a damaged vehicle or a blast. */
  puff(x: number, y: number, z: number, kind: 'smoke' | 'dark' | 'fire', size = 0.5): void {
    const e = this.take('puff', kind === 'fire' ? 0.5 : 1.4);
    if (!e) return;
    e.obj.position.set(x, y, z);
    e.base = size;
    e.grow = size * 1.5;
    e.vy = kind === 'fire' ? 2.2 : 1.4;
    ((e.obj as THREE.Mesh).material as THREE.MeshLambertMaterial).color.setHex(kind === 'fire' ? 0xff7a2a : kind === 'dark' ? 0x2a2830 : 0x77737f);
  }

  /** Draw the throw arc from a start point with a launch velocity (or hide it with null). */
  showArc(start: { x: number; y: number; z: number } | null, vx = 0, vy = 0, vz = 0, g = 20, groundY = 0): void {
    if (!start) {
      this.arc.visible = false;
      return;
    }
    this.arc.visible = true;
    const flight = (vy + Math.sqrt(vy * vy + 2 * g * Math.max(0, start.y - groundY))) / g;
    for (let i = 0; i < 24; i++) {
      const t = (flight * i) / 23;
      this.arcPos[i * 3] = start.x + vx * t;
      this.arcPos[i * 3 + 1] = start.y + vy * t - 0.5 * g * t * t;
      this.arcPos[i * 3 + 2] = start.z + vz * t;
    }
    this.arc.geometry.attributes.position.needsUpdate = true;
    this.arc.computeLineDistances();
  }

  /** Show thrown thing number i at a point (or hide it). */
  thing(i: number, at: { x: number; y: number; z: number } | null, colour = 0xffffff): void {
    const m = this.things[i];
    if (!m) return;
    m.visible = !!at;
    if (!at) return;
    m.position.set(at.x, at.y, at.z);
    (m.material as THREE.MeshLambertMaterial).color.setHex(colour);
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i];
      e.t += dt;
      const k = e.t / e.life;
      if (k >= 1) {
        e.obj.visible = false;
        this.live.splice(i, 1);
        this.free[e.kind].push(e);
        continue;
      }
      const mat = e.obj.material as THREE.Material & { opacity: number };
      if (e.kind === 'splat') mat.opacity = k < 0.7 ? 0.85 : 0.85 * (1 - (k - 0.7) / 0.3);
      else mat.opacity = 1 - k;
      if (e.grow) e.obj.scale.setScalar(e.base + e.grow * k);
      if (e.vy) e.obj.position.y += e.vy * dt;
    }
  }
}
