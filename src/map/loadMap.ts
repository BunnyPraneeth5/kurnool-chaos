import type { MapData } from './types';

/** Thrown with a message that is safe to show to the player. */
export class MapLoadError extends Error {}

/**
 * Fetch and sanity-check the built map, reporting downloaded bytes as it goes.
 * No fallback: any problem is a clear error.
 */
export async function loadMap(url: string, onProgress?: (bytes: number) => void): Promise<MapData> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new MapLoadError('Could not reach the server to download the map. Check your internet connection.');
  }
  if (!res.ok) {
    throw new MapLoadError(`The map file is missing (HTTP ${res.status} for ${url}).`);
  }
  // Some servers answer a missing file with their HTML page instead of a 404.
  if ((res.headers.get('content-type') ?? '').includes('text/html')) {
    throw new MapLoadError(`The map file is missing (the server sent a web page for ${url}).`);
  }

  let text: string;
  try {
    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parts: string[] = [];
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        parts.push(decoder.decode(value, { stream: true }));
        onProgress?.(bytes);
      }
      parts.push(decoder.decode());
      text = parts.join('');
    } else {
      text = await res.text();
    }
  } catch {
    throw new MapLoadError('The map download was interrupted. Check your internet connection and retry.');
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
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
