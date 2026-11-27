import { spawnPoint } from '../net/spawn';
import { shuffle } from '../util/rng';
import type { Claim, GameMode, ModeCtx, RoundState, Target } from './types';

// Chor–Police (TASKS G.3, H.11): one police (two with 5+ players) chases the chors.
// Touching a chor catches them, and they join the police. Chors score one point per second
// they stay free; police score per catch. Police wait 10 s at the start.
// H.11: police see the chors only as radar pings every 12 s (or live when close); everyone
// has 2 boosts; a chor who gets away from close police scores a bonus; when one chor is left
// everyone is told and the last chor's survival points count double.

const POLICE = 'police';
const CHOR = 'chor';
const CATCH_M = 4.5; // touching distance on the catcher's screen
const HOST_CHECK_M = 15; // the host accepts a catch if it sees them this close (lag)
const HEAD_START_MS = 10000;
const NEW_POLICE_WAIT_MS = 3000; // a fresh police cannot catch straight away
const CATCH_POINTS = 30;
const SURVIVE_BONUS = 60;
const CHOR_RING_M = 300;
export const PING_MS = 12000;
const SEE_M = 50; // police see a chor live this close
const CLOSE_M = 15; // a close call for a chor...
const AWAY_M = 60; // ...then getting this far from every police is an escape
const ESCAPE_POINTS = 15;
const ESCAPE_GAP_MS = 20000;
export const BOOSTS = 2;

interface ChorData {
  /** ms after Go when each player turned police (initial police: 0) */
  turnedAt: Record<string, number>;
  caughtBy: Record<string, string>;
  /** last catch, for the HUD */
  last?: { by: string; who: string };
  /** ms after Go of each chor's last escape bonus */
  escapes?: Record<string, number>;
  /** the last chor left, once there is only one */
  lastChor?: string;
}

