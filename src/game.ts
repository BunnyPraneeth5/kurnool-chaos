import type * as THREE from 'three';
import type { MapData } from './map/types';
import { CollisionWorld } from './map/collision';
import { RoadIndex } from './map/roadIndex';
import { Keyboard, type MoveInput } from './player/input';
import { OnFootPlayer, PLAYER_RADIUS } from './player/onFoot';
import { ChaseCamera } from './player/chaseCamera';
import { FreeCamera } from './player/freeCamera';
import { Vehicle, type Bumper } from './vehicles/vehicle';
import { spawnParkedCars } from './vehicles/parked';
import { TouchControls } from './ui/touch';
import { Hud } from './ui/hud';

// Local game state: walking or driving, getting in and out, unstuck, map view.

const ENTER_RANGE = 4.5; // m from a car to get in
const MAX_EXIT_SPEED = 4; // m/s
const PLAYER_CAR_GAP = 2.1; // on foot, you cannot walk into a car

export class Game {
  readonly world: CollisionWorld;
  readonly roads: RoadIndex;
  readonly player: OnFootPlayer;
  readonly vehicles: Vehicle[];
  car: Vehicle | null = null;
  /** Friends' cars (set by the room code each frame): solid, cannot be pushed. */
  extraCars: readonly Bumper[] = [];
  private mapView = false;
  private readonly keys = new Keyboard();
  private readonly touch = new TouchControls();
  private readonly hud = new Hud();
  private readonly chase: ChaseCamera;
  private readonly free: FreeCamera;
  private readonly hint = document.getElementById('hint');
  private nearCar: Vehicle | null = null;

  constructor(
    readonly map: MapData,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    canvas: HTMLCanvasElement,
    shirt?: number,
  ) {
    this.world = new CollisionWorld(map);
    this.roads = new RoadIndex(map);
    this.player = new OnFootPlayer(map.spawn.x, map.spawn.z, map.spawn.heading, shirt);
    scene.add(this.player.figure);
    this.vehicles = spawnParkedCars(map.spawn.x, map.spawn.z, this.roads, this.world);
    for (const v of this.vehicles) scene.add(v.mesh);
    this.chase = new ChaseCamera(camera);
    this.chase.snap(this.player, this.world);
    this.free = new FreeCamera(camera, canvas);
    this.free.enabled = false;
    this.refreshLabels();
  }

  update(dt: number): void {
    if (this.keys.consume('KeyC')) this.toggleMapView();
    if (this.mapView) {
      this.free.update(dt);
      this.keys.endFrame();
      this.hud.update(dt);
      return;
    }

    const inp: MoveInput = this.touch.merge(this.keys.move());
    if (this.keys.consume('KeyE') || this.touch.consumeAction()) this.action();
    if (this.keys.consume('KeyR') || this.touch.consumeUnstuck()) this.unstuck();

    if (this.car) {
      const crash = this.car.drive(dt, inp, this.world, this.solidCars());
      if (crash > 0) this.chase.shake(crash);
      this.player.x = this.car.x;
      this.player.z = this.car.z;
      this.player.a = this.car.a;
      this.chase.update(dt, this.car, this.world, true);
    } else {
      this.player.update(dt, inp, this.world);
      this.keepOffCars();
      this.chase.update(dt, this.player, this.world);
      this.findNearCar();
    }
    this.hud.speed(!!this.car, this.car ? this.car.speed : 0);
    this.hud.update(dt);
    this.keys.endFrame();
  }

  toast(msg: string): void {
    this.hud.toast(msg);
  }

  /** Put the on-foot player somewhere else (rooms spread players out at the start). */
  placeAt(x: number, z: number, heading: number): void {
    const r = this.world.collide(x, z, PLAYER_RADIUS);
    this.player.x = r.x;
    this.player.z = r.z;
    this.player.a = heading;
    this.player.update(0, { thr: 0, steer: 0, hand: false }, this.world);
    this.chase.snap(this.player, this.world);
  }

  private toggleMapView(): void {
    this.mapView = !this.mapView;
    this.free.enabled = this.mapView;
    document.body.classList.toggle('mapview', this.mapView);
    const t = this.car ?? this.player;
    if (this.mapView) this.free.lookAt(t.x, t.z, 400, t.a + Math.PI);
    else this.chase.snap(t, this.world, !!this.car);
    this.refreshLabels();
  }

