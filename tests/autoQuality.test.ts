import { describe, expect, it } from 'vitest';
import { SlowWatch, nextStep, SLOW_S } from '../src/world/autoQuality';

// Task M.13: the automatic slow-down.

describe('automatic slow-down', () => {
  it('steps down: resolution 1x, then 0.75x, then fewer cars and people, then nothing', () => {
    expect(nextStep({ pixelRatio: 2, fewer: false })).toBe('ratio1');
    expect(nextStep({ pixelRatio: 1, fewer: false })).toBe('ratio075');
    expect(nextStep({ pixelRatio: 0.75, fewer: false })).toBe('fewer');
    expect(nextStep({ pixelRatio: 0.75, fewer: true })).toBeNull();
  });

  const run = (w: SlowWatch, fps: number, seconds: number, counts = true): number => {
    let fired = 0;
    for (let i = 0; i < fps * seconds; i++) if (w.frame(1 / fps, counts)) fired++;
    return fired;
  };

  it('fires after 10 s under 25 fps, not before, and then counts again', () => {
    const w = new SlowWatch();
    expect(run(w, 20, SLOW_S - 1)).toBe(0);
    expect(run(w, 20, 1.05)).toBe(1);
    expect(run(w, 20, SLOW_S - 1)).toBe(0);
  });

  it('a fast second starts the count again; 30 fps never fires', () => {
    const w = new SlowWatch();
    run(w, 20, 8);
    run(w, 40, 1);
    expect(run(w, 20, 8)).toBe(0);
    expect(run(new SlowWatch(), 30, 60)).toBe(0);
  });

  it('time in the menu, hidden or loading does not count', () => {
    const w = new SlowWatch();
    expect(run(w, 10, 30, false)).toBe(0);
  });
});
