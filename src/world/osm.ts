import type { OSMData, OSMElement, World, WorldObject, Bounds, Point, Polygon } from './types';
import { toWorld, centroid, inPolygon } from './geo';
const drivable =
  /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(_link)?$/;
const num = (s: string | undefined) => (s ? Number.parseFloat(s) : NaN);
function stitch(parts: number[][]): number[][] {
  const todo = parts.map((x) => [...x]),
    out: number[][] = [];
  while (todo.length) {
    let r = todo.shift()!,
      changed = true;
    while (r[0] !== r.at(-1) && changed) {
      changed = false;
      for (let i = 0; i < todo.length; i++) {
        let n = todo[i];
        if (n[0] === r.at(-1) || n.at(-1) === r.at(-1)) {
          if (n.at(-1) === r.at(-1)) n = n.slice().reverse();
          r.push(...n.slice(1));
          todo.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    out.push(r);
  }
  return out;
}
export function fromOSM(
  data: OSMData,
  bounds: Bounds = [52.2023, 0.116, 52.2065, 0.123],
  title = 'Cambridge · City centre',
): World {
  if (!Array.isArray(data.elements) || data.elements.length > 150000)
    throw Error('OSM data missing or exceeds 150,000 elements. Select a smaller area.');
  const origin: Point = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  const w: World = {
    schema: 'slaydrive-world',
    version: 1,
    id: 'world-' + crypto.randomUUID(),
    title,
    geo: {
      origin,
      projection: 'local-equirectangular',
      axes: 'X east, Y up, Z south',
      units: 'metres',
      elevationDatum: 'flat local zero; not surveyed',
    },
    bounds,
    attribution: [
      '© OpenStreetMap contributors · ODbL 1.0 · https://www.openstreetmap.org/copyright',
    ],
    sourceDate: data.osm3s?.timestamp_osm_base || 'unknown',
    sourceObjects: [],
    overrides: {},
    nodeOverrides: {},
    additions: [],
    restrictions: [],
    sourceIssues: [],
    spawn: { x: 0, z: 0, heading: 0 },
    route: null,
  };
  if (data.remark)
    w.sourceIssues.push('Provider returned partial data: ' + data.remark.slice(0, 500));
  const nodes = new Map(data.elements.filter((e) => e.type === 'node').map((e) => [e.id, e]));
  const ways = new Map(data.elements.filter((e) => e.type === 'way').map((e) => [e.id, e]));
  const points = (ids: number[]): Point[] | null => {
    if (ids.some((id) => !nodes.has(id))) {
      w.sourceIssues.push('Incomplete geometry: missing source nodes');
      return null;
    }
    return ids.map((id) => {
      const n = nodes.get(id)!;
      return toWorld(n.lat!, n.lon!, origin);
    });
  };
  const base = (e: OSMElement, kind: WorldObject['kind'], p: Point): WorldObject => ({
    id: `osm/${e.type}/${e.id}`,
    kind,
    name: e.tags?.name || `${kind === 'building' ? e.tags?.building || 'Building' : kind} ${e.id}`,
    x: p[0],
    z: p[1],
    y: 0,
    rotation: 0,
    scale: 1,
    source: {
      provider: 'osm',
      id: `${e.type}/${e.id}`,
      confidence: 'source',
      tags: e.tags || {},
      inferred: [],
    },
  });
  const building = (e: OSMElement, rings: Polygon, suffix = '') => {
    const c = centroid(rings[0]),
      o = base(e, 'building', c);
    o.id += suffix;
    o.rings = rings.map((r) => r.map((p) => [p[0] - c[0], p[1] - c[1]]));
    const tags = e.tags || {};
    o.height = num(tags.height) || num(tags['building:levels']) * 3 || 7.8;
    o.roof = tags['roof:shape'] || 'flat';
    if (!tags.height)
      o.source.inferred.push(
        tags['building:levels'] ? 'height from tagged storeys × 3 m' : 'height 7.8 m default',
      );
    if (!tags['roof:shape']) o.source.inferred.push('roof shape unknown; flat placeholder');
    o.color =
      tags['building:material'] === 'stone'
        ? '#c2b69c'
        : tags['building:material'] === 'plaster'
          ? '#e4dcc9'
          : ['#b98c73', '#bb9b7e', '#ae7762', '#cfbda4', '#b4ac99'][e.id % 5];
    w.sourceObjects.push(o);
  };
  const relationMembers = new Set<number>();
  for (const e of data.elements.filter((e) => e.type === 'relation' && e.tags?.building)) {
    const outer = stitch(
      (e.members || [])
        .filter((m) => m.type === 'way' && m.role !== 'inner')
        .map((m) => ways.get(m.ref)?.nodes || [])
        .filter((p) => p.length),
    );
    const inner = stitch(
      (e.members || [])
        .filter((m) => m.role === 'inner')
        .map((m) => ways.get(m.ref)?.nodes || [])
        .filter((p) => p.length),
    );
    const holes = inner
      .filter((r) => r[0] === r.at(-1))
      .map((r) => points(r))
      .filter(Boolean) as Polygon;
    outer.forEach((r, i) => {
      const p = points(r);
      if (p && r[0] === r.at(-1)) {
        building(
          e,
          [p, ...holes.filter((h) => inPolygon(h[0], [p]))],
          outer.length > 1 ? '/' + i : '',
        );
        (e.members || []).forEach((m) => relationMembers.add(m.ref));
      } else w.sourceIssues.push('Unclosed building relation ' + e.id);
    });
  }
  for (const e of ways.values()) {
    const t = e.tags || {},
      p = points(e.nodes || []);
    if (!p || p.length < 2) continue;
    if (t.building && !relationMembers.has(e.id)) {
      if (e.nodes?.[0] === e.nodes?.at(-1) && p.length >= 4) building(e, [p]);
      else w.sourceIssues.push('Unclosed building way ' + e.id);
    }
    if (
      !drivable.test(t.highway || '') ||
      ['no', 'private'].includes(t.motorcar || t.motor_vehicle || t.access || '')
    )
      continue;
    if (t.bridge === 'yes' || t.tunnel === 'yes' || (t.layer && t.layer !== '0')) {
      w.sourceIssues.push(
        'Grade-separated road ' + e.id + ' excluded until an elevation datum is configured',
      );
      continue;
    }
    const c = centroid(p),
      o = base(e, 'road', c);
    o.points = p.map((q) => [q[0] - c[0], q[1] - c[1]]);
    o.nodeIds = e.nodes!.map(String);
    o.class = t.highway;
    o.lanes = num(t.lanes) || (t.oneway === 'yes' ? 1 : 2);
    o.width =
      num(t.width) * (t.width && /ft|feet/.test(t.width) ? 0.3048 : 1) ||
      (t.highway === 'living_street' ? 5.5 : Math.max(3.5, o.lanes * 3.1));
    if (!t.width) o.source.inferred.push('carriageway width from classification/lanes');
    o.sidewalk = t.sidewalk || 'unknown';
    if (o.sidewalk === 'unknown')
      o.source.inferred.push('1.8 m pavement envelope estimated; verify mapped gaps');
    o.oneway =
      t.oneway === '-1'
        ? -1
        : t.oneway === 'yes' ||
            t.oneway === '1' ||
            (t.junction === 'roundabout' && t.oneway !== 'no')
          ? 1
          : 0;
    if (
      ['reversible', 'alternating'].includes(t.oneway) ||
      Object.keys(t).some((k) => /^(oneway|access|motorcar|motor_vehicle):conditional$/.test(k))
    )
      w.sourceIssues.push(
        'Time-dependent access on road ' +
          e.id +
          ' is not evaluated; this road is excluded from practice routes.',
      );
    o.mph = num(t.maxspeed)
      ? Math.round(num(t.maxspeed) * (t.maxspeed?.includes('mph') ? 1 : 0.621371))
      : 20;
    if (!t.maxspeed) o.source.inferred.push('speed limit unknown; 20 mph editor placeholder');
    w.sourceObjects.push(o);
  }
  for (const e of data.elements.filter(
    (e) => e.type === 'relation' && e.tags?.type === 'restriction',
  )) {
    const m = e.members || [],
      from = m.find((m) => m.role === 'from'),
      to = m.find((m) => m.role === 'to'),
      via = m.find((m) => m.role === 'via');
    if (from && to && via?.type === 'node' && !e.tags?.['restriction:conditional'])
      w.restrictions.push({
        from: 'osm/way/' + from.ref,
        to: 'osm/way/' + to.ref,
        via: String(via.ref),
        only: (e.tags?.restriction || '').startsWith('only_'),
      });
    else
      w.sourceIssues.push(
        'Unsupported via-way or conditional restriction ' +
          e.id +
          '; practice routing must be reviewed',
      );
  }
  for (const e of nodes.values()) {
    const t = e.tags || {},
      p = toWorld(e.lat!, e.lon!, origin);
    if (t.shop && t.name) {
      const b = w.sourceObjects.find(
        (o) => o.kind === 'building' && inPolygon([p[0] - o.x, p[1] - o.z], o.rings!),
      );
      if (b) {
        (b.shops ||= []).push(t.name);
        b.source.inferred.push('shop facade placement estimated');
      }
    }
    if (t.natural === 'tree')
      w.sourceObjects.push({ ...base(e, 'tree', p), height: 5, width: 2.3 });
    // Signals and priority markings are retained in source tags, not synthesized from junction class.
    if (t.highway === 'traffic_signals' || t.highway === 'give_way' || t.highway === 'stop')
      w.sourceIssues.push(
        'Mapped ' +
          t.highway +
          ' at node ' +
          e.id +
          ' needs approach/facing verification before placement',
      );
  }
  const spawnRoad =
    w.sourceObjects.find((o) => o.kind === 'road' && o.name === 'Trumpington Street') ||
    w.sourceObjects.find((o) => o.kind === 'road');
  if (spawnRoad) {
    const p = spawnRoad.points!,
      a = p[0],
      b = p[1],
      l = Math.hypot(b[0] - a[0], b[1] - a[1]),
      dx = (b[0] - a[0]) / l,
      dz = (b[1] - a[1]) / l;
    w.spawn = {
      x: spawnRoad.x + a[0] + (dz * (spawnRoad.width || 6)) / 4,
      z: spawnRoad.z + a[1] - (dx * (spawnRoad.width || 6)) / 4,
      heading: Math.atan2(-dx, -dz),
    };
  }
  if (!data.elements.some((e) => e.type === 'relation'))
    w.sourceIssues.push(
      'This extract has no relations: courtyard multipolygons and turn-restriction coverage are incomplete.',
    );
  return w;
}
