import * as THREE from 'three';
import { loadMap, MapLoadError } from './map/loadMap';
import { buildGround } from './map/ground';
import { buildWater } from './map/water';
import { buildRoads } from './map/roads';
import { createSky } from './world/sky';
import { FreeCamera } from './player/freeCamera';
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, 0.5, 1300);
  const sky = createSky(scene, renderer);

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

  const free = new FreeCamera(camera, gl);
  free.lookAt(map.spawn.x, map.spawn.z, 1400, 0);

  hideStatus();
  const hint = document.getElementById('hint');
  if (hint) hint.hidden = false;

  if (import.meta.env.DEV) Object.assign(window, { __three: { renderer, scene, camera } });

  const fps = createFpsMeter();
  const timer = new THREE.Timer();
  renderer.setAnimationLoop((ts) => {
    timer.update(ts);
    const dt = Math.min(timer.getDelta(), 1 / 30);
    free.update(dt);
    sky.update(camera);
    renderer.render(scene, camera);
    fps.frame(ts);
  });
}

void boot(canvas);
