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
import { parseRoomCode, loadNick, newPlayerId } from './net/ids';
import { RoomError } from './net/roomTypes';
import type { Room } from './net/room';

// Boot: renderer, sky, map meshes, then the game loop (see game.ts).

const canvas = document.getElementById('gl');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Canvas #gl not found in index.html');

async function boot(gl: HTMLCanvasElement): Promise<void> {
  // Room link (?room=ABC123): check it and the Supabase settings before loading anything.
  const roomParam = new URLSearchParams(location.search).get('room');
  let roomCode: string | null = null;
  let netCfg: NetConfig | null = null;
  if (roomParam !== null) {
    roomCode = parseRoomCode(roomParam);
    if (!roomCode) {
      showError('That room link looks wrong', `"${roomParam.slice(0, 20)}" is not a room code. Codes are 6 letters and digits, like K7MPQ2.`);
      return;
    }
    try {
      netCfg = readNetConfig();
    } catch (err) {
      showError('Multiplayer is not set up', err instanceof NetConfigError ? err.message : String(err));
      return;
    }
  }

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

  let map;
  try {
    map = await loadMap(mapUrl, (bytes) => showLoading(`Loading Kurnool… ${(bytes / 1e6).toFixed(1)} MB`));
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
  if (roomCode && netCfg) {
    showLoading(`Joining room ${roomCode}…`);
    try {
      const { Room } = await import('./net/room');
      room = await Room.join(netCfg, roomCode, loadNick() || 'Player', newPlayerId());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError(err instanceof RoomError && err.kind === 'full' ? 'Room full' : 'Could not connect to the room', msg);
      return;
    }
    room.onPlayers = (players) => console.info('[room] players:', players.map((p) => p.nick).join(', '));
  }

  const game = new Game(map, scene, camera, gl);
  hideStatus();

  if (import.meta.env.DEV) Object.assign(window, { __three: { renderer, scene, camera }, __game: game });

  const fps = createFpsMeter(quality.level);
  const timer = new THREE.Timer();
  renderer.setAnimationLoop((ts) => {
    timer.update(ts);
    // Capped so a stalled frame never teleports anything; vehicles also sub-step.
    const dt = Math.min(timer.getDelta(), 1 / 30);
    game.update(dt);
    sky.update(camera);
    renderer.render(scene, camera);
    fps.frame(ts);
  });
}

void boot(canvas);
