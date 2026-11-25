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
}

/** A building as stored in the file: p = [x0, z0, dx1, dz1, ...] in whole decimetres, k = kind. */
export interface PackedBuilding {
  p: number[];
  h: number;
  k?: string;
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

export interface MapData {
  version: 2;
  center: { lat: number; lon: number };
  bounds: Rect;
  playArea: Rect;
  roads: Road[];
  graph: { nodes: Pt[]; edges: GraphEdge[] };
  buildings: Building[];
  water: { pts: Pt[] }[];
  parks: { pts: Pt[] }[];
  rail: { pts: Pt[] }[];
  landmarks: Landmark[];
  airport: {
    runway: { x: number; z: number; len: number; w: number; heading: number };
    terminal: { pts: Pt[] };
  };
  spawn: { x: number; z: number; heading: number };
  meta: { osmBase: string; overtureRelease?: string; credit: string };
}
