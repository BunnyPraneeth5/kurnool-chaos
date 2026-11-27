import { describe, expect, it } from 'vitest';
import { parseState, SnapshotBuffer, sendHz } from '../src/net/interp';
import { shuffle } from '../src/util/rng';

const base = { id: 'x', t: 1, x: 1, z: 2, y: 0, h: 0, v: 3, mode: 'car', car: 2 };

describe('network state', () => {
  it('accepts every vehicle type and on foot', () => {
    for (const mode of ['car', 'auto', 'bike', 'bus', 'lorry']) expect(parseState({ ...base, mode })?.mode).toBe(mode);
    expect(parseState({ ...base, mode: 'foot' })?.car).toBe(-1);
  });

  it('rejects junk', () => {
    expect(parseState(null)).toBeNull();
    expect(parseState({ ...base, mode: 'plane' })).toBeNull();
    expect(parseState({ ...base, x: Number.NaN })).toBeNull();
    expect(parseState({ ...base, x: 1e9 })).toBeNull();
  });

  it('marks a vehicle that is not a shared one as -2', () => {
    expect(parseState({ ...base, car: -2 })?.car).toBe(-2);
    expect(parseState({ ...base, car: 1.5 })?.car).toBe(-2);
  });

  it('keeps a full room under the message budget', () => {
    for (let n = 2; n <= 8; n++) expect(sendHz(n) * n * n).toBeLessThanOrEqual(80);
  });

  it('interpolates between snapshots', () => {
    const b = new SnapshotBuffer();
    b.push({ ...base, mode: 'car', t: 0, x: 0 }, 1000);
    b.push({ ...base, mode: 'car', t: 200, x: 10 }, 1200);
    expect(b.sample(1200, 100)?.x).toBeCloseTo(5);
  });
});

describe('shuffle', () => {
  it('keeps every item and gives every order of three about equally', () => {
    const seen = new Map<string, number>();
    for (let i = 0; i < 6000; i++) {
      const k = shuffle([1, 2, 3]).join('');
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    expect(seen.size).toBe(6);
    for (const n of seen.values()) expect(n).toBeGreaterThan(800);
  });
});
