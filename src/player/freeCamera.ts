import * as THREE from 'three';

// Map-style fly-over camera for looking at the city. Since task 2.4 it is the
// "map view", toggled with the C key; the chase camera is used while playing.
//
// Mouse: left drag moves, right drag (or shift + drag) rotates, wheel zooms.
// Keys: WASD / arrows move, Q/E turn, R/F tilt, Shift = faster.
// Touch: one finger moves, two fingers pinch to zoom, twist to turn, drag up/down to tilt.

const MIN_DIST = 15;
const MAX_DIST = 7000;
const MIN_PITCH = 0.15;
const MAX_PITCH = 1.5;

interface Pointer {
  x: number;
  y: number;
}

export class FreeCamera {
  /** Off while the player is walking or driving; mouse and touch are then ignored. */
  enabled = true;
  private tx = 0;
  private tz = 0;
  private dist = 1200;
  private yaw = 0;
  private pitch = 0.95;
  private readonly keys = new Set<string>();
  private readonly pointers = new Map<number, Pointer>();
  private dragMode: 'move' | 'turn' | null = null;
  private pinch: { d: number; a: number; my: number } | null = null;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly el: HTMLElement,
  ) {
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Look at a ground point from the given distance and facing. */
  lookAt(x: number, z: number, dist: number, yaw: number): void {
    this.tx = x;
    this.tz = z;
    this.dist = dist;
    this.yaw = yaw;
    this.apply();
  }

  update(dt: number): void {
    const k = this.keys;
    const fast = k.has('ShiftLeft') || k.has('ShiftRight') ? 3 : 1;
    const speed = this.dist * 0.8 * fast * dt;
    let f = 0;
    let r = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) r += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) r -= 1;
    if (f || r) this.moveBy(r * speed, f * speed);
    if (k.has('KeyQ')) this.yaw += 1.2 * dt;
    if (k.has('KeyE')) this.yaw -= 1.2 * dt;
    if (k.has('KeyR')) this.pitch += 0.8 * dt;
    if (k.has('KeyF')) this.pitch -= 0.8 * dt;
    this.apply();
  }

  /** Move the look-at point: right and forward in metres, relative to the view. */
  private moveBy(right: number, forward: number): void {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    // forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)
    this.tx += c * right - s * forward;
    this.tz += -s * right - c * forward;
  }

  private apply(): void {
    this.dist = THREE.MathUtils.clamp(this.dist, MIN_DIST, MAX_DIST);
    this.pitch = THREE.MathUtils.clamp(this.pitch, MIN_PITCH, MAX_PITCH);
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.tx + Math.sin(this.yaw) * cp * this.dist,
      Math.sin(this.pitch) * this.dist,
      this.tz + Math.cos(this.yaw) * cp * this.dist,
    );
    this.camera.lookAt(this.tx, 0, this.tz);
  }

  /** Metres of ground per screen pixel at the look-at point. */
  private metresPerPixel(): number {
    const h = this.el.clientHeight || 600;
    return (2 * this.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h;
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.dragMode = e.button === 2 || e.shiftKey ? 'turn' : 'move';
    } else if (this.pointers.size === 2) {
      this.dragMode = null;
      this.pinch = this.pinchState();
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size === 1 && this.dragMode === 'move') {
      const m = this.metresPerPixel();
      this.moveBy(-dx * m, (dy * m) / Math.max(0.3, Math.sin(this.pitch)));
    } else if (this.pointers.size === 1 && this.dragMode === 'turn') {
      this.yaw -= dx * 0.005;
      this.pitch += dy * 0.005;
    } else if (this.pointers.size === 2 && this.pinch) {
      const now = this.pinchState();
      this.dist *= this.pinch.d / Math.max(1, now.d);
      this.yaw += now.a - this.pinch.a;
      this.pitch += (now.my - this.pinch.my) * 0.004;
      this.pinch = now;
    }
    this.apply();
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    this.pinch = this.pointers.size === 2 ? this.pinchState() : null;
    if (this.pointers.size === 0) this.dragMode = null;
    else if (this.pointers.size === 1) this.dragMode = 'move';
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (!this.enabled) return;
    this.dist *= Math.exp(e.deltaY * 0.0012);
    this.apply();
  };

  private pinchState(): { d: number; a: number; my: number } {
    const [p, q] = [...this.pointers.values()];
    return { d: Math.hypot(q.x - p.x, q.y - p.y), a: Math.atan2(q.y - p.y, q.x - p.x), my: (p.y + q.y) / 2 };
  }
}
