import * as THREE from 'three';
import { loadMap, MapLoadError } from './map/loadMap';
import { buildGround } from './map/ground';
import { buildWater } from './map/water';
import { buildRoads } from './map/roads';
import { buildBuildings } from './map/buildings';
import { buildParks } from './map/parks';
import { createSky } from './world/sky';
import { detectQuality } from './world/quality';
import { Game } from './game';
import { showLoading, showError, hideStatus } from './ui/status';
import { createFpsMeter } from './ui/fps';
import { readNetConfig, NetConfigError, type NetConfig } from './net/config';
import { parseRoomCode, newPlayerId, roomLink } from './net/ids';
import { RoomError, playerColour } from './net/roomTypes';
import type { Room } from './net/room';
import { spawnPoint } from './net/spawn';
import { runLobby } from './ui/lobby';
import { RoomHud } from './ui/roomHud';
import { RemotePlayers } from './net/remotePlayers';
import { NetSync } from './net/sync';

// Boot: renderer, sky, map meshes, then the game loop (see game.ts).

const canvas = document.getElementById('gl');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Canvas #gl not found in index.html');

function goToStart(): void {
  location.href = location.pathname;
}

/** Supabase settings, or a clear error screen (no silent single-player fallback). */
function netConfigOrError(): NetConfig | null {
  try {
    return readNetConfig();
  } catch (err) {
    showError('Multiplayer is not set up', err instanceof NetConfigError ? err.message : String(err), [
      { label: 'Retry', run: () => location.reload() },
      { label: 'Back to start', run: goToStart },
    ]);
    return null;
  }
}

async function boot(gl: HTMLCanvasElement): Promise<void> {
  // Room link (?room=ABC123): check it and the Supabase settings before anything else.
  const roomParam = new URLSearchParams(location.search).get('room');
  const linkCode = roomParam === null ? null : parseRoomCode(roomParam);
  if (roomParam !== null && !linkCode) {
    showError('That room link looks wrong', `"${roomParam.slice(0, 20)}" is not a room code. Codes are 6 letters and digits, like K7MPQ2.`, [
      { label: 'Back to start', run: goToStart },
    ]);
    return;
  }
  if (linkCode && !netConfigOrError()) return;

  showLoading('Loading Kurnool…');

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true, powerPreference: 'high-performance' });
  } catch {
    showError('3D graphics not available', 'This browser or device could not start WebGL. Try Chrome, or turn on hardware acceleration.');
    return;
  }
  const quality = detectQuality();
  renderer.setPixelRatio(quality.pixelRatio);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, 0.5, 1300);
  const sky = createSky(scene, renderer, quality.fogFar);

  const resize = (): void => {
    const w = window.innerWidth || 800;
    const h = window.innerHeight || 600;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 72 : 58;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  // Dev builds can point at another map file to test the error screen: ?map=/map/missing.json
  const devMap = import.meta.env.DEV ? new URLSearchParams(location.search).get('map') : null;
  const mapUrl = devMap ?? `${import.meta.env.BASE_URL}map/kurnool.json`;

  // Download the map while the player types a nickname.
  let lobbyOpen = true;
  let lastBytes = 0;
  const mapP = loadMap(mapUrl, (bytes) => {
    lastBytes = bytes;
    if (!lobbyOpen) showLoading(`Loading Kurnool… ${(bytes / 1e6).toFixed(1)} MB`);
  }).then(
    (m) => ({ ok: true as const, m }),
    (e: unknown) => ({ ok: false as const, e }),
  );

  const choice = await runLobby(linkCode);
  lobbyOpen = false;
  let joinP: Promise<Room> | null = null;
  let roomCode = '';
  if (choice.kind === 'room') {
    const cfg = netConfigOrError();
    if (!cfg) return;
    roomCode = choice.code;
    history.replaceState(null, '', roomLink(roomCode));
    const myId = newPlayerId();
    joinP = import('./net/room').then(({ Room }) => Room.join(cfg, roomCode, choice.nick, myId));
    joinP.catch(() => {}); // handled below, after the city is built
  }
  showLoading(`Loading Kurnool… ${(lastBytes / 1e6).toFixed(1)} MB`);

  const loaded = await mapP;
  let map;
  try {
    if (!loaded.ok) throw loaded.e;
    map = loaded.m;
  } catch (err) {
    const detail = err instanceof MapLoadError ? err.message : `Unexpected error: ${String(err)}`;
    showError('Could not load the map', detail);
    return;
  }

  // Let the message paint before the heavy, blocking mesh build.
  showLoading('Building the city…');
  await new Promise((r) => setTimeout(r, 30));

  scene.add(buildGround(map));
  scene.add(buildWater(map));
  scene.add(buildRoads(map));
  scene.add(buildParks(map, quality));
  scene.add(buildBuildings(map, quality, quality.level === 'high' ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1));

  let room: Room | null = null;
  let beforeUpdate: (dt: number) => void = () => {};
  let afterUpdate: () => void = () => {};
  if (joinP) {
    showLoading(`Joining room ${roomCode}…`);
    try {
      room = await joinP;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const full = err instanceof RoomError && err.kind === 'full';
      showError(full ? 'Room full' : 'Could not connect to the room', msg, [
        { label: 'Try again', run: () => location.reload() },
        { label: 'Back to start', run: goToStart },
      ]);
      return;
    }
  }

  const game = new Game(map, scene, camera, gl, room ? playerColour(room.self.slot) : undefined);
  if (room) {
    const r = room;
    const sp = spawnPoint(map, game.roads, r.self.slot);
    game.placeAt(sp.x, sp.z, sp.heading);
    const hud = new RoomHud(r.code, r.myId, (m) => game.toast(m));
    const remotes = new RemotePlayers(scene, camera, r.myId, game.vehicles, () => game.car);
    const sync = new NetSync(r, game);
    hud.setPlayers(r.players);
    remotes.setPlayers(r.players);
    r.onPlayers = (players) => {
      hud.setPlayers(players);
      remotes.setPlayers(players);
    };
    r.onStatus = (st) => hud.setStatus(st);
    r.onState = (st, recv) => remotes.push(st, recv);
    beforeUpdate = (dt) => {
      remotes.update(dt, performance.now(), r.players.length);
      game.extraCars = remotes.carColliders;
    };
    afterUpdate = () => sync.update(performance.now());
    if (import.meta.env.DEV) Object.assign(window, { __remotes: remotes, __sync: sync });
  }
  hideStatus();

  if (import.meta.env.DEV) Object.assign(window, { __three: { renderer, scene, camera }, __game: game, __room: room });

  const fps = createFpsMeter(quality.level);
  const timer = new THREE.Timer();
  renderer.setAnimationLoop((ts) => {
    timer.update(ts);
    // Capped so a stalled frame never teleports anything; vehicles also sub-step.
    const dt = Math.min(timer.getDelta(), 1 / 30);
    beforeUpdate(dt);
    game.update(dt);
    afterUpdate();
    sky.update(camera);
    renderer.render(scene, camera);
    fps.frame(ts);
  });
}

void boot(canvas);
