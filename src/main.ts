import * as THREE from 'three';
import { loadMap, loadTerrain, MapLoadError } from './map/loadMap';
import { setTerrain } from './map/terrain';
import { buildGround } from './map/ground';
import { buildWater } from './map/water';
import { buildRoads } from './map/roads';
import { buildBuildings } from './map/buildings';
import { buildParks } from './map/parks';
import { buildProps } from './map/props';
import { buildRail } from './map/rail';
import { buildWaterways } from './map/waterways';
import { buildPoliceStations } from './map/police';
import { buildHospitals } from './map/hospitals';
import { JunctionScenery } from './map/signals';
import { BorderMeshes } from './map/bordersMesh';
import { createSky } from './world/sky';
import { detectQuality } from './world/quality';
import { Game } from './game';
import { sound } from './audio/sound';
import { showLoading, showError, hideStatus } from './ui/status';
import { createFpsMeter } from './ui/fps';
import { readNetConfig, NetConfigError, type NetConfig } from './net/config';
import { parseRoomCode, newPlayerId, roomLink, kickedMinutesLeft } from './net/ids';
import { RoomError, playerColour } from './net/roomTypes';
import type { Room } from './net/room';
import { startRoomSession } from './net/roomSession';
import { runLobby } from './ui/lobby';
import { Menu } from './ui/menu';
import { guidePage } from './ui/guide';
import { aboutPage, settingsPage, statsPage } from './ui/menuPages';
import type { MapData } from './map/types';

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

  // The menu exists from the start screen on (Guide, About); the game adds the rest.
  let mapForGuide: MapData | null = null;
  let showPlace: ((x: number, z: number) => void) | null = null;
  const menu = new Menu();
  menu.add(guidePage({ map: () => mapForGuide, renderer, get showPlace() { return showPlace; } }));
  menu.add(aboutPage());

  // The sound files download meanwhile; any that fail are named on screen.
  sound.load();

  // Download the map while the player types a nickname.
  let lobbyOpen = true;
  let lastBytes = 0;
  const mapP = loadMap(mapUrl, (bytes) => {
    lastBytes = bytes;
    if (!lobbyOpen) showLoading(`Loading Kurnool… ${(bytes / 1e6).toFixed(1)} MB`);
  }).then(
    (m) => {
      mapForGuide = m;
      return { ok: true as const, m };
    },
    (e: unknown) => ({ ok: false as const, e }),
  );

  const choice = await runLobby(linkCode, () => menu.open('guide'));
  menu.close();
  lobbyOpen = false;
  let joinP: Promise<Room> | null = null;
  let roomCode = '';
  if (choice.kind === 'room') {
    const cfg = netConfigOrError();
    if (!cfg) return;
    roomCode = choice.code;
    history.replaceState(null, '', roomLink(roomCode));
    const wait = kickedMinutesLeft(roomCode);
    if (wait > 0) {
      showError('You were removed from this room', `The host removed you from room ${roomCode}. You can join again in ${wait} min.`, [
        { label: 'Back to start', run: goToStart },
      ]);
      return;
    }
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

  try {
    setTerrain(await loadTerrain(mapUrl, map.terrain));
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
  scene.add(buildWaterways(map));
  scene.add(buildRail(map));
  scene.add(buildRoads(map));
  scene.add(buildParks(map, quality));
  const anisotropy = quality.level === 'high' ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  scene.add(buildBuildings(map, quality, anisotropy));
  scene.add(buildProps(map, quality, anisotropy));
  scene.add(buildPoliceStations(map));
  scene.add(buildHospitals(map));
  const junctionScene = new JunctionScenery(map);
  scene.add(junctionScene.group);

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

  const game = new Game(map, scene, camera, gl, room ? playerColour(room.self.slot) : undefined, { traffic: quality.traffic, shadows: quality.vehicleShadows, pedestrians: quality.pedestrians });
  // Roads and borders (Phase R): drawn from the same data as the collision world's borders.
  const borderMeshes = new BorderMeshes(map, game.world, quality);
  scene.add(borderMeshes.group);
  menu.add(
    settingsPage(quality.level, {
      editControls: () => {
        menu.close();
        game.touch.startEdit(() => menu.open('settings'));
      },
      startTilt: () => game.startTilt(),
      centreTilt: () => game.tilt.calibrate(),
    }),
    'about',
  );
  menu.add(statsPage(() => game.chaos), 'about');
  showPlace = (x, z) => {
    menu.close();
    game.viewPlace(x, z);
  };
  if (room) {
    const code = room.code;
    const session = startRoomSession(room, game, map, scene, camera, {
      onLeave: goToStart,
      onKicked: () =>
        showError('You were removed from the room', `The host removed you from room ${code}.`, [{ label: 'Back to start', run: goToStart }]),
      menu,
    });
    beforeUpdate = session.before;
    afterUpdate = session.after;
  } else {
    menu.start({ label: 'Exit', armed: 'Exit?', run: goToStart });
  }
  // Solo play pauses while the menu is open; in a room the world goes on but you stand still.
  const solo = !room;
  menu.onToggle = (open) => (game.isHeld = open);
  hideStatus();

  if (import.meta.env.DEV) {
    // __frame(dt) runs one game step by hand (background tabs get no animation frames in tests).
    const frame = (dt: number): void => {
      beforeUpdate(dt);
      game.update(dt);
      afterUpdate();
    };
    Object.assign(window, { __three: { renderer, scene, camera }, __game: game, __room: room, __menu: menu, __frame: frame, __junctionScene: junctionScene });
  }

  const fps = createFpsMeter(quality.level);
  const timer = new THREE.Timer();
  renderer.setAnimationLoop((ts) => {
    timer.update(ts);
    // Capped so a stalled frame never teleports anything; vehicles also sub-step.
    const dt = Math.min(timer.getDelta(), 1 / 30);
    beforeUpdate(dt);
    if (!(solo && menu.isOpen)) game.update(dt);
    afterUpdate();
    junctionScene.update(Date.now());
    borderMeshes.update();
    sky.update(camera);
    renderer.render(scene, camera);
    fps.frame(ts);
  });
}

void boot(canvas);
