import type * as THREE from 'three';
import type { Game } from '../game';
import type { MapData } from '../map/types';
import { ChatUi } from '../ui/chat';
import type { Menu } from '../ui/menu';
import { RoomHud } from '../ui/roomHud';
import { cleanNick, saveNick } from './ids';
import { RemotePlayers } from './remotePlayers';
import type { Room } from './room';
import { cssColour, playerColour, type PlayerInfo } from './roomTypes';
import { buildLobby, findLobby, lobbySpot, parkLobbyCars } from '../modes/lobby';
import { NetSync } from './sync';
import { LOBBY_CARS } from '../vehicles/parked';
import { RoundController } from '../modes/round';
import { GameUi } from '../modes/ui';
import { Beacon, flashLightBars, setPoliceLook } from '../modes/visuals';
import { huntMode } from '../modes/hunt';
import { chorPoliceMode } from '../modes/chorPolice';
import type { ModeCtx, RoundState } from '../modes/types';

// Everything that runs while you are in a room: spawn point, friends' models,
// sending our state, the room panel (go to, block, kick, rename, leave), chat,
// notices when people join, leave, get removed or the host changes, and game
// rounds (lobby card, modes, timer, results).

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
  exits: { onLeave: () => void; onKicked: () => void; menu: Menu },
): RoomSession {
  // Rooms gather on Jagannatha Gattu (G.1): plaza and sign, the shared cars parked
  // around it, and everyone spread over the plaza. Rounds start down in the city.
  const lobby = findLobby(map);
  scene.add(buildLobby(lobby));
  parkLobbyCars(lobby, game.vehicles.slice(0, LOBBY_CARS), game.world);
  const sp = lobbySpot(lobby, r.self.slot);
  game.placeAt(sp.x, sp.z, sp.heading);

  const remotes = new RemotePlayers(scene, camera, r.myId, game.shared, () => game.car);
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
    openChat: () => chat.open(),
    openRoom: () => exits.menu.open('room'),
    toast: (m) => game.toast(m),
  });

  // The room page of the menu, and Leave in the menu.
  exits.menu.add({ id: 'room', title: `Room ${r.code}`, render: () => hud.panel }, 'stats');
  exits.menu.start({ label: 'Leave room', armed: 'Leave?', run: () => void r.leave().then(exits.onLeave) });

  // Game rounds (Phase G). Between rounds everyone is back on the Jagannatha Gattu plaza.
  // A player who drops out briefly (phone lock, reconnect) still counts as present for
  // a while, so a round does not end the moment the only police reconnects.
  const PRESENT_GRACE_MS = 15000;
  const lastSeen = new Map<string, number>();
  /** Names of everyone seen in this room, so results still name players who left. */
  const nicks = new Map<string, string>();
  const markSeen = (): void => {
    const now = performance.now();
    for (const p of r.players) {
      lastSeen.set(p.id, now);
      nicks.set(p.id, p.nick);
    }
  };
  markSeen();
  const ctx: ModeCtx = {
    map,
    roads: game.roads,
    myId: r.myId,
    posOf: (id) => {
      if (id !== r.myId) return remotes.posOf(id);
      const st = game.netState();
      return { x: st.x, z: st.z };
    },
    present: (id) => r.players.some((p) => p.id === id) || performance.now() - (lastSeen.get(id) ?? -Infinity) < PRESENT_GRACE_MS,
    slotOf: (id) => byId(id)?.slot ?? 0,
    nickOf: (id) => byId(id)?.nick ?? nicks.get(id) ?? 'Someone',
  };
  const rounds = new RoundController(r, game, ctx, { chor: chorPoliceMode, hunt: huntMode }, (id) => lobbySpot(lobby, ctx.slotOf(id)));
  const gameUi = new GameUi(rounds, r, camera);
  const beacon = new Beacon(scene);
  let lastPhase = rounds.state.phase;
  let lookCar: THREE.Object3D | null = null;
  const badges = (s: RoundState): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const p of r.players) {
      if (s.phase === 'lobby') {
        if (rounds.isReady(p.id)) out[p.id] = 'ready';
      } else if (s.players.includes(p.id)) {
        const role = s.roles[p.id];
        out[p.id] = `${role ? `${role} · ` : ''}${s.scores[p.id] ?? 0}`;
      }
    }
    return out;
  };
  rounds.onChange = () => {
    const s = rounds.state;
    gameUi.refresh();
    hud.setBadges(badges(s));
    if (s.phase !== lastPhase) {
      if (s.phase === 'countdown') chat.notice(`${rounds.mode.name} starting!`);
      if (s.phase === 'lobby' && lastPhase === 'results') chat.notice('Back in the lobby. The host can start the next game.');
      lastPhase = s.phase;
    }
  };
  r.onGame = (p, from) => rounds.receive(p, from);

  // Notices: compare each new member list with the last one.
  let known = new Map(r.players.map((p) => [p.id, p.nick] as const));
  let lastHost = r.hostId;
  const removed = new Set<string>();
  const onPlayers = (players: PlayerInfo[]): void => {
    // Everyone in the previous list was here until just now.
    const t = performance.now();
    for (const id of known.keys()) lastSeen.set(id, t);
    markSeen();
    hud.setPlayers(players);
    remotes.setPlayers(players);
    const now = new Map(players.map((p) => [p.id, p.nick] as const));
    for (const [id, nick] of now) {
      const before = known.get(id);
      if (before === undefined) chat.notice(`${nick} joined`);
      else if (before !== nick) chat.notice(`${before} is now ${nick}`);
    }
    for (const [id, nick] of known) if (!now.has(id) && !removed.has(id)) chat.notice(`${nick} left`);
    const arrived = [...now.keys()].some((id) => !known.has(id));
    known = now;
    if (arrived) rounds.welcome();
    gameUi.refresh();
    hud.setBadges(badges(rounds.state));
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
  chat.notice(r.players.length <= 1 ? `Room ${r.code} is ready on Jagannatha Gattu: tap Share to invite friends. You are the host.` : `You joined room ${r.code} on Jagannatha Gattu`);

  if (import.meta.env.DEV) Object.assign(window, { __remotes: remotes, __sync: sync, __chat: chat, __hud: hud, __rounds: rounds, __gameUi: gameUi });

  return {
    before: (dt) => {
      const now = performance.now();
      rounds.update();
      const s = rounds.state;
      for (const p of r.players) {
        const police = rounds.mode.isPolice(s, p.id);
        if (p.id !== r.myId) {
          remotes.setPolice(p.id, police);
          continue;
        }
        // Our own car: the bar follows us into another car and comes off after the round.
        const mesh = game.car?.mesh ?? null;
        if (lookCar && lookCar !== mesh) setPoliceLook(lookCar, false);
        setPoliceLook(mesh, police);
        lookCar = mesh;
      }
      flashLightBars(now);
      const target = gameUi.beaconTarget();
      beacon.set(target, now);
      // Rounds have their own police: no local cops while one runs for us.
      game.life.calm = (s.phase === 'countdown' || s.phase === 'playing') && s.players.includes(r.myId);
      game.minimap.target = target;
      game.minimap.friends = [];
      for (const p of r.players) {
        if (p.id === r.myId) continue;
        const pose = remotes.poseOf(p.id);
        if (pose) game.minimap.friends.push({ x: pose.x, z: pose.z, colour: colourOf(p) });
      }
      gameUi.update();
      remotes.update(dt, now, r.players.length);
      game.extraCars = remotes.carColliders;
    },
    after: () => sync.update(performance.now()),
  };
}