function data(s: RoundState): ChorData {
  const d = s.data as Partial<ChorData>;
  return { turnedAt: d.turnedAt ?? {}, caughtBy: d.caughtBy ?? {}, last: d.last, escapes: d.escapes ?? {}, lastChor: d.lastChor };
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
// This player's radar ping and close-call memory (each screen keeps its own).
let ping: { idx: number; id: string; x: number; z: number } | null = null;
let closeCall = false;
let lastEscapeClaim = 0;

function resetLocal(): void {
  lastClaim.clear();
  ping = null;
  closeCall = false;
  lastEscapeClaim = 0;
}

export const chorPoliceMode: GameMode = {
  id: 'chor',
  name: 'Chor–Police',
  blurb: 'Police chase the chors, seeing them only on a radar ping every 12 s. Touch a chor to catch them; they join the police. Everyone has 2 boosts (B).',

  setup(players) {
    const shuffled = shuffle(players);
    const nPolice = players.length >= 5 ? 2 : 1;
    const roles: Record<string, string> = {};
    const turnedAt: Record<string, number> = {};
    const scores: Record<string, number> = {};
    shuffled.forEach((id, i) => {
      roles[id] = i < nPolice ? POLICE : CHOR;
      if (i < nPolice) turnedAt[id] = 0;
      scores[id] = 0;
    });
    resetLocal();
    return { roles, scores, data: { turnedAt, caughtBy: {}, escapes: {} } satisfies ChorData as unknown as Record<string, unknown> };
  },

  startSpot(id, s, ctx) {
    resetLocal();
    // Police start near the lobby, chors spread out further away.
    return spawnPoint(ctx.map, ctx.roads, ctx.slotOf(id), s.roles[id] === POLICE ? 45 : CHOR_RING_M);
  },

  holdMs(id, s) {
    return s.roles[id] === POLICE && data(s).turnedAt[id] === 0 ? HEAD_START_MS : 0;
  },

  tick(s, ctx, claim) {
    const me = ctx.myId;
    const pos = ctx.posOf(me);
    if (!pos) return;
    const d = data(s);
    const now = performance.now();
    if (s.roles[me] === CHOR) {
      // A close call, then getting well away from every police: claim an escape.
      const police = s.players.filter((id) => s.roles[id] === POLICE && ctx.present(id));
      const n = nearest(ctx, pos, police);
      if (!n) return;
      if (n.d < CLOSE_M) closeCall = true;
      else if (closeCall && n.d > AWAY_M && now - lastEscapeClaim > 2000) {
        closeCall = false;
        lastEscapeClaim = now;
        claim({ kind: 'escape' });
      }
      return;
    }
    if (s.roles[me] !== POLICE) return;
    const turned = d.turnedAt[me] ?? 0;
    if (turned > 0 && s.elapsedMs - turned < NEW_POLICE_WAIT_MS) return;
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
    const d = data(s);
    const t = s.elapsedMs;
    if (c.kind === 'escape') {
      if (s.roles[from] !== CHOR || !ctx.present(from)) return false;
      if (t - (d.escapes?.[from] ?? -Infinity) < ESCAPE_GAP_MS) return false;
      // The host should also see them clear of the police (lenient: lag).
      const at = ctx.posOf(from);
      const police = s.players.filter((id) => s.roles[id] === POLICE);
      const n = at ? nearest(ctx, at, police) : null;
      if (n && n.d < AWAY_M * 0.6) return false;
      s.scores[from] = (s.scores[from] ?? 0) + ESCAPE_POINTS;
      s.data = { ...d, escapes: { ...d.escapes, [from]: t } };
      return true;
    }
    if (c.kind !== 'catch' || typeof c.target !== 'string') return false;
    const target = c.target;
    if (s.roles[from] !== POLICE || s.roles[target] !== CHOR || !ctx.present(target)) return false;
    const turned = d.turnedAt[from] ?? 0;
    if (turned === 0 && t < HEAD_START_MS) return false;
    if (turned > 0 && t - turned < NEW_POLICE_WAIT_MS) return false;
    const a = ctx.posOf(from);
    const b = ctx.posOf(target);
    if (!a || !b || Math.hypot(a.x - b.x, a.z - b.z) > HOST_CHECK_M) return false;
    s.roles[target] = POLICE;
    const survived = Math.floor(t / 1000);
    s.scores[target] = (s.scores[target] ?? 0) + (target === d.lastChor ? survived * 2 : survived);
    s.scores[from] = (s.scores[from] ?? 0) + CATCH_POINTS;
    const next: ChorData = { ...d, turnedAt: { ...d.turnedAt, [target]: Math.max(1, t) }, caughtBy: { ...d.caughtBy, [target]: from }, last: { by: from, who: target } };
    // One chor left: everyone is told, and their survival counts double.
    const left = s.players.filter((id) => s.roles[id] === CHOR && ctx.present(id));
    if (left.length === 1 && !next.lastChor) next.lastChor = left[0];
    s.data = next as unknown as Record<string, unknown>;
    return true;
  },

  done(s, ctx) {
    const present = s.players.filter((id) => ctx.present(id));
    return !present.some((id) => s.roles[id] === CHOR) || !present.some((id) => s.roles[id] === POLICE);
  },

  finish(s) {
    // Chors still free survive the whole round, plus a bonus; the last chor's survival counts double.
    const d = data(s);
    for (const id of s.players) {
      if (s.roles[id] !== CHOR) continue;
      const survived = Math.floor(s.elapsedMs / 1000);
      s.scores[id] = (s.scores[id] ?? 0) + (id === d.lastChor ? survived * 2 : survived) + SURVIVE_BONUS;
    }
  },

  hud(s, me, ctx, nowElapsed) {
    const d = data(s);
    const news = d.lastChor && s.roles[d.lastChor] === CHOR ? `Only ${d.lastChor === me ? 'YOU are' : `${ctx.nickOf(d.lastChor)} is`} left! ` : d.last ? `${ctx.nickOf(d.last.by)} caught ${ctx.nickOf(d.last.who)}. ` : '';
    const chors = s.players.filter((id) => s.roles[id] === CHOR && ctx.present(id));
    const pos = ctx.posOf(me);
    if (!s.players.includes(me)) return { goal: `${news}${chors.length} chor${chors.length === 1 ? '' : 's'} still free` };
    if (s.roles[me] === POLICE) {
      const wait = (d.turnedAt[me] ?? 0) === 0 ? HEAD_START_MS - nowElapsed : 0;
      if (wait > 0) return { role: 'You are POLICE', goal: `Chors are hiding… you can go in ${Math.ceil(wait / 1000)} s` };
      const live = pos ? nearest(ctx, pos, chors) : null;
      // Close enough to see: live. Otherwise the last radar ping (every 12 s).
      if (live && live.d < SEE_M) return { role: 'You are POLICE', goal: `${news}${ctx.nickOf(live.id)} is right there: touch them!`, target: { x: live.x, z: live.z, label: ctx.nickOf(live.id) } };
      const idx = Math.floor(nowElapsed / PING_MS);
      if (pos && (!ping || ping.idx !== idx || !chors.includes(ping.id))) {
        ping = live ? { idx, id: live.id, x: live.x, z: live.z } : null;
      }
      const nextIn = Math.ceil((PING_MS - (nowElapsed % PING_MS)) / 1000);
      const target: Target | undefined = ping ? { x: ping.x, z: ping.z, label: `${ctx.nickOf(ping.id)} (last ping)` } : undefined;
      return { role: 'You are POLICE', goal: `${news}Radar: ${ping ? `${ctx.nickOf(ping.id)} was seen here` : 'no chors'} · next ping in ${nextIn} s (${chors.length} left)`, target };
    }
    const police = s.players.filter((id) => s.roles[id] === POLICE && ctx.present(id));
    const n = pos ? nearest(ctx, pos, police) : null;
    return { role: 'You are a CHOR', goal: `${news}Don't get caught: the police get a radar ping on you every 12 s.${n ? ` Nearest police ${Math.round(n.d)} m` : ''}` };
  },

  isPolice(s, id) {
    return s.roles[id] === POLICE && (s.phase === 'countdown' || s.phase === 'playing');
  },
};
