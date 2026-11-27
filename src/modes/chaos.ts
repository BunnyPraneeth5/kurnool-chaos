import { spawnPoint } from '../net/spawn';
import type { Claim, GameMode, RoundState } from './types';

// Chaos (task H.10): a timed free-roam round with local cops on. Everyone earns chaos points
// (crashes, near misses, drifts, heat, escapes, red lights; busted loses some) and reports
// their own round points to the host every few seconds. Highest points wins. Friends' game:
// the host does not check the points.

const REPORT_MS = 3000;
const MAX_POINTS = 1_000_000;
let lastReport = 0;

export const chaosMode: GameMode = {
  id: 'chaos',
  name: 'Chaos',
  blurb: 'Make trouble: crash into traffic, near misses, drifts, keep the cops busy. Most chaos points wins; getting busted costs points.',

  setup(players) {
    const scores: Record<string, number> = {};
    for (const id of players) scores[id] = 0;
    lastReport = 0;
    return { roles: {}, scores, data: {} };
  },

  startSpot(id, _s, ctx) {
    return spawnPoint(ctx.map, ctx.roads, ctx.slotOf(id), 60);
  },

  holdMs() {
    return 0;
  },

  tick(_s, ctx, claim) {
    const now = performance.now();
    if (now - lastReport < REPORT_MS || !ctx.chaos) return;
    lastReport = now;
    claim({ kind: 'chaos', points: ctx.chaos() });
  },

  claim(s, from, c: Claim) {
    if (c.kind !== 'chaos' || typeof c.points !== 'number' || !Number.isFinite(c.points)) return false;
    const p = Math.max(0, Math.min(MAX_POINTS, Math.round(c.points)));
    if (s.scores[from] === p) return false;
    s.scores[from] = p;
    // Sent with the next regular update, not at once: keeps a full room under the message budget.
    return 'quiet';
  },

  done() {
    return false;
  },

  finish() {
    // Scores are the last points each player reported.
  },

  hud(s: RoundState, me, ctx) {
    let leader = '';
    let top = -1;
    for (const id of s.players) {
      const p = s.scores[id] ?? 0;
      if (p > top) {
        top = p;
        leader = id;
      }
    }
    const mine = ctx.chaos ? ctx.chaos() : (s.scores[me] ?? 0);
    const lead = leader && top > 0 ? ` · Leader: ${leader === me ? 'you' : ctx.nickOf(leader)} (${top})` : '';
    return { role: 'CHAOS', goal: `Your chaos: ${mine}${lead}` };
  },

  isPolice() {
    return false;
  },
};
