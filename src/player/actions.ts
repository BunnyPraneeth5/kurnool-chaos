// The actions layer (task M.1): one list of what a player can do. The keyboard and the touch
// buttons both feed it, so a new move is added here once (a key, a button) and the game only
// asks "was Jump pressed?". Pure data and functions, tested in tests/actions.test.ts.

import type { MoveInput } from './input';

/** Everything a key or a touch button can do in the game. */
export const ACTIONS = ['gas', 'brake', 'left', 'right', 'hand', 'jump', 'crouch', 'attack', 'weapon', 'emote', 'act', 'horn', 'boost', 'unstuck', 'map'] as const;
export type Action = (typeof ACTIONS)[number];

/** Actions that steer or drive: held, and read every frame as an axis. */
export const AXIS_ACTIONS: readonly Action[] = ['gas', 'brake', 'left', 'right'];

/** Keys for each action (KeyboardEvent.code). The first one is shown in the guide. */
export const KEYS: Record<Action, readonly string[]> = {
  gas: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  hand: ['ShiftLeft', 'ShiftRight'],
  // Space jumps on foot and is the handbrake in a vehicle (game.ts reads it as both).
  jump: ['Space'],
  crouch: ['KeyZ'],
  attack: ['KeyF'],
  weapon: ['KeyQ'],
  emote: ['KeyX'],
  act: ['KeyE'],
  horn: ['KeyH'],
  boost: ['KeyB'],
  unstuck: ['KeyR'],
  map: ['KeyC'],
};

/** Keys handled by the menus and chat, not the game (listed so nothing clashes with them). */
export const UI_KEYS: readonly string[] = ['Escape', 'KeyG', 'KeyT', 'Enter'];

const BY_CODE = new Map<string, Action>();
for (const a of ACTIONS) for (const code of KEYS[a]) BY_CODE.set(code, a);

/** The action a key does, if any. */
export function keyAction(code: string): Action | undefined {
  return BY_CODE.get(code);
}

/** How a key is written for people (guide, hints). */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const names: Record<string, string> = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'Shift', ShiftRight: 'Shift', Space: 'Space', Escape: 'Esc', Enter: 'Enter',
  };
  return names[code] ?? code;
}

/** Joystick dead zone. */
export const DEAD = 0.18;

export interface AxisSources {
  /** Held actions (keys and touch buttons together). */
  held: (a: Action) => boolean;
  /** Joystick, -1..1 each way (y down is positive, like the screen). */
  stick: { x: number; y: number };
  /** Tilt steering, -1..1, or 0 when tilt is not used. */
  tilt: number;
}

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));

/** Throttle, steering and the Run/Handbrake button from everything held this frame. */
export function moveFrom(s: AxisSources): MoveInput {
  let thr = (s.held('gas') ? 1 : 0) - (s.held('brake') ? 1 : 0);
  let steer = (s.held('right') ? 1 : 0) - (s.held('left') ? 1 : 0);
  if (Math.abs(s.stick.y) > DEAD) thr -= s.stick.y;
  if (Math.abs(s.stick.x) > DEAD) steer += s.stick.x;
  steer += s.tilt;
  return { thr: clamp1(thr), steer: clamp1(steer), hand: s.held('hand') };
}

/** Emote and weapon wheels pick with the number keys. */
export function digitOf(code: string): number | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return m ? Number(m[1]) : null;
}
