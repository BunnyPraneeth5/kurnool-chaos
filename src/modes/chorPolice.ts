import { spawnPoint } from '../net/spawn';
import type { Claim, GameMode, ModeCtx, RoundState, Target } from './types';

// Chor–Police (TASKS G.3): one police (two with 5+ players) chases the chors.
// Touching a chor catches them, and they join the police. Chors score one point
// per second they stay free; police score per catch. Police wait 10 s at the start.

const POLICE = 'police';
const CHOR = 'chor';
const CATCH_M = 4.5; // touching distance on the catcher's screen
const HOST_CHECK_M = 15; // the host accepts a catch if it sees them this close (lag)
const HEAD_START_MS = 10000;
const NEW_POLICE_WAIT_MS = 3000; // a fresh police cannot catch straight away
const CATCH_POINTS = 30;
const SURVIVE_BONUS = 60;
const CHOR_RING_M = 300;

interface ChorData {
  /** ms after Go when each player turned police (initial police: 0) */
  turnedAt: Record<string, number>;
  caughtBy: Record<string, string>;
  /** last catch, for the HUD */
  last?: { by: string; who: string };
}

function data(s: RoundState): ChorData {
  const d = s.data as Partial<ChorData>;
  return { turnedAt: d.turnedAt ?? {}, caughtBy: d.caughtBy ?? {}, last: d.last };
}

function nearest(ctx: ModeCtx, from: { x: number; z: number }, ids: string[]): { id: string; d: number; x: number; z: number } | null {
  let best: { id: string; d: number; x: number; z: number } | null = null;
  for (const id of ids) {
    const p = ctx.posOf(id);
    if (!p) continue;
    const d = Math.hypot(p.x - from.x, p.z - from.z);
    if (!best || d < best.d) best = { id, d, x: p.x, z: p.z };
  }
  return best;
}

const lastClaim = new Map<string, number>(); // target id -> when we last claimed them

export const chorPoliceMode: GameMode = {
  id: 'chor',
  name: 'Chor–Police',
  blurb: 'Police chase the chors. Touch a chor to catch them; they join the police.',

  setup(players) {
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    const nPolice = players.length >= 5 ? 2 : 1;
    const roles: Record<string, string> = {};
    const turnedAt: Record<string, number> = {};
    const scores: Record<string, number> = {};
    shuffled.forEach((id, i) => {
      roles[id] = i < nPolice ? POLICE : CHOR;
      if (i < nPolice) turnedAt[id] = 0;
      scores[id] = 0;
    });
    lastClaim.clear();
    return { roles, scores, data: { turnedAt, caughtBy: {} } satisfies ChorData as unknown as Record<string, unknown> };
  },

  startSpot(id, s, ctx) {
    lastClaim.clear();
    // Police start near the lobby, chors spread out further away.
    return spawnPoint(ctx.map, ctx.roads, ctx.slotOf(id), s.roles[id] === POLICE ? 45 : CHOR_RING_M);
  },

  holdMs(id, s) {
    return s.roles[id] === POLICE && data(s).turnedAt[id] === 0 ? HEAD_START_MS : 0;
  },

  tick(s, ctx, claim) {
    const me = ctx.myId;
    if (s.roles[me] !== POLICE) return;
    const d = data(s);
    const turned = d.turnedAt[me] ?? 0;
    if (turned > 0 && s.elapsedMs - turned < NEW_POLICE_WAIT_MS) return;
    const pos = ctx.posOf(me);
    if (!pos) return;
    const now = performance.now();
    for (const id of s.players) {
      if (s.roles[id] !== CHOR || !ctx.present(id)) continue;
      const p = ctx.posOf(id);
      if (!p || Math.hypot(p.x - pos.x, p.z - pos.z) > CATCH_M) continue;
      if (now - (lastClaim.get(id) ?? 0) < 1000) continue;
      lastClaim.set(id, now);
      claim({ kind: 'catch', target: id });
    }
  },

  claim(s, from, c: Claim, ctx) {
    if (c.kind !== 'catch' || typeof c.target !== 'string') return false;
    const target = c.target;
    if (s.roles[from] !== POLICE || s.roles[target] !== CHOR || !ctx.present(target)) return false;
    const d = data(s);
    const t = s.elapsedMs;
    const turned = d.turnedAt[from] ?? 0;
    if (turned === 0 && t < HEAD_START_MS) return false;
    if (turned > 0 && t - turned < NEW_POLICE_WAIT_MS) return false;
    const a = ctx.posOf(from);
    const b = ctx.posOf(target);
    if (!a || !b || Math.hypot(a.x - b.x, a.z - b.z) > HOST_CHECK_M) return false;
    s.roles[target] = POLICE;
    s.scores[target] = (s.scores[target] ?? 0) + Math.floor(t / 1000);
    s.scores[from] = (s.scores[from] ?? 0) + CATCH_POINTS;
    s.data = { ...d, turnedAt: { ...d.turnedAt, [target]: Math.max(1, t) }, caughtBy: { ...d.caughtBy, [target]: from }, last: { by: from, who: target } };
    return true;
  },

  done(s, ctx) {
    const present = s.players.filter((id) => ctx.present(id));
    return !present.some((id) => s.roles[id] === CHOR) || !present.some((id) => s.roles[id] === POLICE);
  },

  finish(s) {
    // Chors still free survive the whole round, plus a bonus.
    for (const id of s.players) {
      if (s.roles[id] === CHOR) s.scores[id] = (s.scores[id] ?? 0) + Math.floor(s.elapsedMs / 1000) + SURVIVE_BONUS;
    }
  },

  hud(s, me, ctx, nowElapsed) {
    const d = data(s);
    const news = d.last ? `${ctx.nickOf(d.last.by)} caught ${ctx.nickOf(d.last.who)}. ` : '';
    const chors = s.players.filter((id) => s.roles[id] === CHOR && ctx.present(id));
    const pos = ctx.posOf(me);
    if (!s.players.includes(me)) return { goal: `${news}${chors.length} chor${chors.length === 1 ? '' : 's'} still free` };
    if (s.roles[me] === POLICE) {
      const wait = (d.turnedAt[me] ?? 0) === 0 ? HEAD_START_MS - nowElapsed : 0;
      const n = pos ? nearest(ctx, pos, chors) : null;
      const target: Target | undefined = n ? { x: n.x, z: n.z, label: ctx.nickOf(n.id) } : undefined;
      return {
        role: 'You are POLICE',
        goal: wait > 0 ? `Chors are hiding… you can go in ${Math.ceil(wait / 1000)} s` : `${news}Catch the chors (${chors.length} left): touch them`,
        target: wait > 0 ? undefined : target,
      };
    }
    const police = s.players.filter((id) => s.roles[id] === POLICE && ctx.present(id));
    const n = pos ? nearest(ctx, pos, police) : null;
    return { role: 'You are a CHOR', goal: `${news}Don't get caught.${n ? ` Nearest police ${Math.round(n.d)} m` : ''}` };
  },

  isPolice(s, id) {
    return s.roles[id] === POLICE && (s.phase === 'countdown' || s.phase === 'playing');
  },
};
