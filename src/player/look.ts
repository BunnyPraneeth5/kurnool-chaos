import { LOOK_SCALE, settings } from '../ui/settings';

// Swipe to look (task M.3): drag on the free part of the screen (phones: right of the
// joystick area; laptops: mouse drag anywhere on the game) to turn the camera.
// The chase camera reads and eases the offsets back (src/player/chaseCamera.ts).

/** Radians of camera turn per pixel dragged, at Normal look speed. */
const PER_PX = 0.008;
/** Phones: touches left of this fraction of the screen width are for the joystick. */
const LEFT_ZONE = 0.4;

export class LookControl {
  /** Off in map view (the fly-over camera uses drags there). */
  enabled = true;
  private id: number | null = null;
  private lx = 0;
  private ly = 0;
  private dx = 0;
  private dy = 0;

  constructor(el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.id !== null) return;
      if (e.pointerType === 'mouse' ? e.button !== 0 : e.clientX < window.innerWidth * LEFT_ZONE) return;
      this.id = e.pointerId;
      this.lx = e.clientX;
      this.ly = e.clientY;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // best-effort
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.id) return;
      this.dx += e.clientX - this.lx;
      this.dy += e.clientY - this.ly;
      this.lx = e.clientX;
      this.ly = e.clientY;
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId === this.id) this.id = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  /** A finger or the mouse is dragging the view. */
  get dragging(): boolean {
    return this.id !== null && this.enabled;
  }

  /** Turn since the last call, in radians (yaw: right is positive; pitch: down is positive). */
  take(): { yaw: number; pitch: number } {
    const k = PER_PX * LOOK_SCALE[settings().look];
    const out = { yaw: this.dx * k, pitch: this.dy * k };
    this.dx = this.dy = 0;
    if (!this.enabled) {
      out.yaw = out.pitch = 0;
      this.id = null;
    }
    return out;
  }
}
