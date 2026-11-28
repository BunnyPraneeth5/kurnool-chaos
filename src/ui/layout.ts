import type { SteerMode } from './settings';

// Touch button layout (tasks M.2, M.4, M.6 and M.9): where each control sits and which ones
// show. Pure data and functions (tests/controls.test.ts); src/ui/touch.ts draws them.

/** Every on-screen control. Most are actions; 'stick' is the joystick. */
export const CONTROL_IDS = ['stick', 'left', 'right', 'gas', 'brake', 'hand', 'attack', 'jump', 'crouch', 'weapon', 'emote', 'act', 'horn', 'boost', 'unstuck', 'map'] as const;
export type ControlId = (typeof CONTROL_IDS)[number];

/** Which screen corner a control is measured from. */
export type Anchor = 'leftBottom' | 'rightBottom' | 'rightTop';

export const ANCHOR: Record<ControlId, Anchor> = {
  stick: 'leftBottom',
  left: 'leftBottom',
  right: 'leftBottom',
  gas: 'rightBottom',
  brake: 'rightBottom',
  hand: 'rightBottom',
  attack: 'rightBottom',
  jump: 'rightBottom',
  crouch: 'rightBottom',
  weapon: 'rightBottom',
  emote: 'rightBottom',
  act: 'rightBottom',
  horn: 'rightBottom',
  boost: 'rightBottom',
  unstuck: 'rightTop',
  map: 'rightTop',
};

/** Centre of a control, in px from its anchor corner (inside the safe area), and its diameter. */
export interface Slot {
  x: number;
  y: number;
  d: number;
}

export type Layout = Record<ControlId, Slot>;

export type Orientation = 'portrait' | 'landscape';
/** Joystick steering, or pedal buttons (arrows and tilt). */
export type Group = 'stick' | 'pedals';
/** On foot has one layout per orientation; driving one per orientation and steering group. */
export type LayoutKey = `${Orientation}-foot` | `${Orientation}-${Group}`;

export function groupOf(mode: SteerMode): Group {
  return mode === 'stick' ? 'stick' : 'pedals';
}

/** The layout for a screen orientation, steering choice and what you are doing. */
export function layoutKey(o: Orientation, steer: SteerMode, mode: 'foot' | 'drive'): LayoutKey {
  return mode === 'foot' ? `${o}-foot` : `${o}-${groupOf(steer)}`;
}

const s = (x: number, y: number, d: number): Slot => ({ x, y, d });

// Defaults. Portrait is laid out for a 375 px wide phone, landscape for a 390 px high one.
// Right-hand buttons sit in an arc round the corner the thumb rests on; Unstuck and Map sit
// under the minimap and the room pill. Controls a layout never shows keep a harmless spot.
const PORTRAIT_TOP = { unstuck: s(30, 212, 46), map: s(84, 212, 46) };
const LANDSCAPE_TOP = { unstuck: s(30, 140, 44), map: s(82, 140, 44) };
const UNUSED = s(60, 400, 50);

