import * as THREE from 'three';
import { btn, h, type MenuPage } from './menu';
import { VEHICLES, VEHICLE_TYPES, vehicleColour, type VehicleType } from '../vehicles/params';
import { buildVehicleMesh, setRider } from '../vehicles/models';
import type { MapData } from '../map/types';
import { LOBBY_NAME_EN, LOBBY_NAME_TE, lobbyPin } from '../modes/lobby';
import { loadTeluguFont } from '../util/fonts';

// The in-game guide (TASKS H.3): How to play, Vehicles, Controls, Places, People, Game
// modes and Other, as sub-pages of the menu (also opened from the start screen). Vehicle
// numbers come from params.ts and places from the map, so the guide stays true.

export interface GuideDeps {
  /** The map once it has loaded (places come from it). */
  map: () => MapData | null;
  /** Used to draw the vehicle pictures. */
  renderer: THREE.WebGLRenderer;
  /** In the game: close the menu and show this spot in map view. Null on the start screen. */
  showPlace: ((x: number, z: number) => void) | null;
}

type Section = { id: string; title: string; build: (d: GuideDeps) => HTMLElement[] };

const P = (text: string): HTMLParagraphElement => h('p', '', text);
const LIST = (items: string[]): HTMLUListElement => {
  const ul = h('ul');
  for (const t of items) ul.append(h('li', '', t));
  return ul;
};

