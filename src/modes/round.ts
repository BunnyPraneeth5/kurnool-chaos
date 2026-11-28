import type { Game } from '../game';
import type { Room } from '../net/room';
import type { Claim, GameMode, ModeCtx, ModeId, Phase, RoundState, Spot } from './types';
import { ROUND_MINUTES } from './types';

// Round flow (TASKS G.2): lobby -> countdown -> playing -> results -> lobby.
// The host's game is the referee: it starts rounds, checks claims (a catch, a
// landmark reached), keeps the score and broadcasts the whole state (event `g`).
// Everyone else shows it and moves themselves to their start spot. If the host
// leaves, the next host carries on from the last state it received.

export const COUNTDOWN_MS = 3500; // "3, 2, 1" then Go
export const RESULTS_MS = 10000;
const KEEPALIVE_MS = 4000;
const PHASES: readonly Phase[] = ['lobby', 'countdown', 'playing', 'results'];

function freshState(): RoundState {
  return { round: 0, rev: 0, phase: 'lobby', mode: 'chor', mins: 5, ready: [], players: [], scores: {}, roles: {}, data: {}, leftMs: 0, elapsedMs: 0 };
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 16) : [];
}

function numRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') for (const [k, n] of Object.entries(v)) if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
  return out;
}

function strRecord(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === 'object') for (const [k, n] of Object.entries(v)) if (typeof n === 'string') out[k] = n;
  return out;
}

/** Validates a received round state; null if it is not one. */
export function parseRound(v: unknown, modes: Record<ModeId, GameMode>): RoundState | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const num = (k: string): number => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : NaN);
  const round = num('round'), rev = num('rev'), mins = num('mins'), leftMs = num('leftMs'), elapsedMs = num('elapsedMs');
  if ([round, rev, mins, leftMs, elapsedMs].some(Number.isNaN)) return null;
  if (!PHASES.includes(o.phase as Phase) || typeof o.mode !== 'string' || !(o.mode in modes)) return null;
  return {
    round,
    rev,
    phase: o.phase as Phase,
    mode: o.mode as ModeId,
    mins: (ROUND_MINUTES as readonly number[]).includes(mins) ? mins : 5,
    ready: strArray(o.ready),
    players: strArray(o.players),
    scores: numRecord(o.scores),
    roles: strRecord(o.roles),
    data: o.data && typeof o.data === 'object' ? (o.data as Record<string, unknown>) : {},
    leftMs: Math.max(0, Math.min(leftMs, 60 * 60 * 1000)),
    elapsedMs: Math.max(0, elapsedMs),
  };
}

export class RoundController {
  state: RoundState = freshState();
  /** Called whenever the state changes (UI refresh). */
  onChange: () => void = () => {};
  /** Called when a round ends, with the final state. */
  onResults: (s: RoundState) => void = () => {};
  private phaseEndAt = 0; // local performance.now() when this phase ends
  private goAt = 0; // local performance.now() of Go
  private lastSent = -Infinity;
  private hiddenWall = 0;
  private hiddenPerf = 0;