  private action(): void {
    if (this.car) {
      const c = this.car;
      if (Math.abs(c.speed) > MAX_EXIT_SPEED) {
        this.hud.toast('Slow down first');
        return;
      }
      c.park();
      // Driver's door is on the right (Indian cars are right-hand drive).
      const r = this.world.collide(c.x - Math.cos(c.a) * 2.5, c.z + Math.sin(c.a) * 2.5, 0.5);
      this.player.x = r.x;
      this.player.z = r.z;
      this.player.a = c.a;
      this.player.figure.visible = true;
      this.car = null;
      this.chase.snap(this.player, this.world);
    } else {
      this.findNearCar();
      const c = this.nearCar;
      if (!c) return;
      c.kind = 'player';
      c.va = c.a;
      this.car = c;
      this.player.figure.visible = false;
      this.nearCar = null;
    }
    this.refreshLabels();
  }

  /** Put the player (or their car) back on the nearest road, facing along it. */
  private unstuck(): void {
    const t = this.car ?? this.player;
    const p = this.roads.nearest(t.x, t.z, t.a);
    if (!p) {
      this.hud.toast('No road nearby');
      return;
    }
    if (this.car) {
      const c = this.car;
      c.x = p.x;
      c.z = p.z;
      c.a = c.va = p.heading;
      c.speed = 0;
      c.pushOut(this.world);
      c.sync();
      this.chase.snap(c, this.world, true);
    } else {
      const r = this.world.collide(p.x, p.z, 0.5);
      this.player.x = r.x;
      this.player.z = r.z;
      this.player.a = p.heading;
      this.player.update(0, { thr: 0, steer: 0, hand: false }, this.world);
      this.chase.snap(this.player, this.world);
    }
    this.hud.toast('Back on the road');
  }

  /** Where this player is, for the network (ARCHITECTURE: broadcast event `s`). */
  netState(): { x: number; z: number; y: number; h: number; v: number; mode: 'car' | 'foot'; car: number } {
    const c = this.car;
    if (c) return { x: c.x, z: c.z, y: c.y, h: c.a, v: c.speed, mode: 'car', car: this.vehicles.indexOf(c) };
    const p = this.player;
    return { x: p.x, z: p.z, y: p.y, h: p.a, v: p.speed, mode: 'foot', car: -1 };
  }

  /** Visible parked cars (a friend may be driving our copy of one) and friends' cars. */
  private solidCars(): Bumper[] {
    const list: Bumper[] = this.vehicles.filter((v) => v !== this.car && v.mesh.visible);
    return list.concat(this.extraCars);
  }

  private keepOffCars(): void {
    const p = this.player;
    for (const c of this.solidCars()) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d < PLAYER_CAR_GAP && d > 1e-3) {
        p.x = c.x + (dx / d) * PLAYER_CAR_GAP;
        p.z = c.z + (dz / d) * PLAYER_CAR_GAP;
      }
    }
  }

  private findNearCar(): void {
    let best: Vehicle | null = null;
    let bd = ENTER_RANGE;
    for (const c of this.vehicles) {
      if (!c.mesh.visible) continue; // a friend is driving it
      const d = Math.hypot(c.x - this.player.x, c.z - this.player.z);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (best !== this.nearCar) {
      this.nearCar = best;
      this.refreshLabels();
    }
  }

  private refreshLabels(): void {
    const inCar = !!this.car;
    this.touch.bAct.textContent = inCar ? 'Get out' : 'Get in';
    this.touch.bAct.classList.toggle('ready', !inCar && !!this.nearCar);
    this.touch.bHand.textContent = inCar ? 'Drift' : 'Run';
    if (!this.hint) return;
    this.hint.hidden = false;
    if (this.mapView) {
      this.hint.textContent = 'Map view: drag to move · right-drag to turn · scroll to zoom · C to go back';
    } else if (inCar) {
      this.hint.textContent = 'W/S gas and brake · A/D steer · Space drift · E get out · R unstuck · C map view';
    } else {
      const near = this.nearCar ? 'E get in · ' : '';
      this.hint.textContent = `W/S walk · A/D turn · Shift run · ${near}R unstuck · C map view`;
    }
  }
}
