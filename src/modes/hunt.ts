import { spawnPoint } from '../net/spawn';
import { shuffle } from '../util/rng';
import type { Claim, GameMode, RoundState, Target } from './types';

// Landmark hunt (TASKS G.4, H.11): a list of landmarks, one at a time. The first player
// to reach the current one gets a point, then everyone heads for the next.
// Challenges (H.11): at Raj Vihar you must first pass 3 checkpoints round the circle in
// order; at Konda Reddy Fort coming in through the marked gate on the approach road scores
// a bonus point.

const REACH_M = 30; // you are "there" within this distance (on your own screen)
const HOST_CHECK_M = 90; // the host accepts a claim if it sees you this close (lag)
const SKIP = new Set(['river']); // the river pin sits next to the bridge

const CP_M = 14; // checkpoint and gate size
const CP_RADIUS = 35; // checkpoints round Raj Vihar circle
const GATE_M = 100; // the fort gate this far out on the biggest road
const GATE_FRESH_MS = 60000;

type HuntTarget = Target & { id?: string; cps?: [number, number][]; gate?: [number, number] };

interface HuntData {
  targets: HuntTarget[];
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
// This player's challenge progress for the current target.
let progressFor = -1;
let cpDone = 0;
let gateAt = -Infinity;

function progress(idx: number): void {
  if (progressFor === idx) return;
  progressFor = idx;
  cpDone = 0;
  gateAt = -Infinity;
}

export const huntMode: GameMode = {
  id: 'hunt',
  name: 'Landmark hunt',
  blurb: 'Race to Kurnool landmarks one by one. First to arrive scores.',

  setup(players, mins, ctx) {
    // Shuffle, then skip targets right next to the one before.
    const pool = shuffle(ctx.map.landmarks.filter((l) => !SKIP.has(l.id)));
    const picked: HuntTarget[] = [];
    for (const l of pool) {
      if (picked.length >= targetCount(mins)) break;
      const last = picked[picked.length - 1];
      if (last && Math.hypot(l.x - last.x, l.z - last.z) < 400) continue;
      const t: HuntTarget = { x: l.x, z: l.z, label: l.nameEn, id: l.id };
      if (l.id === 'rajvihar' && ctx.roads) {
        // Three checkpoints on the roads round the circle.
        const cps: [number, number][] = [];
        for (let k = 0; k < 3; k++) {
          const a = (k * Math.PI * 2) / 3;
          const p = ctx.roads.nearest(l.x + Math.sin(a) * CP_RADIUS, l.z + Math.cos(a) * CP_RADIUS);
          if (p && !cps.some((c) => Math.hypot(c[0] - p.x, c[1] - p.z) < 15)) cps.push([p.x, p.z]);
        }
        if (cps.length === 3) t.cps = cps;
      }
      if (l.id === 'fort' && ctx.roads) {
        // The gate: on the biggest road about 100 m out.
        let best: { x: number; z: number; hw: number } | null = null;
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4;
          const p = ctx.roads.nearest(l.x + Math.sin(a) * GATE_M, l.z + Math.cos(a) * GATE_M, 40);
          if (p && (!best || p.hw > best.hw)) best = p;
        }
        if (best) t.gate = [best.x, best.z];
      }
      picked.push(t);
    }
    const scores: Record<string, number> = {};
    for (const id of players) scores[id] = 0;
    claimedIdx = -1;
    progressFor = -1;
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
    progress(d.idx);
    if (t.gate && Math.hypot(me.x - t.gate[0], me.z - t.gate[1]) < CP_M) gateAt = now;
    if (t.cps && cpDone < t.cps.length) {
      const cp = t.cps[cpDone];
      if (Math.hypot(me.x - cp[0], me.z - cp[1]) < CP_M) cpDone++;
      return;
    }
    if (claimedIdx === d.idx && now - claimedAt < 1500) return;
    if (Math.hypot(me.x - t.x, me.z - t.z) < REACH_M) {
      claimedIdx = d.idx;
      claimedAt = now;
      claim({ kind: 'reach', idx: d.idx, cps: !!t.cps, via: now - gateAt < GATE_FRESH_MS });
    }
  },

  claim(s, from, c: Claim, ctx) {
    if (c.kind !== 'reach') return false;
    const d = data(s);
    const t = d.targets[d.idx];
    if (!t || c.idx !== d.idx) return false; // someone else got there first
    if (t.cps && c.cps !== true) return false; // checkpoints first
    const p = ctx.posOf(from);
    if (!p || Math.hypot(p.x - t.x, p.z - t.z) > HOST_CHECK_M) return false;
    const points = 1 + (t.gate && c.via === true ? 1 : 0);
    // Everyone in the same vehicle arrives together and scores (task H.4).
    const driver = ctx.rideOf?.(from) ?? from;
    const crew = s.players.filter((id) => id === driver || id === from || (ctx.rideOf?.(id) ?? null) === driver);
    for (const id of crew) s.scores[id] = (s.scores[id] ?? 0) + points;
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
    const head = `${prefix}Target ${d.idx + 1}/${d.targets.length}: ${t.label}`;
    progress(d.idx);
    if (t.cps && cpDone < t.cps.length) {
      const cp = t.cps[cpDone];
      return { goal: `${head}. Challenge: pass the 3 checkpoints round the circle in order (${cpDone}/3)`, target: { x: cp[0], z: cp[1], label: `Checkpoint ${cpDone + 1}` }, beacon: true };
    }
    if (t.gate) {
      const through = performance.now() - gateAt < GATE_FRESH_MS;
      return { goal: `${head}. ${through ? 'Through the gate: bonus point when you arrive!' : 'Bonus point: come in through the blue ring on the approach road'}`, target: t, beacon: true, marker: through ? undefined : { x: t.gate[0], z: t.gate[1] } };
    }
    return { goal: head, target: t, beacon: true };
  },

  isPolice() {
    return false;
  },
};
