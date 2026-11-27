import type { MoveInput } from '../player/input';

// Touch controls ported from the demo: left thumb joystick, right thumb buttons.
// Shown on touch devices (coarse pointer, or after the first touch).

const DEAD = 0.18;

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing from index.html`);
  return e as T;
}

export class TouchControls {
  private jx = 0;
  private jy = 0;
  private joyId: number | null = null;
  private handDown = false;
  private actionTaps = 0;
  private unstuckTaps = 0;
  readonly stick = el<HTMLDivElement>('stick');
  private readonly knob = el<HTMLDivElement>('knob');
  readonly bAct = el<HTMLButtonElement>('bAct');
  readonly bHand = el<HTMLButtonElement>('bHand');
  readonly bUnstuck = el<HTMLButtonElement>('bUnstuck');
  readonly bHorn = el<HTMLButtonElement>('bHorn');
  /** Horn held down. */
  hornDown = false;

  constructor() {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    if (coarse) document.body.classList.add('touch');
    window.addEventListener('touchstart', () => document.body.classList.add('touch'), { passive: true });

    const s = this.stick;
    s.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.joyId = e.pointerId;
      try {
        s.setPointerCapture(e.pointerId);
      } catch {
        // pointer capture is best-effort
      }
      this.joyMove(e);
    });
    s.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.joyId) this.joyMove(e);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== this.joyId) return;
      this.joyId = null;
      this.jx = this.jy = 0;
      this.knob.style.transform = 'translate(0px, 0px)';
    };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', end);

    this.bHand.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.handDown = true;
      this.bHand.classList.add('down');
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      this.bHand.addEventListener(ev, () => {
        this.handDown = false;
        this.bHand.classList.remove('down');
      });
    }
    this.bAct.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.actionTaps++;
    });
    this.bHorn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.hornDown = true;
      this.bHorn.classList.add('down');
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      this.bHorn.addEventListener(ev, () => {
        this.hornDown = false;
        this.bHorn.classList.remove('down');
      });
    }
    this.bUnstuck.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.unstuckTaps++;
    });
  }

  private joyMove(e: PointerEvent): void {
    const r = this.stick.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / 50;
    let dy = (e.clientY - (r.top + r.height / 2)) / 50;
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    this.jx = dx;
    this.jy = dy;
    this.knob.style.transform = `translate(${(dx * 40).toFixed(1)}px, ${(dy * 40).toFixed(1)}px)`;
  }

  /** Adds the joystick and buttons on top of keyboard input. */
  merge(k: MoveInput): MoveInput {
    let thr = k.thr;
    let steer = k.steer;
    if (Math.abs(this.jy) > DEAD) thr -= this.jy;
    if (Math.abs(this.jx) > DEAD) steer += this.jx;
    return {
      thr: Math.max(-1, Math.min(1, thr)),
      steer: Math.max(-1, Math.min(1, steer)),
      hand: k.hand || this.handDown,
    };
  }

  consumeAction(): boolean {
    const hit = this.actionTaps > 0;
    this.actionTaps = 0;
    return hit;
  }

  consumeUnstuck(): boolean {
    const hit = this.unstuckTaps > 0;
    this.unstuckTaps = 0;
    return hit;
  }
}
