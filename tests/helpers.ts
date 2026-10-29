import type { World, WorldObject, Point } from '../src/world/types';
export function world(): World {
  return {
    schema: 'slaydrive-world',
    version: 1,
    id: crypto.randomUUID(),
    title: 'Geometry fixture',
    geo: {
      origin: [52.2044, 0.1195],
      projection: 'local-equirectangular',
      axes: 'X east, Y up, Z south',
      units: 'metres',
      elevationDatum: 'flat local zero; not surveyed',
    },
    bounds: [52.2, 0.11, 52.21, 0.12],
    attribution: ['Synthetic geometry test only'],
    sourceDate: 'test',
    sourceObjects: [],
    additions: [],
    overrides: {},
    nodeOverrides: {},
    restrictions: [],
    sourceIssues: [],
    spawn: { x: 0, z: 0, heading: 0 },
    route: null,
  };
}
export function road(
  id: string,
  points: Point[],
  nodeIds = points.map((p) => p.join(',')),
): WorldObject {
  return {
    id,
    kind: 'road',
    name: id,
    x: 0,
    y: 0,
    z: 0,
    rotation: 0,
    scale: 1,
    points,
    nodeIds,
    width: 6,
    lanes: 2,
    oneway: 0,
    sidewalk: 'both',
    class: 'residential',
    mph: 20,
    source: { provider: 'manual', id, confidence: 'manual', tags: {}, inferred: [] },
  };
}
export function building(id = 'building'): WorldObject {
  return {
    id,
    kind: 'building',
    name: id,
    x: 20,
    y: 0,
    z: 20,
    rotation: 30,
    scale: 1,
    height: 8,
    rings: [
      [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
        [-10, -10],
      ],
      [
        [-3, -3],
        [-3, 3],
        [3, 3],
        [3, -3],
        [-3, -3],
      ],
    ],
    source: { provider: 'manual', id, confidence: 'manual', tags: {}, inferred: [] },
  };
}
