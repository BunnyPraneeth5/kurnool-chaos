import { describe, expect, it } from 'vitest';
import { ChaosPoints, CHAOS } from '../src/modes/chaosPoints';
import { chaosMode as m } from '../src/modes/chaos';
import { ctx, state } from './helpers';

describe('chaos points', () => {
  it('adds up, keeps the best round, and busted loses a quarter (at least 50)', () => {
    const c = new ChaosPoints();
    const seen: number[] = [];
    c.onChange = (d) => seen.push(d);
    c.add(100, 'Crash');
    c.add(300, 'Drift');
    expect(c.total).toBe(400);
    expect(c.best).toBe(400);
    c.busted();
    expect(c.total).toBe(300);
    expect(seen).toEqual([100, 300, -100]);
    c.startRound();
    c.add(30, 'x');
    c.busted();
    expect(c.round).toBe(0); // at least 50, never below 0
    expect(c.best).toBe(400);
  });

  it('pays for every second with stars', () => {
    const c = new ChaosPoints();
    for (let i = 0; i < 60; i++) c.heat(1 / 30, 3); // 2 s at 3 stars
    expect(c.total).toBe(Math.round(2 * 3 * CHAOS.heatPerStarS));
  });
});

describe('Chaos mode', () => {
  it('takes each player\'s reported points quietly, and ignores junk', () => {
    const s = state({ mode: 'chaos', players: ['a', 'b'], scores: { a: 0, b: 0 } });
    expect(m.claim(s, 'a', { kind: 'chaos', points: 120.4 }, ctx({}))).toBe('quiet');
    expect(s.scores.a).toBe(120);
    expect(m.claim(s, 'a', { kind: 'chaos', points: 120 }, ctx({}))).toBe(false);
    expect(m.claim(s, 'b', { kind: 'chaos', points: Number.NaN }, ctx({}))).toBe(false);
    expect(m.claim(s, 'b', { kind: 'chaos', points: -5 }, ctx({}))).toBe(false);
    expect(m.done(s, ctx({}))).toBe(false);
  });
});
