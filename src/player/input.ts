// Keyboard input, ported from the demo's readInput(). Touch controls come in task 2.5.

export interface MoveInput {
  /** -1 back .. 1 forward */
  thr: number;
  /** -1 left .. 1 right */
  steer: number;
  /** Shift or Space: run on foot, handbrake/drift in a vehicle */
  hand: boolean;
}

export class Keyboard {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True once per key press (not held repeats). */
  consume(code: string): boolean {
    return this.pressed.delete(code);
  }

  /** Forget presses nobody consumed this frame. */
  endFrame(): void {
    this.pressed.clear();
  }

  move(): MoveInput {
    const d = this.down;
    const thr = (d.has('KeyW') || d.has('ArrowUp') ? 1 : 0) - (d.has('KeyS') || d.has('ArrowDown') ? 1 : 0);
    const steer = (d.has('KeyD') || d.has('ArrowRight') ? 1 : 0) - (d.has('KeyA') || d.has('ArrowLeft') ? 1 : 0);
    const hand = d.has('ShiftLeft') || d.has('ShiftRight') || d.has('Space');
    return { thr, steer, hand };
  }
}
