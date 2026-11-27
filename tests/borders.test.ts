import { beforeAll, describe, expect, it } from 'vitest';
import type { MapData, Road } from '../src/map/types';
import { Terrain, setTerrain } from '../src/map/terrain';
import { bordersOf } from '../src/map/borders';
import { CollisionWorld, FIX_MS } from '../src/map/collision';

// A tiny flat map: one long two-way trunk road (gets a divider with a railing), one
// residential road (kerbs only on main roads, so none) and a speed breaker.
function tinyMap(): MapData {
  const trunk: Road = { id: 1, kind: 'trunk', width: 14, oneway: false, bridge: false, pts: [[0, -300], [0, 300]] };
  const lane: Road = { id: 2, kind: 'residential', width: 7, oneway: false, bridge: false, pts: [[100, -100], [100, 100]] };
  return {
    version: 2,
    center: { lat: 15.8, lon: 78.0 },
    bounds: { minX: -500, minZ: -500, maxX: 500, maxZ: 500 },
    playArea: { minX: -500, minZ: -500, maxX: 500, maxZ: 500 },
    roads: [trunk, lane],
    graph: { nodes: [], edges: [] },
    buildings: [],
    water: [],
    parks: [],
    rail: [],
    waterways: [],
    landmarks: [],
    props: { poles: [], trees: [], hoardings: [], worship: [], autoStands: [], crossings: [], platforms: [], bumps: [1000, 0, 0, 35] },
    terrain: { file: 'terrain.bin', x0: -600, z0: -600, cell: 600, w: 3, h: 3, ref: 0 },
    airport: { runway: { x: 0, z: 0, len: 10, w: 10, heading: 0 }, terminal: { pts: [] } },
    spawn: { x: 0, z: 0, heading: 0 },
    meta: { osmBase: '', credit: '' },
  } as unknown as MapData;
}

let map: MapData;
let world: CollisionWorld;

beforeAll(() => {
  setTerrain(new Terrain({ file: 'terrain.bin', x0: -600, z0: -600, cell: 600, w: 3, h: 3, ref: 0 }, new Int16Array(9)));
  map = tinyMap();
  world = new CollisionWorld(map);
});

describe('borders', () => {
  it('gives the two-way trunk road a divider with a railing, with U-turn openings', () => {
    const b = bordersOf(map);
    expect(b.dividedRoads.has(0)).toBe(true);
    expect(b.medians.length).toBeGreaterThanOrEqual(2); // cut by the 300 m opening
    expect(b.medians.every((m) => !m.planter)).toBe(true);
    expect(b.breakables.filter((x) => x.kind === 'rail').length).toBeGreaterThan(100);
    expect(b.kerbs.length).toBeGreaterThan(2);
    expect(b.bumps).toHaveLength(1);
  });

  it('gives every breakable piece a fixed id in order', () => {
    bordersOf(map).breakables.forEach((x, i) => expect(x.id).toBe(i));
  });
});

describe('breaking and kerbs', () => {
  const rail = (): { id: number; x: number; z: number } => {
    const r = bordersOf(map).breakables.find((x) => x.kind === 'rail' && x.solid && Math.abs(x.z) < 100)!;
    return { id: r.id, x: r.x, z: r.z };
  };

  it('a slow car is stopped by a railing, a fast one breaks it, a bus breaks it at a lower speed', () => {
    const r = rail();
    const slow = world.collide(r.x + 0.5, r.z, 1, 0.3, { speed: 5, heavy: false });
    expect(slow.broke).toEqual([]);
    expect(slow.hit).toBe(true);
    const fast = world.collide(r.x + 0.5, r.z, 1, 0.3, { speed: 10, heavy: false });
    expect(fast.broke).toContain(r.id);
    // Over the kerb (25 km/h) but under a car's 30 km/h: a bus breaks it, a car does not.
    expect(world.collide(r.x + 0.5, r.z, 1, 0.3, { speed: 7.5, heavy: false }).broke).toEqual([]);
    expect(world.collide(r.x + 0.5, r.z, 1, 0.3, { speed: 7.5, heavy: true }).broke).toContain(r.id);
  });

  it('broken pieces stay open, are listed for joiners and are fixed after 2 minutes', () => {
    const r = rail();
    const now = 1_000_000;
    expect(world.breakPieces([r.id], FIX_MS, now)).toEqual([r.id]);
    expect(world.breakPieces([r.id], FIX_MS, now)).toEqual([]); // already broken
    expect(world.collide(r.x + 0.5, r.z, 1, 0.3, { speed: 3, heavy: false }).broke).toEqual([]);
    expect(world.openBreaks(now + 20000)).toEqual([[r.id, FIX_MS - 20000]]);
    world.updateBreaks(now + FIX_MS - 1);
    expect(world.broken[r.id]).toBe(1);
    world.updateBreaks(now + FIX_MS);
    expect(world.broken[r.id]).toBe(0);
    expect(world.drainChanges()).toEqual([r.id, r.id]);
  });

  it('kerbs stop slow vehicles but not fast ones or people on foot', () => {
    // The trunk road's right kerb is at x = -(7 + 0.125); come at it from the road.
    const x = -7.125 + 0.9;
    expect(world.collide(x, 50, 1, 0.3, { speed: 3, heavy: false }).hit).toBe(true);
    expect(world.collide(x, 50, 1, 0.3, { speed: 10, heavy: false }).hit).toBe(false);
    expect(world.collide(x, 50, 0.5, 0.3).hit).toBe(false);
  });

  it('a speed breaker raises the road in a smooth hump', () => {
    expect(world.heightAt(100, 0, 0)).toBeCloseTo(0.13, 2);
    expect(world.heightAt(100, 0.35, 0)).toBeGreaterThan(0.05);
    expect(world.heightAt(100, 0.35, 0)).toBeLessThan(0.13);
    expect(world.heightAt(100, 2, 0)).toBe(0);
  });
});
