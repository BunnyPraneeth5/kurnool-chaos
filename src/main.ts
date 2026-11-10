import * as THREE from 'three';

// Task 1.1 scaffold: a spinning cube under dusk colours, to prove the
// build, the dev server and phone access all work.

const canvas = document.getElementById('gl');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Canvas #gl not found in index.html');
}

const FOG_COLOR = 0xf0a584;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(FOG_COLOR);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(FOG_COLOR, 20, 80);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
camera.position.set(0, 1.5, 5);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0x9a96e0, 0xd68f6c, 2.5));
const sun = new THREE.DirectionalLight(0xffc49a, 2.5);
sun.position.set(-0.5, 0.35, 0.85);
scene.add(sun);

const cube = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.MeshLambertMaterial({ color: 0xf2c14e }));
scene.add(cube);

function resize(): void {
  const w = window.innerWidth || 800;
  const h = window.innerHeight || 600;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const timer = new THREE.Timer();
renderer.setAnimationLoop((ts) => {
  timer.update(ts);
  const dt = Math.min(timer.getDelta(), 1 / 30);
  cube.rotation.x += dt * 0.6;
  cube.rotation.y += dt * 0.9;
  renderer.render(scene, camera);
});