const DEFAULTS: Record<LayoutKey, Layout> = {
  'portrait-foot': {
    stick: s(84, 90, 136), left: UNUSED, right: UNUSED, gas: UNUSED, brake: UNUSED, horn: UNUSED, boost: UNUSED,
    attack: s(62, 80, 88), jump: s(166, 56, 64), hand: s(156, 140, 58), crouch: s(62, 186, 62),
    act: s(156, 222, 60), weapon: s(62, 268, 56), emote: s(62, 334, 48),
    ...PORTRAIT_TOP,
  },
  'portrait-stick': {
    stick: s(84, 90, 136), left: UNUSED, right: UNUSED, gas: UNUSED, brake: UNUSED, jump: UNUSED, crouch: UNUSED, weapon: UNUSED, emote: UNUSED,
    hand: s(62, 80, 84), act: s(62, 186, 72), horn: s(158, 50, 58), boost: s(156, 128, 60), attack: s(150, 215, 60),
    ...PORTRAIT_TOP,
  },
  'portrait-pedals': {
    stick: UNUSED, left: s(50, 70, 76), right: s(134, 70, 76), jump: UNUSED, crouch: UNUSED, weapon: UNUSED, emote: UNUSED,
    gas: s(62, 80, 88), brake: s(160, 60, 70), hand: s(150, 150, 62), act: s(62, 190, 64),
    horn: s(150, 230, 54), boost: s(62, 278, 56), attack: s(150, 310, 56),
    ...PORTRAIT_TOP,
  },
  'landscape-foot': {
    stick: s(90, 86, 136), left: UNUSED, right: UNUSED, gas: UNUSED, brake: UNUSED, horn: UNUSED, boost: UNUSED,
    attack: s(70, 76, 90), jump: s(178, 58, 70), hand: s(180, 152, 60), crouch: s(270, 56, 60),
    act: s(70, 184, 62), weapon: s(270, 136, 54), emote: s(352, 60, 46),
    ...LANDSCAPE_TOP,
  },
  'landscape-stick': {
    stick: s(90, 86, 136), left: UNUSED, right: UNUSED, gas: UNUSED, brake: UNUSED, jump: UNUSED, crouch: UNUSED, weapon: UNUSED, emote: UNUSED,
    hand: s(70, 70, 84), act: s(176, 62, 70), horn: s(70, 168, 56), boost: s(162, 148, 58), attack: s(254, 90, 60),
    ...LANDSCAPE_TOP,
  },
  'landscape-pedals': {
    stick: UNUSED, left: s(60, 70, 84), right: s(160, 70, 84), jump: UNUSED, crouch: UNUSED, weapon: UNUSED, emote: UNUSED,
    gas: s(70, 76, 90), brake: s(178, 60, 72), hand: s(180, 150, 62), act: s(70, 180, 60),
    horn: s(270, 56, 54), boost: s(270, 130, 54), attack: s(350, 90, 60),
    ...LANDSCAPE_TOP,
  },
};

export function defaultLayout(key: LayoutKey): Layout {
  return structuredClone(DEFAULTS[key]);
}

export const MIN_D = 40;
export const MAX_D = 180;

/** Keep a control fully on a w x h screen (sizes clamped too). */
export function clampSlot(slot: Slot, w: number, h: number): Slot {
  const d = Math.max(MIN_D, Math.min(MAX_D, slot.d));
  const r = d / 2;
  return {
    d,
    x: Math.max(r, Math.min(w - r, slot.x)),
    y: Math.max(r, Math.min(h - r, slot.y)),
  };
}

/** A saved layout over the default: unknown or broken entries are ignored. */
export function mergeLayout(key: LayoutKey, saved: unknown): Layout {
  const out = defaultLayout(key);
  if (!saved || typeof saved !== 'object') return out;
  for (const id of CONTROL_IDS) {
    const v = (saved as Record<string, unknown>)[id];
    if (!v || typeof v !== 'object') continue;
    const { x, y, d } = v as Record<string, unknown>;
    if ([x, y, d].every((n) => typeof n === 'number' && Number.isFinite(n))) out[id] = { x: x as number, y: y as number, d: d as number };
  }
  return out;
}

export type PlayMode = 'foot' | 'drive' | 'ride' | 'map';

export interface ControlState {
  mode: PlayMode;
  /** a vehicle (or a friend's) close enough to get in */
  near: boolean;
  /** boosts left in this round */
  boosts: number;
  steer: SteerMode;
  /** holding a gun (driving and riding: a Shoot button, task M.9) */
  gun?: boolean;
  /** knocked down (health ran out): nothing to press until you get up */
  down?: boolean;
}

/** The controls shown right now. Buttons that cannot be used are hidden, not greyed. */
export function visibleControls(st: ControlState): Set<ControlId> {
  const on = new Set<ControlId>();
  const { mode } = st;
  on.add('map');
  if (mode === 'map' || st.down) return on;
  if (mode === 'ride') {
    on.add('act');
    if (st.gun) on.add('attack');
    return on;
  }
  on.add('unstuck');
  on.add('hand');
  if (mode === 'foot') {
    for (const id of ['stick', 'attack', 'jump', 'crouch', 'weapon', 'emote'] as const) on.add(id);
    if (st.near) on.add('act');
    return on;
  }
  // Driving.
  on.add('act');
  on.add('horn');
  if (st.gun) on.add('attack');
  if (st.boosts > 0) on.add('boost');
  if (st.steer === 'stick') on.add('stick');
  else {
    on.add('gas');
    on.add('brake');
    if (st.steer === 'arrows') {
      on.add('left');
      on.add('right');
    }
  }
  return on;
}

/** What the layout editor shows for a steering mode, on foot or driving (every button that can appear). */
export function editableControls(steer: SteerMode, mode: 'foot' | 'drive'): Set<ControlId> {
  return visibleControls({ mode, near: true, boosts: 1, steer, gun: true });
}
