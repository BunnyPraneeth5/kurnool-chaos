import { describe, expect, it } from 'vitest';
import { ACTIONS, KEYS, UI_KEYS, keyAction, keyLabel, moveFrom, type Action } from '../src/player/actions';
import {
  CONTROL_IDS, MAX_D, MIN_D, clampSlot, defaultLayout, editableControls, layoutKey, mergeLayout, visibleControls,
  type ControlState, type LayoutKey,
} from '../src/ui/layout';
import { screenLean, tiltSteer } from '../src/player/tilt';

// Tasks M.1 (actions layer), M.2 (buttons by state), M.4 (layout) and M.5 (tilt).

describe('actions and keys', () => {
  it('every action has a key, and no key does two things', () => {
    const seen = new Map<string, Action>();
    for (const a of ACTIONS) {
      expect(KEYS[a].length).toBeGreaterThan(0);
      for (const code of KEYS[a]) {
        expect(seen.has(code), `${code} used by ${seen.get(code)} and ${a}`).toBe(false);
        seen.set(code, a);
        expect(keyAction(code)).toBe(a);
      }
    }
  });

  it('game keys never clash with the menu and chat keys', () => {
    for (const code of UI_KEYS) expect(keyAction(code)).toBeUndefined();
  });

  it('keeps the keys players already know', () => {
    expect(keyAction('KeyW')).toBe('gas');
    expect(keyAction('ArrowLeft')).toBe('left');
    expect(keyAction('ShiftLeft')).toBe('hand');
    expect(keyAction('Space')).toBe('jump');
    expect(keyAction('KeyZ')).toBe('crouch');
    expect(keyAction('KeyF')).toBe('attack');
    expect(keyAction('KeyQ')).toBe('weapon');
    expect(keyAction('KeyX')).toBe('emote');
    expect(keyAction('KeyE')).toBe('act');
    expect(keyAction('KeyH')).toBe('horn');
    expect(keyAction('KeyB')).toBe('boost');
    expect(keyAction('KeyR')).toBe('unstuck');
    expect(keyAction('KeyC')).toBe('map');
  });

  it('writes keys for people', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('ShiftLeft')).toBe('Shift');
  });
});

describe('moveFrom', () => {
  const none = { x: 0, y: 0 };
  const held = (...on: Action[]) => (a: Action) => on.includes(a);

  it('keys and buttons give full throttle and steering', () => {
    expect(moveFrom({ held: held('gas', 'right'), stick: none, tilt: 0 })).toEqual({ thr: 1, steer: 1, hand: false });
    expect(moveFrom({ held: held('brake', 'left', 'hand'), stick: none, tilt: 0 })).toEqual({ thr: -1, steer: -1, hand: true });
  });

  it('joystick up drives forward, with a dead zone', () => {
    expect(moveFrom({ held: held(), stick: { x: 0.1, y: -0.8 }, tilt: 0 })).toEqual({ thr: 0.8, steer: 0, hand: false });
  });

  it('adds tilt and clamps everything to -1..1', () => {
    const m = moveFrom({ held: held('gas', 'right'), stick: { x: 0.9, y: -1 }, tilt: 0.7 });
    expect(m.thr).toBe(1);
    expect(m.steer).toBe(1);
    expect(moveFrom({ held: held(), stick: none, tilt: -0.4 }).steer).toBeCloseTo(-0.4);
  });
});

describe('which buttons show', () => {
  const st = (o: Partial<ControlState>): ControlState => ({ mode: 'foot', near: false, boosts: 0, steer: 'stick', ...o });
  const ids = (o: Partial<ControlState>) => [...visibleControls(st(o))].sort();

  it('on foot: joystick, Attack, Jump, Crouch, Run, weapon, Emote, Unstuck, Map; Get in only near a vehicle', () => {
    expect(ids({})).toEqual(['attack', 'crouch', 'emote', 'hand', 'jump', 'map', 'stick', 'unstuck', 'weapon']);
    expect(ids({ near: true })).toContain('act');
  });

  it('driving with the joystick: no pedals; Boost only with boosts left; Shoot only with a gun', () => {
    expect(ids({ mode: 'drive' })).toEqual(['act', 'hand', 'horn', 'map', 'stick', 'unstuck']);
    expect(ids({ mode: 'drive', boosts: 2 })).toContain('boost');
    expect(ids({ mode: 'drive', gun: true })).toContain('attack');
    expect(ids({ mode: 'ride', gun: true })).toEqual(['act', 'attack', 'map']);
  });

  it('knocked down: nothing but the map', () => {
    expect(ids({ down: true, near: true })).toEqual(['map']);
  });

  it('arrow steering: arrows and pedals, no joystick; tilt: pedals only', () => {
    expect(ids({ mode: 'drive', steer: 'arrows' })).toEqual(['act', 'brake', 'gas', 'hand', 'horn', 'left', 'map', 'right', 'unstuck']);
    expect(ids({ mode: 'drive', steer: 'tilt' })).toEqual(['act', 'brake', 'gas', 'hand', 'horn', 'map', 'unstuck']);
    // On foot you always walk with the joystick.
    expect(ids({ steer: 'arrows' })).toContain('stick');
  });

  it('riding: only Get out and Map; map view: only Back', () => {
    expect(ids({ mode: 'ride' })).toEqual(['act', 'map']);
    expect(ids({ mode: 'map', near: true })).toEqual(['map']);
  });

  it('the editor shows every button that can appear, on foot or driving', () => {
    expect([...editableControls('arrows', 'drive')].sort()).toEqual(['act', 'attack', 'boost', 'brake', 'gas', 'hand', 'horn', 'left', 'map', 'right', 'unstuck']);
    expect([...editableControls('arrows', 'foot')].sort()).toEqual(['act', 'attack', 'crouch', 'emote', 'hand', 'jump', 'map', 'stick', 'unstuck', 'weapon']);
    expect(editableControls('stick', 'drive').has('gas')).toBe(false);
  });
});

