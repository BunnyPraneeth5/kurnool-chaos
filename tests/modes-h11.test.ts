import { describe, expect, it } from 'vitest';
import { chorPoliceMode as chor } from '../src/modes/chorPolice';
import { huntMode as hunt } from '../src/modes/hunt';
import { climbMode } from '../src/modes/climb';
import { ctx, state } from './helpers';

describe('Chor–Police upgrades', () => {
  const base = () =>
    state({ players: ['p', 'a', 'b'], roles: { p: 'police', a: 'chor', b: 'chor' }, scores: { p: 0, a: 0, b: 0 }, elapsedMs: 30000, data: { turnedAt: { p: 0 }, caughtBy: {}, escapes: {} } });

  it('an escape scores 15 once per 20 s, only when clear of the police', () => {
    const s = base();
    const far = ctx({ p: { x: 0, z: 0 }, a: { x: 200, z: 0 }, b: { x: 400, z: 0 } });
    expect(chor.claim(s, 'a', { kind: 'escape' }, far)).toBe(true);
    expect(s.scores.a).toBe(15);
    expect(chor.claim({ ...s, elapsedMs: 40000 }, 'a', { kind: 'escape' }, far)).toBe(false);
    expect(chor.claim({ ...s, elapsedMs: 55000 }, 'a', { kind: 'escape' }, far)).toBe(true);
    const near = ctx({ p: { x: 0, z: 0 }, a: { x: 10, z: 0 }, b: { x: 400, z: 0 } });
    expect(chor.claim({ ...s, elapsedMs: 90000 }, 'a', { kind: 'escape' }, near)).toBe(false);
    expect(chor.claim(s, 'p', { kind: 'escape' }, far)).toBe(false);
  });

  it('marks the last chor, whose survival counts double', () => {
    const s = base();
    const c = ctx({ p: { x: 0, z: 0 }, a: { x: 3, z: 0 }, b: { x: 400, z: 0 } });
    expect(chor.claim(s, 'p', { kind: 'catch', target: 'a' }, c)).toBe(true);
    expect((s.data as { lastChor?: string }).lastChor).toBe('b');
    const end = { ...s, elapsedMs: 100000 };
    chor.finish(end, c);
    expect(end.scores.b).toBe(200 + 60);
  });
});

describe('Landmark hunt challenges', () => {
  const withCps = () => state({ mode: 'hunt', players: ['p'], scores: { p: 0 }, data: { targets: [{ x: 0, z: 0, label: 'Raj Vihar', cps: [[30, 0], [-15, 26], [-15, -26]] }], idx: 0, winners: [] } });

  it('Raj Vihar needs its checkpoints first', () => {
    const c = ctx({ p: { x: 5, z: 0 } });
    expect(hunt.claim(withCps(), 'p', { kind: 'reach', idx: 0 }, c)).toBe(false);
    const s = withCps();
    expect(hunt.claim(s, 'p', { kind: 'reach', idx: 0, cps: true }, c)).toBe(true);
    expect(s.scores.p).toBe(1);
  });

  it('the fort gate gives a bonus point', () => {
    const s = state({ mode: 'hunt', players: ['p'], scores: { p: 0 }, data: { targets: [{ x: 0, z: 0, label: 'Fort', gate: [100, 0] }], idx: 0, winners: [] } });
    expect(hunt.claim(s, 'p', { kind: 'reach', idx: 0, via: true }, ctx({ p: { x: 5, z: 0 } }))).toBe(true);
    expect(s.scores.p).toBe(2);
  });
});

describe('Hill climb', () => {
  const course = { starts: Array.from({ length: 8 }, (_, i) => ({ x: i * 9, z: 0, heading: 0 })), finish: { x: 0, z: 3000 }, length: 3000 };
  const m = climbMode(course);

  it('scores by place, riders with their driver, ends when everyone is up', () => {
    const s = state({ mode: 'climb', players: ['a', 'b', 'c'], scores: { a: 0, b: 0, c: 0 }, data: { times: {} } });
    const top = { x: 0, z: 2990 };
    const c = { ...ctx({ a: top, b: top, c: top }), rideOf: (id: string) => (id === 'c' ? 'b' : null) };
    s.elapsedMs = 150000;
    expect(m.claim(s, 'a', { kind: 'finish' }, c)).toBe(true);
    s.elapsedMs = 160000;
    expect(m.claim(s, 'b', { kind: 'finish' }, c)).toBe(true);
    expect(m.claim(s, 'b', { kind: 'finish' }, c)).toBe(false);
    expect(s.scores.b).toBe(7);
    expect(s.scores.c).toBe(7);
    expect(m.done(s, c)).toBe(true);
  });

  it('refuses a finish far from the summit, and is unavailable without a course', () => {
    const s = state({ mode: 'climb', players: ['a'], scores: { a: 0 }, data: { times: {} } });
    expect(m.claim(s, 'a', { kind: 'finish' }, ctx({ a: { x: 0, z: 0 } }))).toBe(false);
    expect(climbMode(null).available).toBe(false);
  });
});
