import type * as THREE from 'three';
import type { Game } from '../game';
import type { MapData } from '../map/types';
import { ChatUi } from '../ui/chat';
import { RoomHud } from '../ui/roomHud';
import { cleanNick, saveNick } from './ids';
import { RemotePlayers } from './remotePlayers';
import type { Room } from './room';
import { cssColour, playerColour, type PlayerInfo } from './roomTypes';
import { spawnPoint } from './spawn';
import { NetSync } from './sync';

// Everything that runs while you are in a room: spawn point, friends' models,
// sending our state, the room panel (go to, block, kick, rename, leave), chat,
// and notices when people join, leave, get removed or the host changes.

const GO_TO_BEHIND_M = 7;

export interface RoomSession {
  /** Before game.update: move friends and hand their cars to the game as bumpers. */
  before(dt: number): void;
  /** After game.update: send our state if due. */
  after(): void;
}

export function startRoomSession(
  r: Room,
  game: Game,
  map: MapData,
  scene: THREE.Scene,
  camera: THREE.Camera,
  exits: { onLeave: () => void; onKicked: () => void },
): RoomSession {
  const sp = spawnPoint(map, game.roads, r.self.slot);
  game.placeAt(sp.x, sp.z, sp.heading);

  const remotes = new RemotePlayers(scene, camera, r.myId, game.vehicles, () => game.car);
  const sync = new NetSync(r, game);
  const byId = (id: string): PlayerInfo | undefined => r.players.find((p) => p.id === id);
  const colourOf = (p: PlayerInfo): string => cssColour(playerColour(p.slot));

  const chat = new ChatUi({
    send: (text, emote) => {
      if (!r.chat(text, emote)) return false;
      chat.line(`${r.self.nick} (you)`, colourOf(r.self), text);
      return true;
    },
  });

  const hud = new RoomHud(r.code, r.myId, {
    hostId: () => r.hostId,
    goTo: (id) => {
      const p = byId(id);
      const pose = remotes.poseOf(id);
      if (!p || !pose) {
        chat.notice(`Can't see ${p?.nick ?? 'them'} right now`);
        return;
      }
      // A few metres behind them, on the road if there is one close by.
      const tx = pose.x - Math.sin(pose.h) * GO_TO_BEHIND_M;
      const tz = pose.z - Math.cos(pose.h) * GO_TO_BEHIND_M;
      const road = game.roads.nearest(tx, tz, pose.h, 30);
      const to = road && road.dist < 15 ? road : { x: tx, z: tz, heading: pose.h };
      game.teleport(to.x, to.z, to.heading);
      chat.notice(`Went to ${p.nick}`);
    },
    setBlocked: (id, blocked) => remotes.setBlocked(id, blocked),
    kick: (id) => {
      if (!r.kick(id)) chat.notice('Could not remove them right now');
    },
    rename: async (nick) => {
      const ok = await r.rename(nick);
      if (ok) saveNick(cleanNick(nick));
      return ok;
    },
    leave: () => void r.leave().then(exits.onLeave),
    openChat: () => chat.open(),
    toast: (m) => game.toast(m),
  });

  // Notices: compare each new member list with the last one.
  let known = new Map(r.players.map((p) => [p.id, p.nick] as const));
  let lastHost = r.hostId;
  const removed = new Set<string>();
  const onPlayers = (players: PlayerInfo[]): void => {
    hud.setPlayers(players);
    remotes.setPlayers(players);
    const now = new Map(players.map((p) => [p.id, p.nick] as const));
    for (const [id, nick] of now) {
      const before = known.get(id);
      if (before === undefined) chat.notice(`${nick} joined`);
      else if (before !== nick) chat.notice(`${before} is now ${nick}`);
    }
    for (const [id, nick] of known) if (!now.has(id) && !removed.has(id)) chat.notice(`${nick} left`);
    known = now;
    if (r.hostId !== lastHost) {
      lastHost = r.hostId;
      chat.notice(lastHost === r.myId ? 'You are now the host' : `${byId(lastHost)?.nick ?? 'Someone'} is now the host`);
    }
  };
  hud.setPlayers(r.players);
  remotes.setPlayers(r.players);
  r.onPlayers = onPlayers;
  r.onStatus = (st) => hud.setStatus(st);
  r.onState = (st, recv) => remotes.push(st, recv);
  r.onChat = (m) => {
    const p = byId(m.id);
    if (!p || hud.isBlocked(m.id)) return;
    chat.line(p.nick, colourOf(p), m.text);
    remotes.say(m.id, m.text, performance.now());
  };
  r.onKick = (p) => {
    removed.add(p.id);
    chat.notice(`${p.nick} was removed by the host`);
  };
  r.onKicked = exits.onKicked;
  chat.notice(r.players.length <= 1 ? `Room ${r.code} is ready: tap Share to invite friends. You are the host.` : `You joined room ${r.code}`);

  if (import.meta.env.DEV) Object.assign(window, { __remotes: remotes, __sync: sync, __chat: chat, __hud: hud });

  return {
    before: (dt) => {
      remotes.update(dt, performance.now(), r.players.length);
      game.extraCars = remotes.carColliders;
    },
    after: () => sync.update(performance.now()),
  };
}
