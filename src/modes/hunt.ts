import { spawnPoint } from '../net/spawn';
import { shuffle } from '../util/rng';
import type { Claim, GameMode, RoundState, Target } from './types';

// Landmark hunt (TASKS G.4): a list of landmarks, one at a time. The first player
// to reach the current one gets a point, then everyone heads for the next.

const REACH_M = 30; // you are "there" within this distance (on your own screen)
const HOST_CHECK_M = 90; // the host accepts a claim if it sees you this close (lag)
const SKIP = new Set(['river']); // the river pin sits next to the bridge

interface HuntData {
  targets: Target[];
  idx: number;
  /** who reached each target */
  winners: string[];
}

function data(s: RoundState): HuntData {
  const d = s.data as Partial<HuntData>;
  return { targets: Array.isArray(d.targets) ? d.targets : [], idx: typeof d.idx === 'number' ? d.idx : 0, winners: Array.isArray(d.winners) ? d.winners : [] };
}

function targetCount(mins: number): number {
  return mins <= 3 ? 3 : mins <= 5 ? 4 : 5;
}

// This player's last claim: resent every 1.5 s while still there, in case it got lost.
let claimedIdx = -1;
let claimedAt = 0;

export const huntMode: GameMode = {
  id: 'hunt',
  name: 'Landmark hunt',
  blurb: 'Race to Kurnool landmarks one by one. First to arrive scores.',

  setup(players, mins, ctx) {
    // Shuffle, then skip targets right next to the one before.
    const pool = shuffle(ctx.map.landmarks.filter((l) => !SKIP.has(l.id)));
    const picked: Target[] = [];
    for (const l of pool) {
      if (picked.length >= targetCount(mins)) break;
      const last = picked[picked.length - 1];
      if (last && Math.hypot(l.x - last.x, l.z - last.z) < 400) continue;
      picked.push({ x: l.x, z: l.z, label: l.nameEn });
    }
    const scores: Record<string, number> = {};
    for (const id of players) scores[id] = 0;
    claimedIdx = -1;
    return { roles: {}, scores, data: { targets: picked, idx: 0, winners: [] } satisfies HuntData as unknown as Record<string, unknown> };
  },

  startSpot(id, _s, ctx) {
    claimedIdx = -1;
    return spawnPoint(ctx.map, ctx.roads, ctx.slotOf(id));
  },

  holdMs() {
    return 0;
  },

  tick(s, ctx, claim) {
    const d = data(s);
    const t = d.targets[d.idx];
    const me = ctx.posOf(ctx.myId);
    if (!t || !me) return;
    const now = performance.now();
    if (claimedIdx === d.idx && now - claimedAt < 1500) return;
    if (Math.hypot(me.x - t.x, me.z - t.z) < REACH_M) {
      claimedIdx = d.idx;
      claimedAt = now;
      claim({ kind: 'reach', idx: d.idx });
    }
  },

  claim(s, from, c: Claim, ctx) {
    if (c.kind !== 'reach') return false;
    const d = data(s);
    const t = d.targets[d.idx];
    if (!t || c.idx !== d.idx) return false; // someone else got there first
    const p = ctx.posOf(from);
    if (!p || Math.hypot(p.x - t.x, p.z - t.z) > HOST_CHECK_M) return false;
    s.scores[from] = (s.scores[from] ?? 0) + 1;
    s.data = { ...d, idx: d.idx + 1, winners: [...d.winners, from] };
    return true;
  },

  done(s) {
    const d = data(s);
    return d.targets.length > 0 && d.idx >= d.targets.length;
  },

  finish() {
    // Points are given as landmarks are reached.
  },

  hud(s, _me, ctx) {
    const d = data(s);
    const t = d.targets[d.idx];
    const lastWinner = d.winners[d.winners.length - 1];
    const prefix = lastWinner ? `${ctx.nickOf(lastWinner)} got ${d.targets[d.idx - 1]?.label}. ` : '';
    if (!t) return { goal: `${prefix}All landmarks found!` };
    return { goal: `${prefix}Target ${d.idx + 1}/${d.targets.length}: ${t.label}`, target: t, beacon: true };
  },

  isPolice() {
    return false;
  },
};