describe('layout', () => {
  const keys: LayoutKey[] = ['portrait-foot', 'portrait-stick', 'portrait-pedals', 'landscape-foot', 'landscape-stick', 'landscape-pedals'];

  it('picks the layout by orientation, steering and on foot or driving', () => {
    expect(layoutKey('portrait', 'stick', 'drive')).toBe('portrait-stick');
    expect(layoutKey('landscape', 'arrows', 'drive')).toBe('landscape-pedals');
    expect(layoutKey('landscape', 'tilt', 'drive')).toBe('landscape-pedals');
    expect(layoutKey('portrait', 'tilt', 'foot')).toBe('portrait-foot');
  });

  it('default buttons shown together never overlap, on a 375x812 and an 844x390 phone', () => {
    for (const key of keys) {
      const l = defaultLayout(key);
      const steer = key.endsWith('pedals') ? 'arrows' : 'stick';
      const [w, h] = key.startsWith('portrait') ? [375, 812] : [844, 390];
      for (const mode of key.endsWith('foot') ? (['foot'] as const) : (['drive'] as const)) {
        const on = [...visibleControls({ mode, near: true, boosts: 2, steer, gun: true })];
        // Centres on one screen (x from the left, y from the top).
        const centre = (id: (typeof on)[number]) => {
          const s = clampSlot(l[id], w, h);
          const a = id === 'stick' || id === 'left' || id === 'right' ? 'lb' : id === 'unstuck' || id === 'map' ? 'rt' : 'rb';
          return { x: a === 'lb' ? s.x : w - s.x, y: a === 'rt' ? s.y : h - s.y, r: s.d / 2 };
        };
        for (let i = 0; i < on.length; i++) {
          for (let j = i + 1; j < on.length; j++) {
            const p = centre(on[i]);
            const q = centre(on[j]);
            expect(Math.hypot(p.x - q.x, p.y - q.y), `${key} ${mode}: ${on[i]} and ${on[j]}`).toBeGreaterThanOrEqual(p.r + q.r);
          }
        }
      }
    }
  });

  it('keeps controls on screen and within size limits', () => {
    expect(clampSlot({ x: -50, y: 9999, d: 500 }, 375, 812)).toEqual({ x: MAX_D / 2, y: 812 - MAX_D / 2, d: MAX_D });
    expect(clampSlot({ x: 100, y: 100, d: 5 }, 375, 812).d).toBe(MIN_D);
  });

  it('a saved layout replaces only good entries', () => {
    const l = mergeLayout('portrait-stick', { act: { x: 10, y: 20, d: 70 }, horn: { x: 'a' }, nonsense: 1 });
    expect(l.act).toEqual({ x: 10, y: 20, d: 70 });
    expect(l.horn).toEqual(defaultLayout('portrait-stick').horn);
    expect(Object.keys(mergeLayout('portrait-stick', null)).sort()).toEqual([...CONTROL_IDS].sort());
  });
});

describe('tilt steering', () => {
  it('reads the lean towards the screen right in every rotation', () => {
    // Portrait, right edge down: the device x axis points down, reading -g.
    expect(screenLean(-9.81, 0, 0)).toBeCloseTo(1);
    // Landscape (rotated 90): the screen's right is the device's top (+y).
    expect(screenLean(0, -9.81, 90)).toBeCloseTo(1);
    expect(screenLean(0, 9.81, 270)).toBeCloseTo(1);
    expect(screenLean(9.81, 0, 180)).toBeCloseTo(1);
  });

  it('dead zone, full lock at ~20 degrees, centred on the calibrated lean', () => {
    expect(tiltSteer(0.02, 0)).toBe(0);
    expect(tiltSteer(0.5, 0)).toBe(1);
    expect(tiltSteer(-0.5, 0)).toBe(-1);
    expect(tiltSteer(0.3, 0.3)).toBe(0);
    const half = tiltSteer(0.19, 0);
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
  });
});
