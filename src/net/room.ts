import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { NetConfig } from './config';
import { cleanNick } from './ids';
import { parseState, type NetState } from './interp';
import { ROOM_CAP, RoomError, type PlayerInfo, type RoomStatus } from './roomTypes';

export { ROOM_CAP, RoomError, type PlayerInfo, type RoomStatus };

// One Supabase Realtime channel per room (ARCHITECTURE: Multiplayer):
// presence says who is in the room, broadcast event `s` carries player state.

const JOIN_TIMEOUT_MS = 12000;
const FIRST_SYNC_WAIT_MS = 2500;
/** Coming back after the page was hidden this long forces a fresh connection. */
const HIDDEN_RECONNECT_MS = 4000;

function parsePlayer(key: string, p: unknown): PlayerInfo | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const slot = typeof o.slot === 'number' && Number.isInteger(o.slot) ? o.slot : -1;
  const joinedAt = typeof o.joinedAt === 'number' && Number.isFinite(o.joinedAt) ? o.joinedAt : 0;
  return { id: key.slice(0, 32), nick: cleanNick(o.nick) || 'Player', slot: slot >= 0 && slot < ROOM_CAP ? slot : 0, joinedAt };
}

export class Room {
  /** Everyone in the room including me, in join order. */
  players: PlayerInfo[] = [];
  status: RoomStatus = 'online';
  onPlayers: (players: PlayerInfo[]) => void = () => {};
  onState: (s: NetState, recvMs: number) => void = () => {};
  onStatus: (status: RoomStatus) => void = () => {};
  /** Someone new arrived (or we reconnected): send our state right away. */
  onNeedState: () => void = () => {};

  private readonly client: SupabaseClient;
  private channel: RealtimeChannel | null = null;
  private me!: PlayerInfo;
  private hiddenAt = 0;
  private retryTimer = 0;
  private retryDelay = 1000;
  private generation = 0;
  private closed = false;
  private rejoining = false;
  private rejoinAgain = false;

