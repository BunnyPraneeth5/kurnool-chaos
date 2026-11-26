import type { Building, MapData, PackedBuilding, Pt } from './types';
import { Terrain, type TerrainMeta } from './terrain';

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
  const m = data as Partial<Omit<MapData, 'buildings'>> & { buildings?: unknown };
  const problems: string[] = [];
  if (m.version !== 2) problems.push(`unsupported version ${String(m.version)}`);
  if (!m.bounds || !m.playArea) problems.push('missing bounds');
  if (!Array.isArray(m.roads) || m.roads.length === 0) problems.push('no roads');
  if (!m.graph || !Array.isArray(m.graph.nodes) || !Array.isArray(m.graph.edges) || (m.graph.edges as unknown[]).length % 6) problems.push('no road graph');
  if (!Array.isArray(m.buildings)) problems.push('no buildings list');
  if (!Array.isArray(m.water)) problems.push('no water list');
  if (!m.spawn) problems.push('no spawn point');
  if (!Array.isArray(m.rail) || !Array.isArray(m.waterways)) problems.push('no railway or waterways');
  if (!m.terrain || !(m.terrain.w > 1 && m.terrain.h > 1)) problems.push('no terrain');
  if (!m.props || !Array.isArray(m.props.poles) || !Array.isArray(m.props.trees) || !Array.isArray(m.props.worship)) problems.push('no street details');
  if (problems.length) {
    throw new MapLoadError(`The map file is not usable: ${problems.join(', ')}. Rebuild it with npm run map:build.`);
  }
  let buildings: Building[];
  try {
    buildings = (m.buildings as PackedBuilding[]).map(unpackBuilding);
  } catch {
    throw new MapLoadError('The map file is damaged (bad building outlines). Rebuild it with npm run map:build.');
  }
  // Graph edges are stored flat: [a, b, road, len in decimetres, i0, i1, ...].
  const flat = m.graph!.edges as unknown as number[];
  const edges: MapData['graph']['edges'] = [];
  for (let i = 0; i < flat.length; i += 6) edges.push({ a: flat[i], b: flat[i + 1], road: flat[i + 2], len: flat[i + 3] / 10, i0: flat[i + 4], i1: flat[i + 5] });
  return { ...(m as Omit<MapData, 'buildings'>), graph: { nodes: m.graph!.nodes, edges }, buildings };
}

/** Building outlines are stored as decimetre deltas (see docs/ARCHITECTURE.md) to keep the file small. */
function unpackBuilding(b: PackedBuilding): Building {
  const p = b.p;
  if (!Array.isArray(p) || p.length < 6 || p.length % 2) throw new Error('bad outline');
  const pts: Pt[] = [];
  let x = 0;
  let z = 0;
  for (let i = 0; i < p.length; i += 2) {
    x += p[i];
    z += p[i + 1];
    pts.push([x / 10, z / 10]);
  }
  const out: Building = { pts, h: b.h, style: b.s ?? 0 };
  if (b.k) out.kind = b.k;
  if (b.w !== undefined) out.gate = b.w;
  return out;
}

/** Fetch the ground heights grid that sits next to the map file. No fallback to a flat world. */
export async function loadTerrain(mapUrl: string, meta: TerrainMeta): Promise<Terrain> {
  const url = mapUrl.replace(/[^/]*$/, '') + meta.file;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new MapLoadError('Could not reach the server to download the ground heights. Check your internet connection.');
  }
  if (!res.ok) throw new MapLoadError(`The ground heights file is missing (HTTP ${res.status} for ${url}).`);
  let buf: ArrayBuffer;
  try {
    buf = await res.arrayBuffer();
  } catch {
    throw new MapLoadError('The ground heights download was interrupted. Check your internet connection and retry.');
  }
  if (buf.byteLength !== meta.w * meta.h * 2) {
    throw new MapLoadError(`The ground heights file is damaged (${buf.byteLength} bytes, expected ${meta.w * meta.h * 2}). Rebuild it with npm run map:build.`);
  }
  return new Terrain(meta, new Int16Array(buf));
}