const SECTIONS: Section[] = [
  {
    id: 'play',
    title: 'How to play',
    build: () => [
      h('h2', '', 'How to play'),
      P('Kurnool Chaos is the real Kurnool street map in low poly, at dusk. Walk, borrow any vehicle and do what you like: race your friends, explore the city, or make trouble and run from the cops.'),
      LIST([
        'Play alone, or create a room and share the link: up to 8 friends, no login.',
        'Rooms meet on top of Jagannatha Gattu. The host picks a game mode, everyone taps Ready, and a timed round starts down in the city. After the results you are back on the hill.',
        'Between rounds it is free roam: drive anywhere in the city.',
        'Walk up to a parked vehicle or one in traffic and get in. Taking one from traffic brings the cops.',
        'Stuck? Unstuck puts you back on the nearest road.',
        'The minimap (top right) turns with your view; tap it to see the whole city.',
      ]),
    ],
  },
  {
    id: 'vehicles',
    title: 'Vehicles',
    build: (d) => [
      h('h2', '', 'Vehicles'),
      P('Five kinds, each with its own handling. Seats include the driver; in a room, friends can ride in the other seats.'),
      ...VEHICLE_TYPES.map((t) => vehicleCard(t, d.renderer)),
      P('Near the start at Raj Vihar: 8 cars (rooms park them on Jagannatha Gattu), 2 autos, 2 bikes, a bus and a lorry. Traffic has all five.'),
    ],
  },
  {
    id: 'controls',
    title: 'Controls',
    build: () => {
      const keys: [string, string][] = [
        ['W / ↑', 'Walk forward, or accelerate'],
        ['S / ↓', 'Walk back, or brake and reverse'],
        ['A D / ← →', 'Turn or steer'],
        ['Shift', 'Run (on foot)'],
        ['Space', 'Handbrake and drift'],
        ['H', 'Horn (in a vehicle)'],
        ['E', 'Get in or out'],
        ['R', 'Unstuck: back to the nearest road'],
        ['C', 'Map view (fly over the city), C again to go back'],
        ['T / Enter', 'Chat (in a room)'],
        ['Esc', 'Menu'],
        ['G', 'This guide'],
      ];
      const table = h('table', 'keys');
      for (const [k, what] of keys) {
        const tr = h('tr');
        const th = h('th');
        th.append(h('kbd', '', k));
        tr.append(th, h('td', '', what));
        table.append(tr);
      }
      return [
        h('h2', '', 'Controls'),
        h('h3', '', 'Keyboard'),
        table,
        h('h3', '', 'Phone'),
        LIST([
          'Left thumb: the joystick. Up and down walk or drive, left and right turn.',
          'Right thumb: Get in / Get out (turns gold when a vehicle is close), Run on foot or Drift in a vehicle, Horn (while driving), Unstuck.',
          'Menu button top left; tap the minimap for the whole city.',
        ]),
        P('The Steering setting (Menu → Settings) makes turning gentler or quicker.'),
      ];
    },
  },
  {
    id: 'places',
    title: 'Places',
    build: (d) => {
      const map = d.map();
      const out: HTMLElement[] = [h('h2', '', 'Places'), P('Real Kurnool landmarks. Names in English and Telugu.' + (d.showPlace ? ' Tap one to see it in map view.' : ''))];
      if (!map) {
        out.push(P('Places appear once the map has loaded.'));
        return out;
      }
      void loadTeluguFont();
      const list = h('div', 'places');
      const place = (en: string, te: string, note: string, x: number, z: number): void => {
        const b = h(d.showPlace ? 'button' : 'div', 'place');
        if (b instanceof HTMLButtonElement) {
          b.type = 'button';
          b.addEventListener('click', () => d.showPlace?.(x, z));
        }
        b.append(h('b', '', en), h('span', 'te', te), h('small', '', note));
        list.append(b);
      };
      for (const l of map.landmarks) place(l.nameEn, l.nameTe, PLACE_NOTES[l.id] ?? '', l.x, l.z);
      place(LOBBY_NAME_EN, LOBBY_NAME_TE, 'The hill where rooms meet, 153 m above Raj Vihar. Drive down the IIITDM road into the city.', ...lobbyPin(map));
      const rw = map.airport.runway;
      place('Kurnool Airport', 'కర్నూలు విమానాశ్రయం', 'Pulled in close to the city and linked by a highway from NH40 in the south-east. Drive down the runway; planes are coming later.', rw.x, rw.z);
      for (const s of map.police ?? []) place(s.name, 'పోలీస్ స్టేషన్', 'Police station: busted players are brought here.', s.x, s.z);
      out.push(list);
      return out;
    },
  },
  {
    id: 'people',
    title: 'People',
    build: () => [
      h('h2', '', 'People'),
      LIST([
        'You: a figure in your colour on foot; your colour also marks you on friends’ screens.',
        'Friends: name tags over their heads or vehicles and dots on the minimap, each in their colour. Chat and emotes show as speech bubbles.',
        'The host: the first to join a room (badge in the player list). Picks and starts game modes and can remove a player. If the host leaves, the next one takes over.',
        'Traffic drivers: autos, bikes, cars, buses and lorries on the left of the road, some with passengers. They stop at red lights and for whatever is in front, honk when held up, overtake slow vehicles on the right, buses pull in at stops and autos at auto stands. Walk up and take their vehicle.',
        'Cops: white cars with a flashing light bar and POLICE sign. They come when you have stars, follow the roads to you and bust you if you stop near them. Busted players end up at a police station.',
        'Pedestrians: people walking along the roadsides and crossing at the ends of roads. They jump out of the way and are never hurt, but racing right past them gets you a star.',
        'Traffic police: at Raj Vihar and C-Camp, on a stand under an umbrella. They see red-light runners.',
        'Police and chors (Chor–Police rounds): police have a light bar and a blue name tag.',
        'Your traffic, pedestrians and cops are your own: friends have their own.',
      ]),
    ],
  },
  {
    id: 'modes',
    title: 'Game modes',
    build: () => [
      h('h2', '', 'Game modes'),
      P('In a room the host picks a mode and a length (3, 5 or 10 minutes) on the card at the bottom and taps Start (2 players or more). Everyone gets a car in the city, a 3-2-1-GO countdown, then plays.'),
      h('h3', '', 'Free roam'),
      P('Always on between rounds and when playing alone: the whole city, traffic and cops.'),
      h('h3', '', 'Chor–Police'),
      LIST([
        'One police (two with 5 or more players) chases the chors. Police wait 10 s while the chors get away.',
        'Touch a chor to catch them: they join the police (and wait 3 s before they can catch).',
        'Chors score 1 point a second while free, plus 60 if never caught. Police score 30 per catch.',
        'The round ends when everyone is caught or time runs out.',
      ]),
      h('h3', '', 'Landmark hunt'),
      LIST([
        '3, 4 or 5 Kurnool landmarks, one after another.',
        'Follow the arrow, the light pillar and the gold ring on the minimap. First to get within 30 m scores a point, then everyone heads for the next one.',
      ]),
    ],
  },
  {
    id: 'other',
    title: 'Other',
    build: () => [
      h('h2', '', 'Other things to know'),
      h('h3', '', 'Heat and cops'),
      LIST([
        'Stars (next to the minimap) show police heat, up to 3; one cop per star.',
        'At 2 stars cops try to cut you off and ram you; at 3 stars they also block the road ahead with two cars. In narrow old-city lanes some come on bikes.',
        'You get a star for taking a vehicle from traffic, crashing hard into traffic, hitting a cop, racing right past people on the roadside, or running a red light where the police can see.',
        'Stop within 7 m of a cop for 1.3 s and you are busted: the stars go, and you are taken on foot to the nearest police station (5 in the city, under Places). Your vehicle stays where you were caught; one borrowed from traffic is taken away. The stars pulse while a bust is building.',
        'Stay more than 58 m from every cop for 10 s to drop a star (new cops get 20 s to reach you first).',
        'No cops chase you while you play a game round.',
      ]),
      h('h3', '', 'Junctions'),
      LIST([
        'The busiest junctions have traffic lights; traffic stops on red and waits its turn.',
        'At Raj Vihar and C-Camp a traffic policeman on a stand waves each direction through.',
        'Drive through a red light near a cop or the traffic policeman and you get a star.',
      ]),
      h('h3', '', 'Getting about'),
      LIST([
        'Unstuck (R or the button) puts you on the nearest road, facing along it.',
        'Map view (C) flies over the city; drag to move, scroll or pinch to zoom.',
        'You can walk into anything that is not a building, wall or water. Bridges and flyovers can be driven over and under.',
      ]),
      h('h3', '', 'Phones'),
      LIST(['Phones use low quality automatically; change it in Menu → Settings.', 'Sound starts after your first tap; turn it off or down in Menu → Settings.', 'After the phone sleeps, the game reconnects to your room by itself.']),
      P('Credits and data licences are under Menu → About.'),
    ],
  },
];