  private constructor(
    cfg: NetConfig,
    readonly code: string,
    readonly myId: string,
  ) {
    this.client = createClient(cfg.url, cfg.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  get self(): PlayerInfo {
    return this.me;
  }

  /**
   * Connects, waits for the current member list, checks the soft cap, picks a free
   * slot and announces us. Rejects with RoomError on failure or a full room.
   */
  static async join(cfg: NetConfig, code: string, nick: string, myId: string): Promise<Room> {
    const room = new Room(cfg, code, myId);
    try {
      await room.connect();
      const others = room.readPresence().filter((p) => p.id !== myId);
      // Soft cap (ARCHITECTURE): whoever is already in keeps their place; a newcomer who
      // finds 8 others leaves. Presence can briefly disagree, so 9 can slip in at once.
      if (others.length >= ROOM_CAP) {
        throw new RoomError(`Room ${code} already has ${others.length} players (max ${ROOM_CAP}).`, 'full');
      }
      const used = new Set(others.map((p) => p.slot));
      let slot = 0;
      while (used.has(slot) && slot < ROOM_CAP - 1) slot++;
      room.me = { id: myId, nick, slot, joinedAt: Date.now() };
      await room.track();
      room.syncPlayers();
      room.watchPage();
      return room;
    } catch (err) {
      room.close();
      throw err instanceof RoomError ? err : new RoomError(String(err instanceof Error ? err.message : err), 'connect');
    }
  }

  /** Send our state. Only over a joined websocket, never the REST fallback. */
  send(s: NetState): boolean {
    const ch = this.channel;
    if (this.status !== 'online' || !ch || ch.state !== 'joined') return false;
    void ch.send({ type: 'broadcast', event: 's', payload: s });
    return true;
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retryTimer);
    if (this.channel) void this.client.removeChannel(this.channel);
    this.channel = null;
    void this.client.realtime.disconnect();
  }

  // --- connection ---

  /** Subscribe a fresh channel; resolves once joined and the member list has arrived. */
  private connect(): Promise<void> {
    const gen = ++this.generation;
    const ch = this.client.channel(`room:${this.code}`, {
      config: { broadcast: { self: false }, presence: { key: this.myId } },
    });
    this.channel = ch;
    let synced = false;
    let resolveSync: () => void = () => {};
    const firstSync = new Promise<void>((r) => (resolveSync = r));
    ch.on('presence', { event: 'sync' }, () => {
      if (gen !== this.generation) return;
      synced = true;
      resolveSync();
      if (this.me) this.syncPlayers();
    });
    ch.on('broadcast', { event: 's' }, (msg) => {
      if (gen !== this.generation) return;
      const s = parseState(msg.payload);
      if (s && s.id !== this.myId) this.onState(s, performance.now());
    });

    return new Promise<void>((resolve, reject) => {
      let joined = false;
      const timer = setTimeout(() => {
        if (!joined) reject(new RoomError('The room server did not answer in time. Check your internet and try again.', 'connect'));
      }, JOIN_TIMEOUT_MS);
      ch.subscribe((status, err) => {
        if (gen !== this.generation) return;
        if (status === 'SUBSCRIBED') {
          if (joined) return;
          joined = true;
          clearTimeout(timer);
          // The server sends the member list right after the join; an empty room may
          // not trigger a sync, so wait briefly and then read whatever we have.
          const wait = synced ? Promise.resolve() : Promise.race([firstSync, new Promise((r) => setTimeout(r, FIRST_SYNC_WAIT_MS))]);
          void wait.then(() => resolve());
          return;
        }
        const why = err?.message ? `${status}: ${err.message}` : status;
        if (!joined) {
          clearTimeout(timer);
          reject(new RoomError(`Could not reach the room server. Check your internet and try again. (${why})`, 'connect'));
        } else {
          this.lostConnection(why);
        }
      });
    });
  }

  private async track(): Promise<void> {
    const ch = this.channel;
    if (!ch) throw new RoomError('No channel', 'connect');
    const res = await ch.track({ id: this.me.id, nick: this.me.nick, slot: this.me.slot, joinedAt: this.me.joinedAt });
    if (res !== 'ok') throw new RoomError(`Could not announce you in the room (${res}).`, 'connect');
  }

  private lostConnection(why: string): void {
    if (this.closed || this.status === 'reconnecting') return;
    console.warn(`[room] connection lost: ${why}`);
    this.setStatus('reconnecting');
    this.scheduleReconnect(0);
  }

  private scheduleReconnect(delay: number): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => void this.reconnect(), delay);
  }

  /** Tear down and rejoin with the same id, nickname and slot. Retries with backoff until it works. */
  private async reconnect(): Promise<void> {
    if (this.closed) return;
    if (this.rejoining) {
      this.rejoinAgain = true; // one more round once the current attempt ends
      return;
    }
    this.rejoining = true;
    try {
      await this.rejoinOnce();
    } finally {
      this.rejoining = false;
    }
    if (this.rejoinAgain && !this.closed) {
      this.rejoinAgain = false;
      this.scheduleReconnect(0);
    }
  }

  private async rejoinOnce(): Promise<void> {
    const old = this.channel;
    this.channel = null;
    this.generation++; // ignore late events from the old channel
    if (old) await this.client.removeChannel(old).catch(() => {});
    // The socket may be dead without knowing it (phone was locked). Close it fully
    // first: a connect() while it is still closing does nothing.
    await this.client.realtime.disconnect().catch(() => {});
    try {
      await this.connect();
      await this.track();
      this.retryDelay = 1000;
      this.syncPlayers();
      this.setStatus('online');
      this.onNeedState();
    } catch (err) {
      if (this.closed) return;
      console.warn('[room] reconnect failed, retrying', err);
      this.retryDelay = Math.min(this.retryDelay * 2, 10000);
      this.scheduleReconnect(this.retryDelay);
    }
  }

  private setStatus(s: RoomStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.onStatus(s);
  }

  /** Phone lock or app switch: the socket may be dead without knowing it, so rejoin. */
  private watchPage(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.hiddenAt = performance.now();
        return;
      }
      const away = performance.now() - this.hiddenAt;
      const ch = this.channel;
      if (away > HIDDEN_RECONNECT_MS || !ch || ch.state !== 'joined') {
        this.setStatus('reconnecting');
        this.scheduleReconnect(0);
      } else {
        this.onNeedState();
      }
    });
    window.addEventListener('pagehide', () => this.close());
  }

  // --- presence ---

  private readPresence(): PlayerInfo[] {
    const state = this.channel?.presenceState() ?? {};
    const list: PlayerInfo[] = [];
    for (const [key, metas] of Object.entries(state)) {
      const p = parsePlayer(key, metas[0]);
      if (p) list.push(p);
    }
    return list;
  }

  private syncPlayers(): void {
    const list = this.readPresence();
    if (!list.some((p) => p.id === this.myId)) list.push(this.me); // our own track may not be echoed yet
    list.sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
    const before = new Set(this.players.map((p) => p.id));
    this.players = list;
    this.onPlayers(list);
    if (list.some((p) => !before.has(p.id))) this.onNeedState();
  }
}
