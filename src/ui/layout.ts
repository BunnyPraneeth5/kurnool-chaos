import type { SteerMode } from './settings';

// Touch button layout (tasks M.2 and M.4): where each control sits and which ones show.
// Pure data and functions (tests/layout.test.ts); src/ui/touch.ts draws them.

/** Every on-screen control. Most are actions; 'stick' is the joystick. */
export const CONTROL_IDS = ['stick', 'left', 'right', 'gas', 'brake', 'hand', 'act', 'horn', 'boost', 'unstuck', 'map'] as const;
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
export type LayoutKey = `${Orientation}-${Group}`;

export function groupOf(mode: SteerMode): Group {
  return mode === 'stick' ? 'stick' : 'pedals';
}

export function layoutKey(o: Orientation, mode: SteerMode): LayoutKey {
  return `${o}-${groupOf(mode)}`;
}

const s = (x: number, y: number, d: number): Slot => ({ x, y, d });

// Defaults. Portrait is laid out for a 375 px wide phone, landscape for a 390 px high one.
// Right-hand buttons sit in an arc round the corner the thumb rests on. Unstuck and Map sit
// under the minimap and the room pill.
const DEFAULTS: Record<LayoutKey, Layout> = {
  'portrait-stick': {
    stick: s(84, 90, 136), left: s(50, 70, 76), right: s(134, 70, 76),
    hand: s(62, 80, 84), act: s(62, 186, 72), horn: s(158, 50, 58), boost: s(156, 128, 60),
    gas: s(62, 80, 88), brake: s(160, 60, 70),
    unstuck: s(30, 212, 46), map: s(84, 212, 46),
  },
  'portrait-pedals': {
    stick: s(84, 90, 136), left: s(50, 70, 76), right: s(134, 70, 76),
    gas: s(62, 80, 88), brake: s(160, 60, 70), hand: s(150, 150, 62), act: s(62, 190, 64),
    horn: s(150, 230, 54), boost: s(62, 278, 56),
    unstuck: s(30, 212, 46), map: s(84, 212, 46),
  },
  'landscape-stick': {
    stick: s(90, 86, 136), left: s(60, 70, 84), right: s(160, 70, 84),
    hand: s(70, 70, 84), act: s(176, 62, 70), horn: s(70, 168, 56), boost: s(162, 148, 58),
    gas: s(70, 76, 90), brake: s(178, 60, 72),
    unstuck: s(30, 140, 44), map: s(82, 140, 44),
  },
  'landscape-pedals': {
    stick: s(90, 86, 136), left: s(60, 70, 84), right: s(160, 70, 84),
    gas: s(70, 76, 90), brake: s(178, 60, 72), hand: s(180, 150, 62), act: s(70, 180, 60),
    horn: s(270, 56, 54), boost: s(270, 130, 54),
    unstuck: s(30, 140, 44), map: s(82, 140, 44),
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
}

/** The controls shown right now. Buttons that cannot be used are hidden, not greyed. */
export function visibleControls(st: ControlState): Set<ControlId> {
  const on = new Set<ControlId>();
  const { mode } = st;
  if (mode === 'map') {
    on.add('map');
    return on;
  }
  on.add('map');
  if (mode === 'ride') {
    on.add('act');
    return on;
  }
  on.add('unstuck');
  on.add('hand');
  if (mode === 'foot') {
    on.add('stick');
    if (st.near) on.add('act');
    return on;
  }
  // Driving.
  on.add('act');
  on.add('horn');
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
  return visibleControls({ mode, near: true, boosts: 1, steer });
}
