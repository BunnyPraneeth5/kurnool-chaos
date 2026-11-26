import { VEHICLE_TYPES, type VehicleType } from '../vehicles/params';

// Send rate and interpolation of remote players (ARCHITECTURE: Multiplayer).
//
// Message budget: on the Supabase free plan one broadcast costs 1 message plus 1 per
// player who receives it, so N players all moving at f Hz use f * N^2 messages per
// second. The plan allows 100/s; we aim for 80 to leave room for presence and
// heartbeats. That gives 5 Hz up to 4 players, then slower (1.25 Hz with 8).

export const MAX_HZ = 5;
export const MSG_BUDGET = 80;
export const HEARTBEAT_MS = 2000;
/** Remote players with no message for this long are hidden. */
export const STALE_MS = 5000;
/** Extra delay on top of one send interval, to absorb network jitter. */
const JITTER_MS = 100;
/** How far past the newest snapshot we keep moving a remote player. */
const MAX_EXTRAPOLATE_MS = 300;
/** A jump bigger than this between snapshots is a teleport (unstuck), not driving. */
const TELEPORT_M = 40;
const KEEP_MS = 4000;

export function sendHz(players: number): number {
  if (players <= 1) return 0; // nobody to send to
  return Math.min(MAX_HZ, MSG_BUDGET / (players * players));
}

/** How far in the past remote players are drawn: one send interval plus jitter. */
export function interpDelayMs(players: number): number {
  const hz = sendHz(Math.max(2, players));
  return 1000 / hz + JITTER_MS;
}

export type Mode = 'foot' | VehicleType;

/** Broadcast event `s`. t is the sender's own clock in ms; only differences matter. */
export interface NetState {
  id: string;
  t: number;
  x: number;
  z: number;
  y: number;
  h: number;
  v: number;
  mode: Mode;
  /**
   * index of the parked vehicle being driven (same spots on every screen), -2 for any
   * other vehicle (one taken from your own traffic), -1 on foot
   */
  car: number;
}

export interface Pose {
  x: number;
  z: number;
  y: number;
  h: number;
  v: number;
  mode: Mode;
  car: number;
}

function angLerp(a: number, b: number, f: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
}

/**
 * Snapshots of one remote player. Sender timestamps are mapped onto our clock with
 * an offset learned from local receive times (the fastest message seen, creeping up
 * slowly), so jitter and 2 s idle gaps do not make players jump.
 */
export class SnapshotBuffer {
  private readonly snaps: NetState[] = [];
  private offset = Number.POSITIVE_INFINITY;
  private late = 0;
  lastRecv = 0;

  push(s: NetState, recvMs: number): void {
    const last = this.snaps[this.snaps.length - 1];
    if (last && s.t <= last.t) return; // duplicate or out of order
    const o = recvMs - s.t;
    if (o < this.offset) this.offset = o;
    else this.offset += (o - this.offset) * 0.005;
    // Several messages in a row over a second "late": a clock jumped (phone slept,
    // our page was frozen). Start over from the current delay.
    this.late = o - this.offset > 1000 ? this.late + 1 : 0;
    if (this.late >= 3) {
      this.offset = o;
      this.late = 0;
    }
    this.lastRecv = recvMs;
    this.snaps.push(s);
    const cutoff = s.t - KEEP_MS;
    while (this.snaps.length > 2 && this.snaps[1].t < cutoff) this.snaps.shift();
  }

  get size(): number {
    return this.snaps.length;
  }

  clear(): void {
    this.snaps.length = 0;
    this.offset = Number.POSITIVE_INFINITY;
  }

  /** Pose to draw at local time `nowMs`, `delayMs` in the past. Null before any snapshot. */
  sample(nowMs: number, delayMs: number): Pose | null {
    const n = this.snaps.length;
    if (n === 0) return null;
    const target = nowMs - this.offset - delayMs; // in sender time
    const first = this.snaps[0];
    if (target <= first.t) return { ...first };
    const last = this.snaps[n - 1];
    if (target >= last.t) {
      const dt = Math.min(target - last.t, MAX_EXTRAPOLATE_MS) / 1000;
      return {
        x: last.x + Math.sin(last.h) * last.v * dt,
        z: last.z + Math.cos(last.h) * last.v * dt,
        y: last.y,
        h: last.h,
        v: last.v,
        mode: last.mode,
        car: last.car,
      };
    }
    let i = n - 2;
    while (i > 0 && this.snaps[i].t > target) i--;
    const a = this.snaps[i];
    const b = this.snaps[i + 1];
    const f = (target - a.t) / (b.t - a.t);
    if (Math.hypot(b.x - a.x, b.z - a.z) > TELEPORT_M || a.mode !== b.mode || a.car !== b.car) {
      return { ...(f < 0.5 ? a : b) };
    }
    return {
      x: a.x + (b.x - a.x) * f,
      z: a.z + (b.z - a.z) * f,
      y: a.y + (b.y - a.y) * f,
      h: angLerp(a.h, b.h, f),
      v: a.v + (b.v - a.v) * f,
      mode: a.mode,
      car: a.car,
    };
  }
}

/** Validates an incoming broadcast payload; anything malformed is ignored. */
export function parseState(p: unknown): NetState | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const num = (k: string): number | null => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : null);
  const t = num('t'), x = num('x'), z = num('z'), y = num('y'), h = num('h'), v = num('v');
  if (typeof o.id !== 'string' || t === null || x === null || z === null || y === null || h === null || v === null) return null;
  const mode = o.mode === 'foot' ? 'foot' : VEHICLE_TYPES.find((t) => t === o.mode);
  if (!mode) return null;
  if (Math.abs(x) > 1e5 || Math.abs(z) > 1e5 || Math.abs(y) > 1e3 || Math.abs(v) > 200) return null;
  const car = typeof o.car === 'number' && Number.isInteger(o.car) && o.car >= 0 && o.car < 64 ? o.car : -2;
  return { id: o.id.slice(0, 32), t, x, z, y, h, v, mode, car: mode === 'foot' ? -1 : car };
}
