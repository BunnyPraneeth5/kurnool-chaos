// Quality setting (ARCHITECTURE: Rendering). Low = pixel ratio 1, shorter fog,
// fewer trees, no lit windows, less traffic. Phones default to low, laptops to high.
// Override with ?quality=low or ?quality=high. A menu toggle comes in task 7.1.

export type Quality = 'low' | 'high';

export interface QualitySettings {
  level: Quality;
  pixelRatio: number;
  fogFar: number;
  litWindows: boolean;
  treeDensity: number; // 0..1 share of trees kept
  traffic: number; // local traffic vehicles around the player
  vehicleShadows: boolean;
}

export function detectQuality(): QualitySettings {
  const q = new URLSearchParams(location.search).get('quality');
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const level: Quality = q === 'low' || q === 'high' ? q : coarse ? 'low' : 'high';
  const dpr = window.devicePixelRatio || 1;
  return level === 'low'
    ? { level, pixelRatio: 1, fogFar: 420, litWindows: false, treeDensity: 0.5, traffic: 20, vehicleShadows: false }
    : { level, pixelRatio: Math.min(dpr, 2), fogFar: 580, litWindows: true, treeDensity: 1, traffic: 32, vehicleShadows: true };
}
