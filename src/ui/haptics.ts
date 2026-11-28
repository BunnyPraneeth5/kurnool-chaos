import { settings } from './settings';

// Short phone buzzes (task M.1). Android browsers have navigator.vibrate; iPhones do not, so
// there the Vibration setting says so and nothing happens.

export const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

let last = 0;

/** Buzz for `ms` milliseconds (or a pattern), when the setting is on. */
export function buzz(ms: number | number[]): void {
  if (!canVibrate || !settings().vibration) return;
  const now = performance.now();
  // Crashes come in bursts; one buzz every 60 ms is plenty.
  if (now - last < 60) return;
  last = now;
  try {
    navigator.vibrate(ms);
  } catch {
    // Some browsers throw before the first tap; the next buzz will work.
  }
}