const PLACE_NOTES: Record<string, string> = {
  fort: 'Konda Reddy Buruju, the old fort tower in the middle of the old city.',
  river: 'The Tungabhadra along the north of the city.',
  bridge: 'The NH44 bridges over the Tungabhadra to the north.',
  station: 'Kurnool City railway station, with its platforms and tracks.',
  busstand: 'The main APSRTC bus station.',
  ccamp: 'C-Camp Centre, a busy junction.',
  ggh: 'Government General Hospital.',
  kmc: 'Kurnool Medical College, next to the hospital.',
  rajvihar: 'Raj Vihar Centre: the start point when you play alone.',
  akestate: 'Abdullah Khan Estate.',
};

function vehicleCard(t: VehicleType, renderer: THREE.WebGLRenderer): HTMLElement {
  const v = VEHICLES[t];
  const card = h('div', 'vcard');
  card.append(vehiclePicture(t, renderer));
  const info = h('div');
  info.append(
    h('b', '', v.name),
    h('small', '', `${v.seats} seats · top ${Math.round(v.top * 3.6)} km/h · ${v.len} m long`),
    h('p', '', v.about),
  );
  card.append(info);
  return card;
}

const pictures = new Map<VehicleType, string>();

/** A small picture of a vehicle, drawn once with the game's renderer. */
function vehiclePicture(t: VehicleType, renderer: THREE.WebGLRenderer): HTMLElement {
  const img = h('img', 'vpic');
  img.alt = VEHICLES[t].name;
  let url = pictures.get(t);
  if (!url) {
    const W = 240, H = 150;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xb8b2ff, 0xd68f6c, 2.2));
    const sun = new THREE.DirectionalLight(0xffd9b0, 2.4);
    sun.position.set(3, 5, 4);
    scene.add(sun);
    const mesh = buildVehicleMesh(t, vehicleColour(t, 0), false);
    setRider(mesh, 0xffc247);
    mesh.rotation.y = -0.75;
    scene.add(mesh);
    // Fit the vehicle: further back for long ones, never closer than for a small one.
    const size = Math.max(VEHICLES[t].len, 2.4);
    const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 200);
    cam.position.set(0.62, 0.42, 0.66).multiplyScalar(size * 1.45 + 1.2);
    cam.lookAt(0, 0.8, 0);
    const rt = new THREE.WebGLRenderTarget(W, H);
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const before = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x2b2740, 1);
    renderer.clear();
    renderer.render(scene, cam);
    const px = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    renderer.setRenderTarget(before);
    rt.dispose();
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    if (g) {
      const data = g.createImageData(W, H);
      for (let y = 0; y < H; y++) data.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      g.putImageData(data, 0, 0);
    }
    url = c.toDataURL();
    pictures.set(t, url);
  }
  img.src = url;
  return img;
}

/** The guide as one menu page with its own sub-tabs. */
export function guidePage(deps: GuideDeps): MenuPage {
  let section = SECTIONS[0].id;
  return {
    id: 'guide',
    title: 'Guide',
    render: () => {
      const wrap = h('div', 'guide');
      const tabs = h('div', 'gtabs');
      const body = h('div', 'gbody');
      const show = (id: string): void => {
        section = id;
        for (const b of tabs.children) b.classList.toggle('on', (b as HTMLElement).dataset.id === id);
        const s = SECTIONS.find((x) => x.id === id) ?? SECTIONS[0];
        body.replaceChildren(...s.build(deps));
        body.scrollTop = 0;
      };
      for (const s of SECTIONS) {
        const b = btn(s.title, '', () => show(s.id));
        b.dataset.id = s.id;
        tabs.append(b);
      }
      wrap.append(tabs, body);
      show(section);
      return wrap;
    },
  };
}
