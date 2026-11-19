import * as THREE from 'three';

// Dusk look ported from reference/port-meridian-demo.html: gradient sky dome,
// low sun disc, warm fog, hemisphere + directional light.
// Light intensities are higher than the demo's because current Three.js uses
// physical light units (see DECISIONS.md 2026-11-11).

export const FOG_COLOR = 0xf0a584;

// Fog at street level, as in the demo (far distance comes from the quality
// setting). It is pushed out as the camera rises.
const FOG_NEAR = 90;

export interface Sky {
  /** Keep the dome on the camera and fit fog and clip planes to its height. */
  update(camera: THREE.PerspectiveCamera): void;
}

export function createSky(scene: THREE.Scene, renderer: THREE.WebGLRenderer, fogFar: number): Sky {
  const FOG_FAR = fogFar;
  renderer.setClearColor(FOG_COLOR);
  const fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
  scene.fog = fog;

  scene.add(new THREE.HemisphereLight(0x9a96e0, 0xd68f6c, 2.4));
  const sun = new THREE.DirectionalLight(0xffc49a, 2.2);
  sun.position.set(-0.5, 0.35, -0.85);
  scene.add(sun);

  const group = new THREE.Group();
  scene.add(group);

  const R = 1000;
  const dome = new THREE.SphereGeometry(R, 32, 20);
  const pos = dome.attributes.position;
  const stops: [number, number][] = [
    [-1, 0xf0a584],
    [0.02, 0xf0a584],
    [0.13, 0xe9748f],
    [0.38, 0x6c53a2],
    [1, 0x1c2050],
  ];
  const a = new THREE.Color();
  const b = new THREE.Color();
  const cols: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / R;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const f = THREE.MathUtils.clamp((t - stops[k][0]) / (stops[k + 1][0] - stops[k][0]), 0, 1);
    a.setHex(stops[k][1]);
    b.setHex(stops[k + 1][1]);
    a.lerp(b, f);
    cols.push(a.r, a.g, a.b);
  }
  dome.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const sky = new THREE.Mesh(
    dome,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.renderOrder = -2;
  sky.frustumCulled = false;
  group.add(sky);

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(64, 40),
    new THREE.MeshBasicMaterial({ color: 0xffe6b8, fog: false, depthWrite: false }),
  );
  disc.position.set(-470, 95, -790);
  disc.lookAt(0, 0, 0);
  disc.renderOrder = -1;
  disc.frustumCulled = false;
  group.add(disc);

  return {
    update(camera) {
      group.position.copy(camera.position);
      const h = Math.max(0, camera.position.y);
      fog.near = FOG_NEAR + h * 1.5;
      fog.far = FOG_FAR + h * 3;
      // Near plane grows with height so road layers stay crisp from high up.
      const near = THREE.MathUtils.clamp(h * 0.01, 0.3, 20);
      const far = Math.max(1300, fog.far + 600);
      if (camera.near !== near || camera.far !== far) {
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();
      }
    },
  };
}
