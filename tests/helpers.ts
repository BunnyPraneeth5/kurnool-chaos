import type { ModeCtx, RoundState } from '../src/modes/types';
import type { MapData } from '../src/map/types';

/** A round state for mode tests. */
export function state(over: Partial<RoundState> = {}): RoundState {
  return { round: 1, rev: 0, phase: 'playing', mode: 'chor', mins: 5, ready: [], players: [], scores: {}, roles: {}, data: {}, leftMs: 60000, elapsedMs: 0, ...over };
}

/** Mode context with players at fixed positions. */
export function ctx(pos: Record<string, { x: number; z: number }>, myId = 'a', map?: Partial<MapData>): ModeCtx {
  return {
    map: (map ?? { landmarks: [] }) as MapData,
    roads: null as never,
    myId,
    posOf: (id) => pos[id] ?? null,
    present: (id) => id in pos,
    slotOf: () => 0,
    nickOf: (id) => id,
  };
}
