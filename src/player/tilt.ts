// Tilt steering (task M.5): read gravity from the phone's motion sensor and turn it into a
// steering value. The pure maths is in tiltSteer() (tested); the class listens for events.
// iPhones need permission from a tap first (DeviceMotionEvent.requestPermission).

const G = 9.81;
/** Sideways lean (as a fraction of gravity, about sin of the angle) for full lock: ~20 degrees. */
const FULL = 0.35;
const DEAD = 0.03;

/**
 * Lean towards the screen's right as a fraction of gravity, from the sensor's x and y
 * (accelerationIncludingGravity, Android signs) and the screen's rotation in degrees.
 */
export function screenLean(ax: number, ay: number, screenAngle: number): number {
  const a = ((Math.round(screenAngle / 90) % 4) + 4) % 4;
  // The device axis that points to the screen's right in each rotation.
  const right = a === 0 ? ax : a === 1 ? ay : a === 2 ? -ax : -ay;
  // Android: the axis pointing up reads +g, so leaning right makes the right axis negative.
  return -right / G;
}

/** Steering -1..1 from a lean and the calibrated straight-ahead lean. */
export function tiltSteer(lean: number, neutral: number): number {
  const d = lean - neutral;
  if (Math.abs(d) < DEAD) return 0;
  return Math.max(-1, Math.min(1, (d - Math.sign(d) * DEAD) / (FULL - DEAD)));
}

type PermissionApi = { requestPermission?: () => Promise<'granted' | 'denied'> };

export class Tilt {
  private lean: number | null = null;
  private neutral = 0;
  private lastEvent = 0;
  private listening = false;
  private startedAt = 0;
  // iPhones report gravity with the opposite sign to Android.
  private readonly flip = /iPhone|iPad|iPod/.test(navigator.userAgent) ? -1 : 1;

  private readonly onMotion = (e: DeviceMotionEvent): void => {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null || g.y == null) return;
    const angle = screen.orientation?.angle ?? (typeof window.orientation === 'number' ? window.orientation : 0);
    this.lean = screenLean(g.x * this.flip, g.y * this.flip, angle);
    this.lastEvent = performance.now();
  };

  /**
   * Start listening. Call from a tap (iPhones ask permission then). Resolves to null when
   * it works, or a message saying why tilt cannot be used.
   */
  async start(): Promise<string | null> {
    if (typeof DeviceMotionEvent === 'undefined') return 'This browser has no motion sensor access, so tilt steering cannot work here.';
    const api = DeviceMotionEvent as unknown as PermissionApi;
    if (typeof api.requestPermission === 'function') {
      try {
        if ((await api.requestPermission()) !== 'granted') return 'Motion access was refused. Allow it in the browser settings to steer by tilting.';
      } catch {
        return 'Tap the Tilt button again to allow motion access.';
      }
    }
    if (!this.listening) {
      window.addEventListener('devicemotion', this.onMotion);
      this.listening = true;
    }
    this.startedAt = performance.now();
    // Give the sensor a moment, then check it said something.
    await new Promise((r) => setTimeout(r, 1200));
    return this.working ? null : 'No tilt data from this device (laptops and some browsers have no motion sensor).';
  }

  /** Motion events are arriving. */
  get working(): boolean {
    return this.lean !== null && performance.now() - this.lastEvent < 2000;
  }

  /** Listening for a while and still nothing: the device cannot tilt-steer. */
  get failed(): boolean {
    return this.listening && performance.now() - this.startedAt > 2500 && !this.working;
  }

  /** The way the phone is held now counts as straight ahead. */
  calibrate(): void {
    if (this.lean !== null) this.neutral = this.lean;
  }

  steer(): number {
    return this.working && this.lean !== null ? tiltSteer(this.lean, this.neutral) : 0;
  }
}
