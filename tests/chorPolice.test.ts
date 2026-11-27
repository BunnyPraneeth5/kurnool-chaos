import { describe, expect, it } from 'vitest';
import { chorPoliceMode as m } from '../src/modes/chorPolice';
import { ctx, state } from './helpers';

const ids = ['a', 'b', 'c', 'd', 'e'];

describe('Chor–Police setup', () => {
  it('gives 1 police to small rooms and 2 from 5 players', () => {
    const count = (n: number): number => Object.values(m.setup(ids.slice(0, n), 5, ctx({})).roles).filter((r) => r === 'police').length;
    expect(count(2)).toBe(1);
    expect(count(4)).toBe(1);
    expect(count(5)).toBe(2);
  });

  it('picks every player as police about equally often', () => {
    const seen: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 6000; i++) {
      const roles = m.setup(['a', 'b', 'c'], 5, ctx({})).roles;
      for (const [id, r] of Object.entries(roles)) if (r === 'police') seen[id]++;
    }
    for (const n of Object.values(seen)) expect(n).toBeGreaterThan(1700);
  });
});

describe('Chor–Police catches', () => {
  const near = { a: { x: 0, z: 0 }, b: { x: 3, z: 0 }, c: { x: 500, z: 0 } };
  const fresh = () => state({ players: ['a', 'b', 'c'], roles: { a: 'police', b: 'chor', c: 'chor' }, scores: { a: 0, b: 0, c: 0 }, data: { turnedAt: { a: 0 }, caughtBy: {} } });

  it('refuses a catch during the head start', () => {
    const s = { ...fresh(), elapsedMs: 5000 };
    expect(m.claim(s, 'a', { kind: 'catch', target: 'b' }, ctx(near))).toBe(false);
  });

  it('accepts a close catch: the chor turns police, both score', () => {
    const s = { ...fresh(), elapsedMs: 20000 };
    expect(m.claim(s, 'a', { kind: 'catch', target: 'b' }, ctx(near))).toBe(true);
    expect(s.roles.b).toBe('police');
    expect(s.scores.a).toBe(30);
    expect(s.scores.b).toBe(20);
  });

  it('counts a catch once (a repeated claim is refused)', () => {
    const s = { ...fresh(), elapsedMs: 20000 };
    m.claim(s, 'a', { kind: 'catch', target: 'b' }, ctx(near));
    expect(m.claim(s, 'a', { kind: 'catch', target: 'b' }, ctx(near))).toBe(false);
    expect(s.scores.a).toBe(30);
  });

  it('refuses a catch from too far away and one by a chor', () => {
    const s = { ...fresh(), elapsedMs: 20000 };
    expect(m.claim(s, 'a', { kind: 'catch', target: 'c' }, ctx(near))).toBe(false);
    expect(m.claim(s, 'b', { kind: 'catch', target: 'c' }, ctx({ ...near, c: { x: 4, z: 0 } }))).toBe(false);
  });

  it('a new police waits 3 s before catching', () => {
    const s = { ...fresh(), elapsedMs: 20000 };
    m.claim(s, 'a', { kind: 'catch', target: 'b' }, ctx(near));
    const c2 = ctx({ ...near, c: { x: 4, z: 0 } });
    expect(m.claim({ ...s, elapsedMs: 21000 }, 'b', { kind: 'catch', target: 'c' }, c2)).toBe(false);
    expect(m.claim({ ...s, elapsedMs: 24000 }, 'b', { kind: 'catch', target: 'c' }, c2)).toBe(true);
  });

  it('ends when no chor is left, and free chors get survival points', () => {
    const s = { ...fresh(), elapsedMs: 100000, roles: { a: 'police', b: 'police', c: 'chor' } };
    expect(m.done(s, ctx(near))).toBe(false);
    m.finish(s, ctx(near));
    expect(s.scores.c).toBe(100 + 60);
    expect(m.done({ ...s, roles: { a: 'police', b: 'police', c: 'police' } }, ctx(near))).toBe(true);
  });
});
