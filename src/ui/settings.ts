// Player settings (TASKS H.2), saved on this device. Read anywhere with settings();
// change with saveSettings(), which tells listeners.

export type Level = 'low' | 'normal' | 'high';

export interface Settings {
  /** null = pick from the device (phones low, laptops high) */
  quality: 'low' | 'high' | null;
  /** chase camera distance */
  camera: 'near' | 'normal' | 'far';
  steering: Level;
  minimap: boolean;
}

const KEY = 'kc.settings';
const DEFAULTS: Settings = { quality: null, camera: 'normal', steering: 'normal', minimap: true };

let current: Settings = load();
const listeners: ((s: Settings) => void)[] = [];

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return {
      quality: raw.quality === 'low' || raw.quality === 'high' ? raw.quality : null,
      camera: raw.camera === 'near' || raw.camera === 'far' ? raw.camera : 'normal',
      steering: raw.steering === 'low' || raw.steering === 'high' ? raw.steering : 'normal',
      minimap: raw.minimap !== false,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function settings(): Readonly<Settings> {
  return current;
}

export function saveSettings(change: Partial<Settings>): void {
  current = { ...current, ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // private browsing: the setting lasts until the page closes
  }
  for (const f of listeners) f(current);
}

export function onSettings(f: (s: Settings) => void): void {
  listeners.push(f);
}

export const CAMERA_SCALE: Record<Settings['camera'], number> = { near: 0.8, normal: 1, far: 1.25 };
export const STEER_SCALE: Record<Level, number> = { low: 0.7, normal: 1, high: 1.3 };
