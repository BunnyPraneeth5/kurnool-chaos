import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRound, RoundController } from '../src/modes/round';
import { huntMode } from '../src/modes/hunt';
import { chorPoliceMode } from '../src/modes/chorPolice';
import type { Room } from '../src/net/room';
import type { Game } from '../src/game';
import { ctx } from './helpers';

const modes = { chor: chorPoliceMode, hunt: huntMode };

function fakeRoom(myId: string, host: string) {
  const sent: Record<string, unknown>[] = [];
  const room = {
    myId,
    hostId: host,
    get isHost(): boolean {
      return this.hostId === myId;
    },
    players: [{ id: 'a' }, { id: 'b' }],
    sendGame: (p: Record<string, unknown>) => (sent.push(p), true),
  };
  return { room, sent };
}
const fakeGame = () => ({ locked: false, driveCar: vi.fn(), toFoot: vi.fn() });
const spot = () => ({ x: 0, z: 0, heading: 0 });
const make = (room: unknown, game: unknown, myId: string) =>
  new RoundController(room as Room, game as Game, ctx({ a: { x: 0, z: 0 }, b: { x: 0, z: 0 } }, myId), modes, spot);

describe('parseRound', () => {
  it('rejects unknown phases and modes, clamps times', () => {
    const ok = { round: 1, rev: 0, phase: 'playing', mode: 'chor', mins: 5, leftMs: 9e9, elapsedMs: 10 };
    expect(parseRound({ ...ok, phase: 'party' }, modes)).toBeNull();
    expect(parseRound({ ...ok, mode: 'golf' }, modes)).toBeNull();
    expect(parseRound(ok, modes)?.leftMs).toBe(3600000);
    expect(parseRound({ ...ok, mins: 7 }, modes)?.mins).toBe(5);
  });
});

describe('round flow', () => {
  let now = 0;
  beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(chorPoliceMode, 'startSpot').mockReturnValue(spot());
  });

  it('host starts a countdown with everyone, then Go', () => {
    const { room, sent } = fakeRoom('a', 'a');
    const game = fakeGame();
    const r = make(room, game, 'a');
    expect(r.start()).toBe(true);
    expect(r.state.phase).toBe('countdown');
    expect(r.state.players).toEqual(['a', 'b']);
    expect(game.driveCar).toHaveBeenCalledOnce();
    expect(sent.at(-1)?.k).toBe('state');
    now += 4000;
    r.update();
    expect(r.state.phase).toBe('playing');
  });

  it('a guest only takes state from the host and ignores older revisions', () => {
    const { room } = fakeRoom('b', 'a');
    const r = make(room, fakeGame(), 'b');
    const s = { round: 2, rev: 3, phase: 'lobby', mode: 'hunt', mins: 3, leftMs: 0, elapsedMs: 0 };
    r.receive({ k: 'state', s }, 'b');
    expect(r.state.round).toBe(0);
    r.receive({ k: 'state', s }, 'a');
    expect(r.state.mode).toBe('hunt');
    r.receive({ k: 'state', s: { ...s, rev: 2, mode: 'chor' } }, 'a');
    expect(r.state.mode).toBe('hunt');
  });

  it('after the host leaves, the next host is listened to', () => {
    const { room } = fakeRoom('b', 'a');
    const r = make(room, fakeGame(), 'b');
    room.hostId = 'c';
    r.receive({ k: 'state', s: { round: 1, rev: 0, phase: 'lobby', mode: 'hunt', mins: 3, leftMs: 0, elapsedMs: 0 } }, 'c');
    expect(r.state.mode).toBe('hunt');
  });

  it('after sleep, timers move on by the missing time and a guest asks for the state', () => {
    const { room, sent } = fakeRoom('b', 'a');
    const r = make(room, fakeGame(), 'b');
    r.receive({ k: 'state', s: { round: 1, rev: 0, phase: 'playing', mode: 'hunt', mins: 3, leftMs: 60000, elapsedMs: 0, players: ['a'] } }, 'a');
    expect(r.leftMs()).toBe(60000);
    r.resume(30000);
    expect(r.leftMs()).toBe(30000);
    expect(r.elapsedMs()).toBe(30000);
    expect(sent.at(-1)).toEqual({ k: 'sync' });
  });

  it('the host answers a sync request with the state', () => {
    const { room, sent } = fakeRoom('a', 'a');
    const r = make(room, fakeGame(), 'a');
    r.receive({ k: 'sync' }, 'b');
    expect(sent.at(-1)?.k).toBe('state');
  });
});
