export type Point = [number, number];
export type Polygon = Point[][];
export type MultiPolygon = Polygon[];
export type Bounds = [number, number, number, number]; // south, west, north, east
export type Kind =
  | 'road'
  | 'junction'
  | 'lane'
  | 'building'
  | 'tree'
  | 'sign'
  | 'signal'
  | 'parking'
  | 'checkpoint'
  | 'zone'
  | 'marking'
  | 'spawn';
export interface Provenance {
  provider: 'osm' | 'overture' | 'manual' | 'legacy';
  id: string;
  confidence: 'source' | 'estimated' | 'manual';
  tags: Record<string, string>;
  inferred: string[];
}
export interface WorldObject {
  id: string;
  kind: Kind;
  name: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale: number;
  points?: Point[];
  nodeIds?: string[];
  rings?: Polygon;
  width?: number;
  height?: number;
  length?: number;
  oneway?: number;
  lanes?: number;
  sidewalk?: string;
  class?: string;
  mph?: number;
  roof?: string;
  color?: string;
  markingType?: 'solid' | 'dashed' | 'stop' | 'give-way';
  source: Provenance;
  shops?: string[];
}
export interface Restriction {
  from: string;
  to: string;
  via: string;
  only: boolean;
}
export interface World {
  schema: 'slaydrive-world';
  version: 1;
  id: string;
  title: string;
  geo: {
    origin: Point;
    projection: 'local-equirectangular';
    axes: 'X east, Y up, Z south';
    units: 'metres';
    elevationDatum: 'flat local zero; not surveyed';
  };
  bounds: Bounds;
  attribution: string[];
  sourceDate: string;
  sourceObjects: WorldObject[];
  overrides: Record<string, Partial<WorldObject> & { deleted?: boolean }>;
  additions: WorldObject[];
  nodeOverrides: Record<string, Point>;
  restrictions: Restriction[];
  sourceIssues: string[];
  spawn: { x: number; z: number; heading: number };
  route: {
    nodeIds: string[];
    points: Point[];
    mode: 'route' | 'clockwise' | 'anticlockwise';
  } | null;
  legacy?: unknown;
}
export interface Diagnostic {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  objectId?: string;
  point?: Point;
}
export interface CompiledWorld {
  asphalt: MultiPolygon;
  pavement: MultiPolygon;
  markings: MultiPolygon;
  objects: WorldObject[];
  diagnostics: Diagnostic[];
  elapsedMs: number;
  area: number;
  roadArea: number;
  boundary: Bounds;
}
export type OSMElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
  members?: { type: string; ref: number; role: string }[];
};
export interface OSMData {
  elements: OSMElement[];
  osm3s?: { timestamp_osm_base?: string };
  remark?: string;
}
