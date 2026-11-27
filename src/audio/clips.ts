import type { VehicleType } from '../vehicles/params';

// The recordings in public/sounds/: where each came from (all CC0 on Freesound, listed on
// the About page), which part repeats, and which vehicle or event plays it. They were cut
// to mono 32 kHz MP3 from Freesound's high-quality previews.

export interface Clip {
  /** what you hear it for, for the About page */
  use: string;
  /** seconds: the part that repeats (engines, the siren, a held horn) */
  loop?: [number, number];
  source: { title: string; author: string; id: number };
}

export const CLIPS = {
  'engine-car': { use: 'Car engine', loop: [0.1, 2.50097], source: { title: 'Vehicle_Car_Peugeot_308_Idle_Exterior_Loop_Mono_02', author: 'Nox_Sound', id: 522225 } },
  'engine-auto': { use: 'Auto engine', loop: [0.1, 2.75391], source: { title: 'Thailand tuk tuk motorcycle taxi on board engine driving', author: 'kyles', id: 177754 } },
  'engine-bike': { use: 'Bike engine', loop: [0.1, 2.51881], source: { title: 'bull1 (1970 Royal Enfield Bullet)', author: 'ashimda', id: 159326 } },
  'engine-bus': { use: 'Bus engine', loop: [0.1, 2.67759], source: { title: 'school bus truck ext idle engine close1', author: 'kyles', id: 451667 } },
  'engine-lorry': { use: 'Lorry engine', loop: [0.1, 2.81316], source: { title: 'Truck Engine Idle Loops', author: 'qubodup', id: 187564 } },
  'horn-car': { use: 'Car horn', loop: [0.19187, 0.31675], source: { title: 'Car Horn Skoda Fabia', author: 'innov8_Music', id: 871628 } },
  'horn-auto': { use: 'Auto horn', loop: [0.37581, 0.50662], source: { title: 'auto horn honk real nice clean slight street echo India', author: 'kyles', id: 451321 } },
  'horn-bike': { use: 'Bike horn', loop: [0.52, 1.04], source: { title: 'BEEP BEEP', author: 'Anzbot', id: 563346 } },
  'horn-bus': { use: 'Bus horn', loop: [1.04019, 1.62038], source: { title: 'school bus truck int horn honk', author: 'kyles', id: 451697 } },
  'horn-lorry': { use: 'Lorry horn', loop: [1.31447, 2.01894], source: { title: 'Loud truck horn in front of a tent jail prison', author: 'felix.blume', id: 667749 } },
  siren: { use: 'Police siren', loop: [0.1, 5.23506], source: { title: 'SS2000_wail_seamless', author: 'ThePeasantJoe', id: 800708 } },
  crash: { use: 'Crash', source: { title: 'Car Crash', author: 'squareal', id: 237375 } },
  'beep-get-in': { use: 'Getting in and out', source: { title: 'DSLR Beep', author: 'qubodup', id: 740670 } },
  'beep-star': { use: 'Police star and boost', source: { title: 'Walkie Talkie Beep', author: 'SoundBiterSFX', id: 732209 } },
  'beep-busted': { use: 'Busted', source: { title: 'negative_beeps', author: 'themusicalnomad', id: 253886 } },
} satisfies Record<string, Clip>;

export type ClipName = keyof typeof CLIPS;
export const CLIP_NAMES = Object.keys(CLIPS) as ClipName[];

export function clipInfo(name: ClipName): Clip {
  return CLIPS[name] as Clip;
}

export function sourceUrl(clip: Clip): string {
  return `https://freesound.org/s/${clip.source.id}/`;
}

/** Engine recording per vehicle, and its playback speed (pitch) standing still and at top speed. */
export const ENGINES: Record<VehicleType, { clip: ClipName; idle: number; top: number }> = {
  car: { clip: 'engine-car', idle: 1, top: 2.3 },
  // Recorded while driving, so it is slowed down to stand still.
  auto: { clip: 'engine-auto', idle: 0.7, top: 1.55 },
  bike: { clip: 'engine-bike', idle: 1, top: 2.6 },
  bus: { clip: 'engine-bus', idle: 0.95, top: 1.9 },
  lorry: { clip: 'engine-lorry', idle: 0.85, top: 1.7 },
};

/** Horn recording per vehicle, and how long a traffic vehicle's honk lasts (seconds). */
export const HORNS: Record<VehicleType, { clip: ClipName; honk: number }> = {
  car: { clip: 'horn-car', honk: 0.4 },
  auto: { clip: 'horn-auto', honk: 0.45 },
  bike: { clip: 'horn-bike', honk: 0.42 },
  bus: { clip: 'horn-bus', honk: 0.55 },
  lorry: { clip: 'horn-lorry', honk: 0.65 },
};

export type Cue = 'getIn' | 'getOut' | 'star' | 'boost' | 'busted';

/** Short beeps: some events share a recording at another speed. */
export const CUES: Record<Cue, { clip: ClipName; rate: number; gain: number }> = {
  getIn: { clip: 'beep-get-in', rate: 1, gain: 0.3 },
  getOut: { clip: 'beep-get-in', rate: 0.75, gain: 0.3 },
  star: { clip: 'beep-star', rate: 1, gain: 0.25 },
  boost: { clip: 'beep-star', rate: 1.35, gain: 0.25 },
  busted: { clip: 'beep-busted', rate: 1, gain: 0.3 },
};

/** Download one sound file. Throws an Error that names the file and what went wrong. */
export async function fetchClip(url: string, get: typeof fetch = fetch): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await get(url, { signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error(`${url} did not download (network problem).`);
  }
  if (!res.ok) throw new Error(`${url} did not download (HTTP ${res.status}).`);
  // A dev server answers a missing file with the game's HTML page.
  if (res.headers.get('content-type')?.includes('text/html')) throw new Error(`${url} is missing.`);
  try {
    return await res.arrayBuffer();
  } catch {
    throw new Error(`${url} stopped downloading part way.`);
  }
}
