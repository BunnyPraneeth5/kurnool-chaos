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
  sound: boolean;
  volume: 'low' | 'normal' | 'high';
  /** short buzz on button presses, hits and crashes (task M.1) */
  vibration: boolean;
  /** how fast a swipe turns the camera (task M.3) */
  look: Level;
  /** how phones steer (task M.5) */
  steerMode: SteerMode;
  /** touch button opacity, 0.3 to 1 (task M.4) */
  ctlOpacity: number;
}

export type SteerMode = 'stick' | 'arrows' | 'tilt';

const KEY = 'kc.settings';
const DEFAULTS: Settings = { quality: null, camera: 'normal', steering: 'normal', minimap: true, sound: true, volume: 'normal', vibration: true, look: 'normal', steerMode: 'stick', ctlOpacity: 0.85 };

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
      sound: raw.sound !== false,
      volume: raw.volume === 'low' || raw.volume === 'high' ? raw.volume : 'normal',
      vibration: raw.vibration !== false,
      look: raw.look === 'low' || raw.look === 'high' ? raw.look : 'normal',
      steerMode: raw.steerMode === 'arrows' || raw.steerMode === 'tilt' ? raw.steerMode : 'stick',
      ctlOpacity: typeof raw.ctlOpacity === 'number' && raw.ctlOpacity >= 0.3 && raw.ctlOpacity <= 1 ? raw.ctlOpacity : DEFAULTS.ctlOpacity,
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
export const LOOK_SCALE: Record<Level, number> = { low: 0.6, normal: 1, high: 1.6 };