  constructor(
    private readonly room: Room,
    private readonly game: Game,
    readonly ctx: ModeCtx,
    readonly modes: Record<ModeId, GameMode>,
    private readonly lobbySpot: (id: string) => Spot,
  ) {
    // Some phone browsers stop performance.now() while the phone sleeps, which would
    // leave our round timers behind. On wake, move them on by the time that went missing
    // and ask the host for the current state.
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.hiddenWall = Date.now();
        this.hiddenPerf = performance.now();
      } else if (this.hiddenWall) {
        this.resume(Date.now() - this.hiddenWall - (performance.now() - this.hiddenPerf));
        this.hiddenWall = 0;
      }
    });
  }

  /** Back from sleep: `lostMs` went by that performance.now() did not count. */
  resume(lostMs: number): void {
    if (lostMs > 250) {
      this.phaseEndAt -= lostMs;
      this.goAt -= lostMs;
    }
    if (this.isHost) this.broadcast();
    else this.room.sendGame({ k: 'sync' });
  }

  get mode(): GameMode {
    return this.modes[this.state.mode];
  }

  get isHost(): boolean {
    return this.room.isHost;
  }

  /** Am I in the current round (countdown or playing)? */
  get inRound(): boolean {
    const p = this.state.phase;
    return (p === 'countdown' || p === 'playing') && this.state.players.includes(this.room.myId);
  }

  leftMs(now = performance.now()): number {
    return Math.max(0, this.phaseEndAt - now);
  }

  elapsedMs(now = performance.now()): number {
    return this.state.phase === 'playing' ? Math.max(0, now - this.goAt) : 0;
  }

  // --- host actions ---

  setMode(mode: ModeId): void {
    if (!this.isHost || this.state.phase !== 'lobby' || !(mode in this.modes) || this.modes[mode].available === false) return;
    this.commit({ ...this.state, mode });
  }

  setMins(mins: number): void {
    if (!this.isHost || this.state.phase !== 'lobby' || !(ROUND_MINUTES as readonly number[]).includes(mins)) return;
    this.commit({ ...this.state, mins });
  }

  /** Host: start a round with everyone in the room. */
  start(): boolean {
    if (!this.isHost || this.state.phase !== 'lobby') return false;
    const players = this.room.players.map((p) => p.id);
    if (players.length < 2) return false;
    const setup = this.modes[this.state.mode].setup(players, this.state.mins, this.ctx);
    this.commit({
      ...this.state,
      ...setup,
      round: this.state.round + 1,
      rev: 0,
      phase: 'countdown',
      players,
      ready: [],
      leftMs: COUNTDOWN_MS,
      elapsedMs: 0,
    });
    return true;
  }

  // --- everyone ---

  isReady(id: string): boolean {
    return this.state.ready.includes(id);
  }

  toggleReady(): void {
    if (this.state.phase !== 'lobby') return;
    const on = !this.isReady(this.room.myId);
    if (this.isHost) this.setReady(this.room.myId, on);
    else {
      this.room.sendGame({ k: 'ready', on });
      // Show it at once; the host's next state confirms it.
      const ready = this.state.ready.filter((x) => x !== this.room.myId);
      if (on) ready.push(this.room.myId);
      this.state = { ...this.state, ready };
      this.onChange();
    }
  }

  /** A friend's message (event `g`). */
  receive(p: Record<string, unknown>, from: string): void {
    if (p.k === 'state') {
      if (from !== this.room.hostId) return;
      const s = parseRound(p.s, this.modes);
      if (!s) return;
      const cur = this.state;
      if (s.round < cur.round || (s.round === cur.round && s.rev < cur.rev)) return;
      this.apply(s);
    } else if (p.k === 'sync' && this.isHost) {
      this.broadcast();
    } else if (p.k === 'ready' && this.isHost) {
      this.setReady(from, p.on === true);
    } else if (p.k === 'claim' && this.isHost && p.c && typeof p.c === 'object') {
      this.handleClaim(from, p.c as Claim);
    }
  }

  /** Someone joined: the host sends the state so they see the lobby or the round. */
  welcome(): void {
    if (this.isHost) this.broadcast();
  }

  update(): void {
    const now = performance.now();
    const s = this.state;
    if (this.isHost) {
      if (s.phase === 'countdown' && now >= this.phaseEndAt) {
        this.commit({ ...s, phase: 'playing', leftMs: s.mins * 60000, elapsedMs: 0 });
      } else if (s.phase === 'playing' && (now >= this.phaseEndAt || this.mode.done(s, this.ctx) || !s.players.some((id) => this.ctx.present(id)))) {
        this.finishRound();
      } else if (s.phase === 'results' && now >= this.phaseEndAt) {
        this.commit({ ...s, phase: 'lobby', ready: [], leftMs: 0, elapsedMs: 0 });
      } else if (s.phase !== 'lobby' && now - this.lastSent > KEEPALIVE_MS) {
        this.broadcast();
      }
    }
    const me = this.room.myId;
    const inRound = this.inRound;
    const held =
      inRound &&
      ((this.state.phase === 'countdown' && now < this.phaseEndAt) ||
        (this.state.phase === 'playing' && this.elapsedMs(now) < this.mode.holdMs(me, this.state)));
    this.game.locked = held;
    if (inRound && !held && this.state.phase === 'playing') {
      this.mode.tick({ ...this.state, elapsedMs: this.elapsedMs(now) }, this.ctx, (c) => this.claim(c));
    }
  }

  /** Chor–Police: our weapon hit a chor (task M.11): claim it as a catch. */
  stun(target: string): void {
    const s = this.state;
    if (!this.inRound || s.phase !== 'playing' || s.mode !== 'chor') return;
    if (s.roles[this.room.myId] !== 'police' || s.roles[target] !== 'chor') return;
    this.claim({ kind: 'catch', target, stun: true });
  }

  // --- internals ---

  private claim(c: Claim): void {
    if (this.isHost) this.handleClaim(this.room.myId, c);
    else this.room.sendGame({ k: 'claim', c });
  }

  private handleClaim(from: string, c: Claim): void {
    const s = this.state;
    if (s.phase !== 'playing' || !s.players.includes(from) || typeof c.kind !== 'string') return;
    const next: RoundState = { ...s, scores: { ...s.scores }, roles: { ...s.roles }, data: structuredClone(s.data), elapsedMs: this.elapsedMs() };
    const changed = this.mode.claim(next, from, c, this.ctx);
    if (!changed) return;
    if (changed === 'quiet') {
      // Kept here and sent with the next keep-alive (every 4 s).
      this.state = next;
      this.onChange();
      return;
    }
    this.commit(next);
  }

  private setReady(id: string, on: boolean): void {
    if (this.state.phase !== 'lobby') return;
    const ready = this.state.ready.filter((x) => x !== id);
    if (on) ready.push(id);
    this.commit({ ...this.state, ready });
  }

  private finishRound(): void {
    const s = this.state;
    const next: RoundState = { ...s, scores: { ...s.scores }, roles: { ...s.roles }, data: structuredClone(s.data), elapsedMs: this.elapsedMs() };
    this.mode.finish(next, this.ctx);
    this.commit({ ...next, phase: 'results', leftMs: RESULTS_MS });
  }

  /** Host: change the state, apply it here and send it. */
  private commit(next: RoundState): void {
    const now = performance.now();
    // Durations are measured from now.
    if (next.phase === this.state.phase && next.round === this.state.round && next.phase !== 'lobby') {
      next.leftMs = this.leftMs(now);
      next.elapsedMs = this.elapsedMs(now);
    }
    next.rev = next.round === this.state.round ? this.state.rev + 1 : 0;
    this.apply(next);
    this.broadcast();
  }

  private broadcast(): void {
    const now = performance.now();
    const s = { ...this.state, leftMs: this.leftMs(now), elapsedMs: this.elapsedMs(now) };
    this.room.sendGame({ k: 'state', s });
    this.lastSent = now;
  }

  /** Take a new state: timers, moving to start spots, back to the lobby. */
  private apply(next: RoundState): void {
    const prev = this.state;
    const now = performance.now();
    this.state = next;
    this.phaseEndAt = now + next.leftMs;
    if (next.phase === 'playing') this.goAt = now - next.elapsedMs;
    const me = this.room.myId;
    const mine = next.players.includes(me);
    const newRound = next.round !== prev.round;
    if (mine && next.phase === 'countdown' && (newRound || prev.phase !== 'countdown')) {
      const spot = this.modes[next.mode].startSpot(me, next, this.ctx);
      this.game.driveCar(this.ctx.slotOf(me), spot.x, spot.z, spot.heading);
      this.game.startRound(next.mode);
    }
    if (next.phase === 'results' && prev.phase !== 'results') {
      this.game.locked = false;
      this.onResults(next);
    }
    if (mine && next.phase === 'lobby' && prev.phase === 'results' && !newRound) {
      const spot = this.lobbySpot(me);
      this.game.toFoot(spot.x, spot.z, spot.heading);
    }
    this.onChange();
  }
}
