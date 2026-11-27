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
import { VEHICLES, type VehicleType } from './vehicles/params';
import type { Pose } from './net/interp';
import { Life } from './ai/life';
import type { TrafficCar } from './ai/traffic';
import { Minimap } from './ui/minimap';
import { nearestStation } from './map/police';
import { settings, STEER_SCALE } from './ui/settings';
import { stats } from './ui/stats';
import { sound } from './audio/sound';
import { ChaosPoints, CHAOS } from './modes/chaosPoints';
import type { ModeId } from './modes/types';
import { BOOSTS } from './modes/chorPolice';
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
  /** Riding in a friend's vehicle (task H.4). */
  ride: { driver: string; seat: number; type: VehicleType } | null = null;
  /** Where a friend is drawn (set by the room code). */
  posePf: (id: string) => Pose | null = () => null;
  /** Ask for a seat in a friend's vehicle: the seat number, or why not (set by the room code). */
  askRide: (driver: string) => number | string = () => 'Riding along works in rooms';
  private rideLast: Pose | null = null;
  /** Pieces we broke, to tell friends (set by the room code). */
  onBreak: ((ids: number[]) => void) | null = null;
  /** Chaos points hook (H.10). */
  onRanRed: ((seen: boolean) => void) | null = null;
  /** Chaos points (H.10). */
  readonly chaos = new ChaosPoints();
  private readonly nearMiss = new Map<TrafficCar, number>();
  private driftT = 0;
  private notDriftT = 0;
  /** Boosts left this round (Chor–Police). */
  boostsLeft = 0;
  private nearFriend: Bumper | null = null;
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
  private readonly camera: THREE.PerspectiveCamera;
  private readonly onFootBody: Bumper;

  constructor(
    readonly map: MapData,
    private readonly scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    canvas: HTMLCanvasElement,
    shirt: number | undefined,
    opts: { traffic: number; shadows: boolean; pedestrians: number },
  ) {
    this.world = new CollisionWorld(map);
    this.roads = new RoadIndex(map);
    this.player = new OnFootPlayer(map.spawn.x, map.spawn.z, map.spawn.heading, shirt);
    scene.add(this.player.figure);
    this.shirt = shirt ?? 0xffc247;
    this.vehicles = spawnParkedVehicles(map.spawn.x, map.spawn.z, this.roads, this.world);
    this.shared = this.vehicles.slice();
    for (const v of this.vehicles) scene.add(v.mesh);
    this.camera = camera;
    this.chase = new ChaseCamera(camera);
    this.chase.snap(this.player, this.world);
    this.free = new FreeCamera(camera, canvas);
    this.free.enabled = false;
    this.life = new Life(map, scene, this.world, opts.traffic, opts.shadows, opts.pedestrians);
    this.life.traffic.onHonk = (c) => sound.honkAt(c.x, c.z, c.type);
    this.chaos.onChange = (d, label) => this.hud.chaosPop(d, label);
    this.onRanRed = () => this.chaos.add(CHAOS.redLight, 'Red light');
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
    if (unstuck && !still && !this.ride) this.unstuck();
    const boost = this.keys.consume('KeyB') || this.touch.consumeBoost();
    if (boost && !still && this.car && this.boostsLeft > 0 && this.car.boostT <= 0) {
      this.boostsLeft--;
      this.car.boostT = 3;
      sound.beep(880, 0.3, 'sawtooth');
      this.hud.toast(`BOOST! (${this.boostsLeft} left)`);
      this.refreshLabels();
    }
    const bx = (this.car ?? this.player).x, bz = (this.car ?? this.player).z;

    if (this.ride) {
      this.rideUpdate(dt);
    } else if (this.car) {
      const crash = this.car.drive(dt, inp, this.world, this.solidCars());
      if (crash > 0) {
        this.chase.shake(crash);
        stats.crashes++;
        sound.thud(crash * 2);
      }
      // Railings, fences and barricades we smashed (Phase R.1).
      if (this.car.broke.length) {
        const fresh = this.world.breakPieces(this.car.broke);
        this.car.broke.length = 0;
        if (fresh.length) {
          sound.thud(0.6);
          this.chase.shake(0.25);
          this.chaos.add(fresh.length * CHAOS.smash, 'Smash');
          this.onBreak?.(fresh);
        }
      }
      const hit = this.car.bumped;
      if (hit && (this.life.isCop(hit) || this.life.isTraffic(hit))) {
        if (this.life.crime(1, this.car)) this.hud.toast(this.life.isCop(hit) ? 'You hit a cop car' : 'Hit and run');
        // The crash halved our speed; points for how fast we hit.
        this.chaos.add(CHAOS.crash + Math.abs(this.car.speed) / 0.45, this.life.isCop(hit) ? 'Cop crash' : 'Crash');
      }
      this.chaosDriving(dt, inp);
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
    this.world.updateBreaks();
    this.updateLife(dt);
    this.updateSound(inp, still);
    this.hud.speed(!!this.car, this.car ? this.car.speed : 0);
    this.hud.update(dt);
    this.keys.endFrame();
  }

  private updateSound(inp: MoveInput, still: boolean): void {
    const cam = this.camera;
    const m = cam.matrixWorld.elements; // the camera looks down its -z axis
    const fx = -m[8], fz = -m[10];
    sound.setListener(cam.position.x, cam.position.z, Math.atan2(fx, fz));
    const c = this.car;
    sound.engine(c ? c.type : null, c ? c.speed : 0, c ? inp.thr : 0);
    sound.horn(!!c && !still && (this.keys.isDown('KeyH') || this.touch.hornDown), c ? c.type : null);
    const me = c ?? this.player;
    let near = Infinity;
    for (const cop of this.life.cops.cops) near = Math.min(near, Math.hypot(cop.x - me.x, cop.z - me.z));
    sound.siren(near);
    document.body.classList.toggle('driving', !!c);
  }

  private updateLife(dt: number): void {
    const me = this.car ?? this.player;
    const focus = { x: me.x, z: me.z, a: me.a, speed: this.car ? this.car.speed : 0, driving: !!this.car };
    const parked = this.vehicles.filter((v) => v !== this.car && v.mesh.visible);
    const moving: Bumper[] = [...this.extraCars, this.car ?? this.onFootBody];
    const ev = this.life.update(dt, focus, parked, moving);
    if (ev === 'busted') stats.busted++;
    if (ev === 'lost' || ev === 'cooler') {
      stats.copsEscaped++;
      this.chaos.add(CHAOS.escapePerStar, ev === 'lost' ? 'Cops lost' : 'Escaped a star');
    }
    this.chaos.heat(dt, this.life.cops.heat);
    this.hud.chaos(this.chaos.total);
    if (ev === 'busted') {
      sound.beep(160, 0.6, 'sawtooth');
      this.chaos.busted();
      this.busted();
    }
    if (this.life.peds.scared && this.life.crime(1, me)) this.hud.toast('Mind the people!', 'bad');
    const red = this.life.ranRed;
    if (red) {
      if (red.seen && this.life.crime(1, me)) this.hud.toast('Ran a red light: the police saw you', 'bad');
      this.onRanRed?.(red.seen);
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

  /**
   * Busted (task H.5): on foot outside the nearest police station. The vehicle stays where
   * you were caught (on friends' screens too); one borrowed from traffic is taken away.
   */
  private busted(): void {
    const me = this.car ?? this.player;
    const st = nearestStation(this.map, me.x, me.z);
    const c = this.car;
    if (!st) {
      // A map without police stations: just stop.
      if (c) c.speed = 0;
      this.hud.toast('Busted! Heat cleared', 'bad');
      return;
    }
    this.toFoot(st.x, st.z, st.a);
    if (c && !this.shared.includes(c)) {
      this.scene.remove(c.mesh);
      this.vehicles.splice(this.vehicles.indexOf(c), 1);
    }
    this.hud.toast(`Busted! Taken to ${st.name}`, 'bad');
  }

  toast(msg: string): void {
    this.hud.toast(msg);
  }

  /** Put the player in parked car `index` at a spot, stopped (game-round start). */
  driveCar(index: number, x: number, z: number, heading: number): void {
    const c = this.shared[index];
    if (!c) return;
    this.endRide();
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
    this.endRide();
    this.boostsLeft = 0;
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
    if (this.ride) {
      this.leaveRide();
      return;
    }
    if (!this.car && this.nearFriend?.id && this.nearFriendIsClosest()) {
      const id = this.nearFriend.id;
      const seat = this.askRide(id);
      if (typeof seat === 'string') {
        this.hud.toast(seat);
        return;
      }
      this.ride = { driver: id, seat, type: this.nearFriend.type };
      this.rideLast = this.posePf(id);
      this.player.figure.visible = false;
      this.nearFriend = null;
      this.nearCar = null;
      stats.rides++;
      this.refreshLabels();
      return;
    }
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

  /** Riding: follow the friend's vehicle; get out when they do or when they are gone. */
  private rideUpdate(dt: number): void {
    const r = this.ride!;
    const pose = this.posePf(r.driver);
    if (!pose || pose.mode === 'foot' || pose.mode === 'ride') {
      // Out next to where the driver now stands (the vehicle is beside them).
      if (pose) this.rideLast = { ...pose, v: 0 };
      this.leaveRide(pose ? 'Your driver got out' : 'Your driver is gone');
      return;
    }
    if (pose.mode !== r.type) r.type = pose.mode; // they changed vehicle
    this.rideLast = pose;
    const p = this.player;
    p.x = pose.x;
    p.z = pose.z;
    p.y = pose.y;
    p.a = pose.h;
    const t = VEHICLES[r.type];
    this.chase.update(dt, { x: pose.x, y: pose.y, z: pose.z, a: pose.h, speed: pose.v, camDist: t.camDist, camHeight: t.camHeight }, this.world, true);
  }

  /** Get out of a friend's vehicle, on foot beside it. */
  private leaveRide(why?: string): void {
    const last = this.rideLast;
    const r = this.ride;
    if (!r) return;
    if (!why && last && Math.abs(last.v) > MAX_EXIT_SPEED) {
      this.hud.toast('Wait till it slows down');
      return;
    }
    this.ride = null;
    this.rideLast = null;
    this.player.figure.visible = true;
    if (last) {
      // Out on the side of the seat (left seats to the left).
      const seat = r.seat;
      const left = seat % 2 === 1;
      const side = (VEHICLES[r.type].w / 2 + 1.2) * (left ? 1 : -1);
      this.placeAt(last.x + Math.cos(last.h) * side, last.z - Math.sin(last.h) * side, last.h);
    }
    if (why) this.hud.toast(why);
    this.refreshLabels();
  }

  /** Get out of a friend's vehicle because of a rule (seat taken, team changed). */
  stopRiding(why: string): void {
    this.leaveRide(why);
  }

  /** Stop riding without a message (teleports, round starts). */
  private endRide(): void {
    if (!this.ride) return;
    this.ride = null;
    this.rideLast = null;
    this.player.figure.visible = true;
  }

  private nearFriendIsClosest(): boolean {
    const f = this.nearFriend;
    if (!f) return false;
    const df = hullDistance(f, this.player.x, this.player.z).d;
    return !this.nearCar || df <= hullDistance(this.nearCar, this.player.x, this.player.z).d;
  }

  /** Near misses with traffic at speed, and drifting (chaos points). */
  private chaosDriving(dt: number, inp: MoveInput): void {
    const c = this.car;
    if (!c) return;
    const fast = Math.abs(c.speed) > 15;
    const sa = Math.sin(c.a), ca = Math.cos(c.a);
    for (const t of this.life.traffic.cars) {
      const dx = t.x - c.x, dz = t.z - c.z;
      if (Math.abs(dx) > 12 || Math.abs(dz) > 12) {
        this.nearMiss.delete(t);
        continue;
      }
      const d = hullDistance(t, c.x, c.z).d - c.t.w / 2;
      const seen = this.nearMiss.get(t);
      if (fast && d < 1.2) this.nearMiss.set(t, Math.min(seen ?? Infinity, d));
      // Passed it: the closest we came counts if we never touched.
      if (seen !== undefined && dx * sa + dz * ca < -(c.t.len + VEHICLES[t.type].len) / 2) {
        this.nearMiss.delete(t);
        if (seen > 0.05 && !this.car?.bumped) this.chaos.add(CHAOS.nearMiss, 'Near miss');
      }
    }
    const slide = Math.abs(Math.atan2(Math.sin(c.a - c.va), Math.cos(c.a - c.va)));
    if (inp.hand && Math.abs(c.speed) > 10 && slide > 0.3) {
      this.driftT += dt;
      this.notDriftT = 0;
    } else if (this.driftT > 0) {
      this.notDriftT += dt;
      if (this.notDriftT > 0.3) {
        if (this.driftT > 0.6) this.chaos.add(this.driftT * CHAOS.driftPerS, 'Drift');
        this.driftT = 0;
      }
    }
  }

  /** A game round starts for us (chaos round points start from 0). */
  startRound(mode: ModeId): void {
    this.chaos.startRound();
    this.boostsLeft = mode === 'chor' ? BOOSTS : 0;
    this.refreshLabels();
  }

  /** Get into a vehicle (on a bike you can be seen riding it). */
  private sit(c: Vehicle): void {
    sound.beep(420, 0.08);
    c.kind = 'player';
    this.car = c;
    this.player.figure.visible = false;
    this.nearCar = null;
    setRider(c.mesh, this.shirt);
  }

  /** Leave a vehicle parked where it is. */
  private leave(c: Vehicle): void {
    sound.beep(300, 0.08);
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
    this.endRide();
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
  netState(): { x: number; z: number; y: number; h: number; v: number; mode: 'foot' | VehicleType | 'ride'; car: number; ride?: { driver: string; seat: number } } {
    const r = this.ride;
    if (r) {
      const q = this.rideLast ?? this.player;
      const at = 'h' in q ? { x: q.x, z: q.z, y: q.y, h: q.h, v: q.v } : { x: q.x, z: q.z, y: q.y, h: q.a, v: 0 };
      return { ...at, mode: 'ride', car: -1, ride: { driver: r.driver, seat: r.seat } };
    }
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
    // Friends' vehicles: ride along.
    let friend: Bumper | null = null;
    let fd = ENTER_RANGE;
    for (const c of this.extraCars) {
      if (!c.id) continue;
      const d = hullDistance(c, this.player.x, this.player.z).d;
      if (d < fd) {
        fd = d;
        friend = c;
      }
    }
    if (best !== this.nearCar || !!friend !== !!this.nearFriend) {
      this.nearCar = best;
      this.nearFriend = friend;
      this.refreshLabels();
    }
    this.nearFriend = friend;
  }

  private refreshLabels(): void {
    const inCar = !!this.car || !!this.ride;
    const near = !inCar && (!!this.nearCar || !!this.nearFriend);
    this.touch.bAct.textContent = inCar ? 'Get out' : this.nearFriend && this.nearFriendIsClosest() ? 'Ride' : 'Get in';
    this.touch.bAct.classList.toggle('ready', near);
    this.touch.bHand.textContent = inCar ? 'Drift' : 'Run';
    this.touch.bBoost.textContent = `Boost ${this.boostsLeft}`;
    document.body.classList.toggle('boosts', this.boostsLeft > 0 && !!this.car);
    if (!this.hint) return;
    this.hint.hidden = false;
    if (this.mapView) {
      this.hint.textContent = 'Map view: drag to move · right-drag to turn · scroll to zoom · C to go back';
    } else if (this.ride) {
      this.hint.textContent = 'Riding with a friend · E get out · C map view · Esc menu · G guide';
    } else if (inCar) {
      this.hint.textContent = `W/S gas and brake · A/D steer · Space drift · H horn · ${this.boostsLeft > 0 ? `B boost (${this.boostsLeft}) · ` : ''}E get out · R unstuck · C map view · Esc menu · G guide`;
    } else {
      const hint = this.nearFriend && this.nearFriendIsClosest() ? 'E ride along · ' : this.nearCar ? 'E get in · ' : '';
      this.hint.textContent = `W/S walk · A/D turn · Shift run · ${hint}R unstuck · C map view · Esc menu · G guide`;
    }
  }
}
