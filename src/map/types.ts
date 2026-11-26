// Shape of public/map/kurnool.json. Keep in sync with docs/ARCHITECTURE.md and scripts/osm/build.mjs.
// Units are metres. X = east, Z = south. Polygons are open rings.

export type Pt = [number, number];

export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface Road {
  id: number;
  kind: string;
  width: number;
  oneway: boolean;
  bridge: boolean;
  pts: Pt[];
}

export interface GraphEdge {
  a: number;
  b: number;
  road: number;
  len: number;
  i0: number;
  i1: number;
}

export interface Building {
  pts: Pt[];
  h: number;
  kind?: string;
  style: number; // see STYLE in buildingStyle.ts
  gate?: number; // colony houses: compound wall with the gate on this side of the box (0..3)
}

/** A building as stored in the file: p = [x0, z0, dx1, dz1, ...] in whole decimetres, k = kind, s = style, w = gate side. */
export interface PackedBuilding {
  p: number[];
  h: number;
  k?: string;
  s?: number;
  w?: number;
}

export interface Landmark {
  id: string;
  nameEn: string;
  nameTe: string;
  type: string;
  x: number;
  z: number;
  pts?: Pt[];
}

/** A railway track run. Bridges over water are drawn high on piers; other bridges stay at ground level. */
export interface RailRun {
  pts: Pt[];
  bridge?: boolean;
  overWater?: boolean;
  electric?: boolean;
  service?: string;
}

/** A river or canal centreline (OSM has no outline for it). Canal water is also in `water` (not aqueducts or culverts); rivers are a sandy bed with satellite water outlines on top. */
export interface Waterway {
  pts: Pt[];
  w: number;
  kind: 'river' | 'canal';
  name?: string;
  part?: 'aqueduct' | 'culvert';
}

/** A temple (h), mosque (m) or church (c): box centre, heading of the box's w side (forward = (sin a, cos a)), size. */
export interface Worship {
  x: number;
  z: number;
  a: number;
  w: number;
  d: number;
  r: 'h' | 'm' | 'c';
  name?: string;
}

/** Street details (task K.3). Flat arrays are in whole decimetres. */
export interface Props {
  poles: number[][]; // wired runs: [x0, z0, dx1, dz1, ...]
  trees: number[]; // [x, z, ...]
  hoardings: number[]; // [x, z, headingDeg, ...], heading = the way the board faces
  worship: Worship[];
  autoStands: number[]; // [x, z, headingDeg, count, ...], autos parked along the heading
}

export interface MapData {
  version: 2;
  center: { lat: number; lon: number };
  bounds: Rect;
  playArea: Rect;
  roads: Road[];
  graph: { nodes: Pt[]; edges: GraphEdge[] };
  buildings: Building[];
  water: { pts: Pt[]; holes?: Pt[][] }[]; // holes = islands
  parks: { pts: Pt[] }[];
  rail: RailRun[];
  waterways: Waterway[];
  landmarks: Landmark[];
  props: Props;
  airport: {
    runway: { x: number; z: number; len: number; w: number; heading: number };
    terminal: { pts: Pt[] };
  };
  spawn: { x: number; z: number; heading: number };
  meta: { osmBase: string; overtureRelease?: string; credit: string };
}
