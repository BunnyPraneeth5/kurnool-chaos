// Automatic slow-down handling (task M.13). When the game runs under 25 fps for 10 seconds
// it steps down one level, with a message: resolution 1x, then 0.75x, then half the traffic
// and pedestrians. Only when graphics quality is Auto or Low (a player who picked High keeps
// it). Seconds hidden, in the menu or loading do not count. Pure logic, tested.

export const SLOW_FPS = 25;
export const SLOW_S = 10;

export type Step = 'ratio1' | 'ratio075' | 'fewer';

export interface QualityNow {
  pixelRatio: number;
  /** traffic already halved */
  fewer: boolean;
}

/** The next step down from where we are, or null when there is nothing left to lower. */
export function nextStep(q: QualityNow): Step | null {
  if (q.pixelRatio > 1) return 'ratio1';
  if (q.pixelRatio > 0.75) return 'ratio075';
  if (!q.fewer) return 'fewer';
  return null;
}

/** Counts slow seconds; says when to step down. */
export class SlowWatch {
  private slow = 0;
  private frames = 0;
  private t = 0;

  /**
   * One frame of `dt` seconds. `counts`: the game is on screen and playing. Returns true when
   * the last 10 s of play averaged under 25 fps (then it starts counting again).
   */
  frame(dt: number, counts: boolean): boolean {
    if (!counts || dt <= 0 || dt > 1) return false;
    this.frames++;
    this.t += dt;
    if (this.t < 1) return false;
    // One second sampled.
    const fps = this.frames / this.t;
    this.frames = 0;
    this.t = 0;
    this.slow = fps < SLOW_FPS ? this.slow + 1 : 0;
    if (this.slow < SLOW_S) return false;
    this.slow = 0;
    return true;
  }
}
