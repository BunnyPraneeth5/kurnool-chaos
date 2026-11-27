import type * as THREE from 'three';
import type { MapData } from './map/types';
import { CollisionWorld } from './map/collision';
import { RoadIndex } from './map/roadIndex';
import { Keyboard, type MoveInput } from './player/input';
import { OnFootPlayer, PLAYER_RADIUS } from './player/onFoot';
import { ChaseCamera } from './player/chaseCamera';
import { FreeCamera } from './player/freeCamera';
import { Vehicle } from './vehicles/vehicle';
import { spawnParkedVehicles } from './vehicles/parked';
import { setRider } from './vehicles/models';
import { hullDistance, type Bumper } from './vehicles/hull';
import type { VehicleType } from './vehicles/params';
import { Life } from './ai/life';
import type { TrafficCar } from './ai/traffic';
import { Minimap } from './ui/minimap';
import { settings, STEER_SCALE } from './ui/settings';
import { stats } from './ui/stats';
import { TouchControls } from './ui/touch';
import { Hud } from './ui/hud';

// Local game state: walking or driving, getting in and out, unstuck, map view.

const ENTER_RANGE = 3.2; // m from a vehicle's side to get in
const MAX_EXIT_SPEED = 4; // m/s
const PLAYER_GAP = 0.7; // m; on foot, you cannot walk into a vehicle
const ABANDON_M = 400; // vehicles taken from traffic and left this far behind are tidied away

export class Game {
  readonly world: CollisionWorld;
  readonly roads: RoadIndex;
  readonly player: OnFootPlayer;
  /** Every vehicle you can drive: the shared parked ones first, then any taken from traffic. */
  readonly vehicles: Vehicle[];
  /** The parked vehicles that exist on every screen, by the same number. */
  readonly shared: readonly Vehicle[];
  car: Vehicle | null = null;
  /** Friends' cars (set by the room code each frame): solid, cannot be pushed. */
  extraCars: readonly Bumper[] = [];
  /** Held still (game-round countdown): no driving, getting in or out, or unstuck. */
  locked = false;
  /** The menu is open: stand still and ignore the controls (rooms keep running). */
  held = false;
  /** Traffic, cops and heat (local to this screen). */
  readonly life: Life;
  readonly minimap: Minimap;
  private mapView = false;
  private readonly keys = new Keyboard();
  private readonly touch = new TouchControls();
  private readonly hud = new Hud();
  private readonly chase: ChaseCamera;
  private readonly free: FreeCamera;
  private readonly hint = document.getElementById('hint');
  private nearCar: Vehicle | TrafficCar | null = null;
  private readonly shirt: number;
  private readonly onFootBody: Bumper;

