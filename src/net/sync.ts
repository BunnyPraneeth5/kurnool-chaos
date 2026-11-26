import type { Game } from '../game';
import { HEARTBEAT_MS, sendHz, type NetState } from './interp';
import type { Room } from './room';

// Sends our state (ARCHITECTURE: Multiplayer): at the adaptive rate while moving,
// a heartbeat every 2 s while standing still, nothing when alone in the room.

const MOVE_EPS = 0.05; // m
const TURN_EPS = 0.01; // rad
const SPEED_EPS = 0.1; // m/s

type Body = ReturnType<Game['netState']>;

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export class NetSync {
  private last: Body | null = null;
  private lastAt = -Infinity;
  private idle = true;
  private force = true;
  /** Messages sent, for checks in dev tools. */
  sent = 0;

  constructor(
    private readonly room: Room,
    private readonly game: Game,
  ) {
    room.onNeedState = () => (this.force = true);
    // Background tabs get no animation frames; timers still run about once a second,
    // so friends keep seeing a standing figure instead of it timing out.
    window.setInterval(() => this.update(performance.now()), 1000);
  }

  update(nowMs: number): void {
    const hz = sendHz(this.room.players.length);
    if (hz === 0) {
      this.force = true; // whoever joins next gets our state at once
      return;
    }
    const s = this.game.netState();
    const l = this.last;
    const changed =
      !l ||
      l.mode !== s.mode ||
      l.car !== s.car ||
      Math.hypot(s.x - l.x, s.z - l.z) > MOVE_EPS ||
      Math.abs(s.h - l.h) > TURN_EPS ||
      Math.abs(s.v - l.v) > SPEED_EPS;
    const since = nowMs - this.lastAt;
    let send = false;
    if (this.force) send = true;
    else if (changed) send = this.idle || since >= 1000 / hz; // starting to move goes out at once
    else send = since >= HEARTBEAT_MS;
    if (!send) return;

    const msg: NetState = {
      id: this.room.myId,
      t: Date.now(),
      x: round(s.x, 2),
      z: round(s.z, 2),
      y: round(s.y, 2),
      h: round(s.h, 3),
      v: round(s.v, 2),
      mode: s.mode,
      car: s.car,
    };
    if (!this.room.send(msg)) return; // reconnecting: try again next frame
    this.sent++;
    this.force = false;
    this.idle = !changed;
    this.last = s;
    this.lastAt = nowMs;
  }
}
