// Quality setting (ARCHITECTURE: Rendering). Low = pixel ratio 1, shorter fog,
// fewer trees, no lit windows, less traffic. Phones default to low, laptops to high.
// Menu → Settings can pick one (saved); ?quality=low or ?quality=high overrides for a test.

import { settings } from '../ui/settings';

export type Quality = 'low' | 'high';

export interface QualitySettings {
  level: Quality;
  pixelRatio: number;
  fogFar: number;
  litWindows: boolean;
  treeDensity: number; // 0..1 share of trees kept
  traffic: number; // local traffic vehicles around the player
  pedestrians: number;
  vehicleShadows: boolean;
}

export function detectQuality(): QualitySettings {
  const q = new URLSearchParams(location.search).get('quality');
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const saved = settings().quality;
  const level: Quality = q === 'low' || q === 'high' ? q : (saved ?? (coarse ? 'low' : 'high'));
  const dpr = window.devicePixelRatio || 1;
  return level === 'low'
    ? { level, pixelRatio: 1, fogFar: 420, litWindows: false, treeDensity: 0.5, traffic: 20, pedestrians: 25, vehicleShadows: false }
    : { level, pixelRatio: Math.min(dpr, 2), fogFar: 580, litWindows: true, treeDensity: 1, traffic: 32, pedestrians: 50, vehicleShadows: true };
}
