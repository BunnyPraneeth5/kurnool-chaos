import { describe, expect, it } from 'vitest';
import { huntMode as m } from '../src/modes/hunt';
import type { Landmark } from '../src/map/types';
import { ctx, state } from './helpers';

const lm = (id: string, x: number): Landmark => ({ id, nameEn: id, nameTe: id, type: 'x', x, z: 0 });
const landmarks = [lm('a', 0), lm('b', 1000), lm('c', 2000), lm('d', 3000), lm('e', 4000), lm('river', 5000)];

describe('Landmark hunt', () => {
  it('picks 3/4/5 targets and never the river', () => {
    for (const [mins, n] of [[3, 3], [5, 4], [10, 5]]) {
      const d = m.setup(['p', 'q'], mins, ctx({}, 'p', { landmarks })).data as { targets: { label: string }[] };
      expect(d.targets).toHaveLength(n);
      expect(d.targets.some((t) => t.label === 'river')).toBe(false);
    }
  });

  it('gives the point to the first arrival and moves everyone on', () => {
    const s = state({ mode: 'hunt', players: ['p', 'q'], scores: { p: 0, q: 0 }, data: { targets: [{ x: 0, z: 0, label: 'A' }, { x: 900, z: 0, label: 'B' }], idx: 0, winners: [] } });
    const c = ctx({ p: { x: 10, z: 0 }, q: { x: 20, z: 0 } });
    expect(m.claim(s, 'p', { kind: 'reach', idx: 0 }, c)).toBe(true);
    expect(m.claim(s, 'q', { kind: 'reach', idx: 0 }, c)).toBe(false); // too late
    expect(s.scores).toEqual({ p: 1, q: 0 });
    expect((s.data as { idx: number }).idx).toBe(1);
  });

  it('refuses an arrival the host sees far away, and ends after the last target', () => {
    const s = state({ mode: 'hunt', players: ['p'], scores: { p: 0 }, data: { targets: [{ x: 0, z: 0, label: 'A' }], idx: 0, winners: [] } });
    expect(m.claim(s, 'p', { kind: 'reach', idx: 0 }, ctx({ p: { x: 200, z: 0 } }))).toBe(false);
    expect(m.done(s, ctx({}))).toBe(false);
    m.claim(s, 'p', { kind: 'reach', idx: 0 }, ctx({ p: { x: 50, z: 0 } }));
    expect(m.done(s, ctx({}))).toBe(true);
  });
});
