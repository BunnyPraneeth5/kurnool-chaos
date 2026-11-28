// Keyboard input. Keys are turned into actions (src/player/actions.ts); the game reads
// actions, never key codes.

import { keyAction, type Action } from './actions';

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
  private readonly pressed = new Set<Action>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      // Typing a nickname or a chat message must not drive the car.
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable)) return;
      const a = keyAction(e.code);
      if (a && !e.repeat) this.pressed.add(a);
      this.down.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  /** An action's key is held down. */
  held(a: Action): boolean {
    for (const code of this.down) if (keyAction(code) === a) return true;
    return false;
  }

  /** True once per key press (not held repeats). */
  consume(a: Action): boolean {
    return this.pressed.delete(a);
  }

  /** Forget presses nobody consumed this frame. */
  endFrame(): void {
    this.pressed.clear();
  }
}
