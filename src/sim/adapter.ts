import { factors } from '../world/geo';
import { resolveObjects, roadPoints, validateWorld, parseWorld, MAX_BYTES } from '../world/model';
import { compile } from '../world/compiler';
import type { World, WorldObject, Point } from '../world/types';
export function exportTrack(w: World) {
  validateWorld(w);
  const compiled = compile(w);
  if (compiled.diagnostics.some((d) => d.severity === 'error'))
    throw Error('Resolve geometry errors before simulator export.');
  const names: string[] = [],
    classes: string[] = [],
    nodes: number[] = [],
    ways: any[] = [],
    edges: any[] = [],
    ids = new Map<string, number>();
  const index = (arr: string[], s: string) => {
    let n = arr.indexOf(s);
    if (n < 0) {
      n = arr.length;
      arr.push(s);
    }
    return n;
  };
  for (const o of resolveObjects(w).filter((o) => o.kind === 'road')) {
    const pts = roadPoints(w, o),
      ni = o.nodeIds!;
    const wi = ways.length;
    ways.push([
      index(names, o.name),
      index(classes, o.class || 'residential'),
      o.mph || 20,
      !o.source.tags.maxspeed ? 1 : 0,
      o.oneway ? 1 : 0,
      o.width || 6,
      o.source.tags.junction === 'roundabout' ? 1 : 0,
      o.lanes || 2,
      0,
      0,
      15,
    ]);
    pts.forEach((p, i) => {
      if (!ids.has(ni[i])) {
        ids.set(ni[i], nodes.length / 2);
        nodes.push(Math.round(p[0] * 10), Math.round(p[1] * 10));
      }
    });
    // Split at every topology node; native buildNet cannot represent via nodes inside an edge.
    for (let i = 1; i < pts.length; i++) {
      const a = o.oneway === -1 ? i : i - 1,
        b = o.oneway === -1 ? i - 1 : i;
      edges.push([
        ids.get(ni[a]),
        ids.get(ni[b]),
        wi,
        [...pts[a].map((v) => Math.round(v * 10)), ...pts[b].map((v) => Math.round(v * 10))],
      ]);
    }
  }
  const [kx, kz] = factors(w.geo.origin);
  const network = {
    origin: w.geo.origin,
    kx,
    kz,
    names,
    classes,
    nodes,
    ways,
    edges,
    stops: [],
    zebras: [],
    giveways: [],
    minis: [],
    rbs: [],
    lamps: [],
    arrows: [],
  };
  return {
    version: 1,
    kind: 'mock',
    title: w.title,
    network,
    spawn: { x: w.spawn.x, z: w.spawn.z, th: w.spawn.heading },
    plan: { waypoints: w.route?.points.map(([x, z]) => ({ x, z, road: '' })) || [] },
    objects: resolveObjects(w).filter((o) => o.kind !== 'road'),
    slaydriveWorld: {
      schema: 1,
      world: structuredClone(w),
      compiled: {
        asphalt: compiled.asphalt,
        pavement: compiled.pavement,
        markings: compiled.markings,
      },
    },
    compatibility: {
      nativeNetwork: true,
      completeWorldRequires: 'SlayDrive World adapter v1',
      assessment: 'unchanged in learner; excluded in World free drive',
    },
  };
}
export function importTrack(text: string): World {
  if (new TextEncoder().encode(text).length > MAX_BYTES)
    throw Error('Import exceeds 20 MiB; no data loaded.');
  const d = JSON.parse(text);
  if (d.schema === 'slaydrive-world') return parseWorld(text);
  if (d.slaydriveWorld?.world) return validateWorld(d.slaydriveWorld.world);
  const n = d.network || d;
  if (!n.nodes || !n.edges || !n.ways || !n.origin)
    throw Error('Not a World file or supported SlayDrive track.');
  const objects: WorldObject[] = n.edges.map((e: any, i: number) => {
    const way = n.ways[e[2]],
      coords: Point[] = [];
    for (let j = 0; j < e[3].length; j += 2) coords.push([e[3][j] / 10, e[3][j + 1] / 10]);
    return {
      id: 'legacy/edge/' + i,
      kind: 'road',
      name: n.names[way[0]] || 'Road',
      x: 0,
      y: 0,
      z: 0,
      rotation: 0,
      scale: 1,
      points: coords,
      nodeIds: coords.map((_, j) =>
        j === 0 ? 'n' + e[0] : j === coords.length - 1 ? 'n' + e[1] : 'edge' + i + 'point' + j,
      ),
      width: way[5],
      mph: way[2],
      class: n.classes[way[1]],
      lanes: way[7],
      oneway: way[4],
      sidewalk: 'unknown',
      source: {
        provider: 'legacy',
        id: String(i),
        confidence: 'estimated',
        tags: {},
        inferred: ['Native track does not include surveyed road boundaries'],
      },
    };
  });
  const w: World = {
    schema: 'slaydrive-world',
    version: 1,
    id: crypto.randomUUID(),
    title: d.title || 'Imported SlayDrive track',
    geo: {
      origin: n.origin,
      projection: 'local-equirectangular',
      axes: 'X east, Y up, Z south',
      units: 'metres',
      elevationDatum: 'flat local zero; not surveyed',
    },
    bounds: [n.origin[0] - 0.005, n.origin[1] - 0.005, n.origin[0] + 0.005, n.origin[1] + 0.005],
    sourceDate: 'legacy import',
    attribution: ['Original SlayDrive track; see preserved legacy metadata'],
    sourceObjects: objects,
    overrides: {},
    additions: [],
    nodeOverrides: {},
    restrictions: [],
    sourceIssues: [
      'Legacy envelope retained verbatim. Unsupported authored assets remain in legacy metadata and require explicit conversion.',
    ],
    spawn: { x: d.spawn?.x || 0, z: d.spawn?.z || 0, heading: d.spawn?.th || 0 },
    route: null,
    legacy: d,
  };
  return validateWorld(w);
}
