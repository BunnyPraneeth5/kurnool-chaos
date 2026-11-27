import type { Pt } from '../map/types';
import { groundY } from '../map/terrain';
import type { RoadGraph } from '../ai/graph';
import type { Claim, GameMode, RoundState, Spot } from './types';

// Hill climb (task H.11): everyone starts in a line on the road at the foot of Jagannatha
// Gattu; first to the summit plaza wins. Finish times are kept; points by place.

const FINISH_M = 25; // reach the plaza
const HOST_CHECK_M = 60;
const FOOT_DROP_M = 115; // the start is this far below the summit
const START_GAP_M = 9;
const PLACE_POINTS = [10, 7, 5, 3, 2, 1, 1, 1];

export interface ClimbCourse {
  starts: Spot[];
  finish: { x: number; z: number };
  /** metres of road from the start to the summit */
  length: number;
}

/**
 * The course: the road route from the summit towards Raj Vihar, cut where the ground is
 * 115 m below the summit; the start line runs back down the road from there.
 * Null if the summit has no road route to the city.
 */
export function climbCourse(graph: RoadGraph, summit: { x: number; z: number; y: number }, city: { x: number; z: number }): ClimbCourse | null {
  const a = graph.nearest(summit.x, summit.z, 300);
  const b = graph.nearest(city.x, city.z, 300);
  if (!a || !b) return null;
  const path = graph.path(a, b, 20000);
  if (!path || path.length < 2) return null;
  // Walk down from the summit until the ground is low enough.
  let foot = -1;
  let along = 0;
  for (let i = 1; i < path.length; i++) {
    along += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    if (groundY(path[i][0], path[i][1]) < summit.y - FOOT_DROP_M) {
      foot = i;
      break;
    }
  }
  if (foot < 0) return null;
  // Start spots: from the foot, further down the road, facing up the hill.
  const down: Pt[] = path.slice(foot);
  const starts: Spot[] = [];
  let need = 0;
  let i = 1;
  let acc = 0;
  while (starts.length < 8 && i < down.length) {
    const [x0, z0] = down[i - 1];
    const [x1, z1] = down[i];
    const seg = Math.hypot(x1 - x0, z1 - z0);
    if (acc + seg >= need) {
      const f = (need - acc) / seg;
      const x = x0 + (x1 - x0) * f;
      const z = z0 + (z1 - z0) * f;
      starts.push({ x, z, heading: Math.atan2(x0 - x1, z0 - z1) }); // facing back up the road
      need += START_GAP_M;
      continue;
    }
    acc += seg;
    i++;
  }
  if (starts.length < 8) return null;
  return { starts, finish: { x: summit.x, z: summit.z }, length: Math.round(along) };
}

interface ClimbData {
  /** ms after Go each player reached the summit */
  times: Record<string, number>;
}

function data(s: RoundState): ClimbData {
  const d = s.data as Partial<ClimbData>;
  return { times: d.times ?? {} };
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

let claimedAt = 0;

/** The Hill climb mode for a course (unavailable without one). */
export function climbMode(course: ClimbCourse | null): GameMode {
  return {
    id: 'climb',
    name: 'Hill climb',
    blurb: course
      ? `Race from the foot of Jagannatha Gattu up ${(course.length / 1000).toFixed(1)} km of road to the summit. First up wins.`
      : 'Not available: no road route found up Jagannatha Gattu.',
    available: !!course,

    setup(players) {
      const scores: Record<string, number> = {};
      for (const id of players) scores[id] = 0;
      claimedAt = 0;
      return { roles: {}, scores, data: { times: {} } satisfies ClimbData as unknown as Record<string, unknown> };
    },

    startSpot(id, _s, ctx) {
      if (!course) throw new Error('Hill climb has no course');
      claimedAt = 0;
      return course.starts[ctx.slotOf(id) % course.starts.length];
    },

    holdMs() {
      return 0;
    },

    tick(s, ctx, claim) {
      if (!course || data(s).times[ctx.myId] !== undefined) return;
      const me = ctx.posOf(ctx.myId);
      const now = performance.now();
      if (!me || now - claimedAt < 1500) return;
      if (Math.hypot(me.x - course.finish.x, me.z - course.finish.z) < FINISH_M) {
        claimedAt = now;
        claim({ kind: 'finish' });
      }
    },

    claim(s, from, c: Claim, ctx) {
      if (!course || c.kind !== 'finish') return false;
      const d = data(s);
      if (d.times[from] !== undefined) return false;
      const p = ctx.posOf(from);
      if (!p || Math.hypot(p.x - course.finish.x, p.z - course.finish.z) > HOST_CHECK_M) return false;
      // Riders arrive with their driver.
      const driver = ctx.rideOf?.(from) ?? from;
      const crew = s.players.filter((id) => (id === from || id === driver || ctx.rideOf?.(id) === driver) && d.times[id] === undefined);
      const times = { ...d.times };
      const place = Object.keys(times).length;
      for (const id of crew) {
        times[id] = s.elapsedMs;
        s.scores[id] = (s.scores[id] ?? 0) + (PLACE_POINTS[place] ?? 1);
      }
      s.data = { times } satisfies ClimbData as unknown as Record<string, unknown>;
      return true;
    },

    done(s, ctx) {
      const d = data(s);
      const present = s.players.filter((id) => ctx.present(id));
      return present.length > 0 && present.every((id) => d.times[id] !== undefined);
    },

    finish() {
      // Not up in time: no points.
    },

    hud(s, me, ctx) {
      const d = data(s);
      const done = Object.entries(d.times).sort((p, q) => p[1] - q[1]);
      const board = done.map(([id, t]) => `${id === me ? 'you' : ctx.nickOf(id)} ${clock(t)}`).join(', ');
      const mine = d.times[me];
      if (mine !== undefined) {
        const place = done.findIndex(([id]) => id === me) + 1;
        return { role: `Summit! ${clock(mine)}`, goal: `Place ${place}. ${board}` };
      }
      if (!course) return { goal: 'No course' };
      return { role: 'HILL CLIMB', goal: `Climb to the summit${board ? ` · up: ${board}` : ''}`, target: { x: course.finish.x, z: course.finish.z, label: 'Summit' }, beacon: true };
    },

    isPolice() {
      return false;
    },
  };
}
