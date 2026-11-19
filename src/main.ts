import * as THREE from 'three';
import { loadMap, MapLoadError } from './map/loadMap';
import { buildGround } from './map/ground';
import { buildWater } from './map/water';
import { buildRoads } from './map/roads';
import { buildBuildings } from './map/buildings';
import { buildParks } from './map/parks';
import { createSky } from './world/sky';
import { detectQuality } from './world/quality';
import { FreeCamera } from './player/freeCamera';
import { CollisionWorld } from './map/collision';
import { Keyboard } from './player/input';
import { OnFootPlayer } from './player/onFoot';
import { ChaseCamera } from './player/chaseCamera';
import { showLoading, showError, hideStatus } from './ui/status';
import { createFpsMeter } from './ui/fps';

// Task 2.2: load the Kurnool map and show roads, ground, water and the dusk sky
// with a free fly-over camera.

const canvas = document.getElementById('gl');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Canvas #gl not found in index.html');

async function boot(gl: HTMLCanvasElement): Promise<void> {
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

  let map;
  try {
    map = await loadMap(`${import.meta.env.BASE_URL}map/kurnool.json`);
  } catch (err) {
    const detail = err instanceof MapLoadError ? err.message : `Unexpected error: ${String(err)}`;
    showError('Could not load the map', detail);
    return;
  }

  scene.add(buildGround(map));
  scene.add(buildWater(map));
  scene.add(buildRoads(map));
  scene.add(buildParks(map, quality));
  scene.add(buildBuildings(map, quality, quality.level === 'high' ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1));

  const world = new CollisionWorld(map);
  const keys = new Keyboard();
  const player = new OnFootPlayer(map.spawn.x, map.spawn.z, map.spawn.heading);
  scene.add(player.figure);
  const chase = new ChaseCamera(camera);
  chase.snap(player, world);

  const free = new FreeCamera(camera, gl);
  free.enabled = false;
  let mapView = false;

  hideStatus();
  const hint = document.getElementById('hint');
  const setHint = (): void => {
    if (!hint) return;
    hint.hidden = false;
    hint.textContent = mapView
      ? 'Map view: drag to move · right-drag or two fingers to turn · scroll or pinch to zoom · C to go back'
      : 'W/S or arrows to walk · A/D to turn · Shift to run · C for map view';
  };
  setHint();

  if (import.meta.env.DEV) Object.assign(window, { __three: { renderer, scene, camera }, __game: { player, world, map } });

  const fps = createFpsMeter(quality.level);
  const timer = new THREE.Timer();
  renderer.setAnimationLoop((ts) => {
    timer.update(ts);
    const dt = Math.min(timer.getDelta(), 1 / 30);
    if (keys.consume('KeyC')) {
      mapView = !mapView;
      free.enabled = mapView;
      if (mapView) free.lookAt(player.x, player.z, 400, player.a + Math.PI);
      else chase.snap(player, world);
      setHint();
    }
    if (mapView) {
      free.update(dt);
    } else {
      player.update(dt, keys.move(), world);
      chase.update(dt, player, world);
    }
    keys.endFrame();
    sky.update(camera);
    renderer.render(scene, camera);
    fps.frame(ts);
  });
}

void boot(canvas);