  constructor(
    readonly map: MapData,
    private readonly scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    canvas: HTMLCanvasElement,
    shirt: number | undefined,
    opts: { traffic: number; shadows: boolean },
  ) {
    this.world = new CollisionWorld(map);
    this.roads = new RoadIndex(map);
    this.player = new OnFootPlayer(map.spawn.x, map.spawn.z, map.spawn.heading, shirt);
    scene.add(this.player.figure);
    this.shirt = shirt ?? 0xffc247;
    this.vehicles = spawnParkedVehicles(map.spawn.x, map.spawn.z, this.roads, this.world);
    this.shared = this.vehicles.slice();
    for (const v of this.vehicles) scene.add(v.mesh);
    this.chase = new ChaseCamera(camera);
    this.chase.snap(this.player, this.world);
    this.free = new FreeCamera(camera, canvas);
    this.free.enabled = false;
    this.life = new Life(map, scene, this.world, opts.traffic, opts.shadows);
    this.minimap = new Minimap(map, camera);
    // Traffic stops for you when you walk in front of it.
    const p = this.player;
    this.onFootBody = {
      get x() { return p.x; },
      get z() { return p.z; },
      get a() { return p.a; },
      type: 'bike',
    };
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

    const raw: MoveInput = this.touch.merge(this.keys.move());
    raw.steer *= STEER_SCALE[settings().steering];
    const still = this.locked || this.held;
    const inp: MoveInput = still ? { thr: 0, steer: 0, hand: true } : raw;
    const act = this.keys.consume('KeyE') || this.touch.consumeAction();
    const unstuck = this.keys.consume('KeyR') || this.touch.consumeUnstuck();
    if (act && !still) this.action();
    if (unstuck && !still) this.unstuck();
    const bx = (this.car ?? this.player).x, bz = (this.car ?? this.player).z;

    if (this.car) {
      const crash = this.car.drive(dt, inp, this.world, this.solidCars());
      if (crash > 0) {
        this.chase.shake(crash);
        stats.crashes++;
      }
      const hit = this.car.bumped;
      if (hit && (this.life.isCop(hit) || this.life.isTraffic(hit))) {
        if (this.life.crime(1, this.car)) this.hud.toast(this.life.isCop(hit) ? 'You hit a cop car' : 'Hit and run');
      }
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
    // Stats: distance (teleports do not count) and top speed.
    const me = this.car ?? this.player;
    const moved = Math.hypot(me.x - bx, me.z - bz);
    if (moved < 5) stats.distance[this.car ? this.car.type : 'foot'] += moved;
    if (this.car) stats.topSpeed = Math.max(stats.topSpeed, Math.abs(this.car.speed));
    this.updateLife(dt);
    this.hud.speed(!!this.car, this.car ? this.car.speed : 0);
    this.hud.update(dt);
    this.keys.endFrame();
  }

  private updateLife(dt: number): void {
    const me = this.car ?? this.player;
    const focus = { x: me.x, z: me.z, speed: this.car ? this.car.speed : 0 };
    const parked = this.vehicles.filter((v) => v !== this.car && v.mesh.visible);
    const moving: Bumper[] = [...this.extraCars, this.car ?? this.onFootBody];
    const ev = this.life.update(dt, focus, parked, moving);
    if (ev === 'busted') stats.busted++;
    if (ev === 'lost' || ev === 'cooler') stats.copsEscaped++;
    if (ev === 'busted') {
      if (this.car) this.car.speed = 0;
      this.hud.toast('Busted! Heat cleared', 'bad');
    } else if (ev === 'lost') this.hud.toast('Cops lost');
    else if (ev === 'cooler') this.hud.toast('Heat dropping');
    this.hud.heat(this.life.cops.heat, this.life.cops.bustLevel);
    // Vehicles taken from traffic and left far behind.
    for (let i = this.vehicles.length - 1; i >= this.shared.length; i--) {
      const v = this.vehicles[i];
      if (v !== this.car && Math.hypot(v.x - me.x, v.z - me.z) > ABANDON_M) {
        this.scene.remove(v.mesh);
        this.vehicles.splice(i, 1);
      }
    }
    if (settings().minimap) this.minimap.draw(me.x, me.z, this.life.cops.cops);
    this.minimap.setVisible(settings().minimap);
  }

  toast(msg: string): void {
    this.hud.toast(msg);
  }

  /** Put the player in parked car `index` at a spot, stopped (game-round start). */
  driveCar(index: number, x: number, z: number, heading: number): void {
    const c = this.shared[index];
    if (!c) return;
    this.life.traffic.clearNear(x, z, 25);
    if (this.car && this.car !== c) this.leave(this.car);
    c.mesh.visible = true;
    this.sit(c);
    this.nearCar = null;
    this.teleport(x, z, heading);
    this.refreshLabels();
  }

  /** Put the player on foot at a spot; a car they were in stays parked where it is. */
  toFoot(x: number, z: number, heading: number): void {
    if (this.car) {
      this.leave(this.car);
      this.car = null;
      this.player.figure.visible = true;
    }
    this.teleport(x, z, heading);
    this.refreshLabels();
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

  /** Show a place in map view (guide: tap a place). */
  viewPlace(x: number, z: number): void {
    if (!this.mapView) this.toggleMapView();
    this.free.lookAt(x, z, 350, 0);
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
      this.leave(c);
      // Driver's door is on the right (Indian cars are right-hand drive).
      const side = c.t.w / 2 + 1.5;
      const r = this.world.collide(c.x - Math.cos(c.a) * side, c.z + Math.sin(c.a) * side, 0.5, c.y + 0.3);
      this.player.x = r.x;
      this.player.z = r.z;
      this.player.a = c.a;
      this.player.figure.visible = true;
      this.car = null;
      this.chase.snap(this.player, this.world);
    } else {
      this.findNearCar();
      const near = this.nearCar;
      if (!near) return;
      let c: Vehicle;
      if (near instanceof Vehicle) c = near;
      else {
        // Taking a vehicle out of traffic: the cops notice.
        c = new Vehicle(near.type, near.colour, near.x, near.z, near.a);
        c.y = near.y;
        c.settle(this.world);
        c.sync();
        this.life.traffic.remove(near);
        this.vehicles.push(c);
        this.scene.add(c.mesh);
        stats.borrowed++;
        this.life.crime(1, c);
        this.hud.toast(this.life.calm ? `${c.t.name} borrowed` : `${c.t.name} borrowed. Cops noticed`, this.life.calm ? undefined : 'bad');
      }
      c.va = c.a;
      this.sit(c);
    }
    this.refreshLabels();
  }

  /** Get into a vehicle (on a bike you can be seen riding it). */
  private sit(c: Vehicle): void {
    c.kind = 'player';
    this.car = c;
    this.player.figure.visible = false;
    this.nearCar = null;
    setRider(c.mesh, this.shirt);
  }

  /** Leave a vehicle parked where it is. */
  private leave(c: Vehicle): void {
    setRider(c.mesh, null);
    c.park();
  }

  /** Put the player (or their car) back on the nearest road, facing along it. */
  private unstuck(): void {
    const t = this.car ?? this.player;
    const p = this.roads.nearest(t.x, t.z, t.a);
    if (!p) {
      this.hud.toast('No road nearby');
      return;
    }
    this.teleport(p.x, p.z, p.heading);
    this.hud.toast('Back on the road');
  }

  /** Move the player, or their car with them in it, stopped, pushed clear of walls. */
  teleport(x: number, z: number, heading: number): void {
    if (this.mapView) this.toggleMapView();
    const c = this.car;
    if (!c) {
      this.placeAt(x, z, heading);
      return;
    }
    c.x = x;
    c.z = z;
    c.a = c.va = heading;
    c.speed = 0;
    c.pushOut(this.world);
    c.settle(this.world); // straight onto the ground there (hills and valleys)
    c.sync();
    this.player.x = c.x;
    this.player.z = c.z;
    this.chase.snap(c, this.world, true);
  }

  /** Where this player is, for the network (ARCHITECTURE: broadcast event `s`). */
  netState(): { x: number; z: number; y: number; h: number; v: number; mode: 'foot' | VehicleType; car: number } {
    const c = this.car;
    if (c) {
      const i = this.shared.indexOf(c);
      return { x: c.x, z: c.z, y: c.y, h: c.a, v: c.speed, mode: c.type, car: i >= 0 ? i : -2 };
    }
    const p = this.player;
    return { x: p.x, z: p.z, y: p.y, h: p.a, v: p.speed, mode: 'foot', car: -1 };
  }

  /** Visible parked cars (a friend may be driving our copy of one) and friends' cars. */
  private solidCars(): Bumper[] {
    const list: Bumper[] = this.vehicles.filter((v) => v !== this.car && v.mesh.visible);
    return list.concat(this.extraCars, this.life.solid());
  }

  private keepOffCars(): void {
    const p = this.player;
    for (const c of this.solidCars()) {
      const near = hullDistance(c, p.x, p.z);
      if (near.d >= PLAYER_GAP) continue;
      const dx = p.x - near.cx;
      const dz = p.z - near.cz;
      const d = Math.hypot(dx, dz);
      if (d < 1e-3) continue;
      const out = d + PLAYER_GAP - near.d;
      p.x = near.cx + (dx / d) * out;
      p.z = near.cz + (dz / d) * out;
    }
  }

  private findNearCar(): void {
    let best: Vehicle | TrafficCar | null = null;
    let bd = ENTER_RANGE;
    for (const c of [...this.vehicles, ...this.life.traffic.cars]) {
      if (!c.mesh.visible) continue; // a friend is driving it
      const d = hullDistance(c, this.player.x, this.player.z).d;
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
      this.hint.textContent = 'W/S gas and brake · A/D steer · Space drift · E get out · R unstuck · C map view · Esc menu · G guide';
    } else {
      const near = this.nearCar ? 'E get in · ' : '';
      this.hint.textContent = `W/S walk · A/D turn · Shift run · ${near}R unstuck · C map view · Esc menu · G guide`;
    }
  }
}
