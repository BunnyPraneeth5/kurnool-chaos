import type { MapData } from './types';

/** Thrown with a message that is safe to show to the player. */
export class MapLoadError extends Error {}

/** Fetch and sanity-check the built map. No fallback: any problem is a clear error. */
export async function loadMap(url: string): Promise<MapData> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new MapLoadError('Could not reach the server to download the map. Check your internet connection.');
  }
  if (!res.ok) {
    throw new MapLoadError(`The map file is missing (HTTP ${res.status} for ${url}).`);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new MapLoadError('The map file is damaged (not valid JSON).');
  }
  const m = data as Partial<MapData>;
  const problems: string[] = [];
  if (m.version !== 1) problems.push(`unsupported version ${String(m.version)}`);
  if (!m.bounds || !m.playArea) problems.push('missing bounds');
  if (!Array.isArray(m.roads) || m.roads.length === 0) problems.push('no roads');
  if (!m.graph || !Array.isArray(m.graph.nodes)) problems.push('no road graph');
  if (!Array.isArray(m.buildings)) problems.push('no buildings list');
  if (!Array.isArray(m.water)) problems.push('no water list');
  if (!m.spawn) problems.push('no spawn point');
  if (problems.length) {
    throw new MapLoadError(`The map file is not usable: ${problems.join(', ')}. Rebuild it with npm run map:build.`);
  }
  return m as MapData;
}
