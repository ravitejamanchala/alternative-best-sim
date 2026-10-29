import type { World, WorldObject, Point } from './types';
import { toWorld, centroid, inPolygon } from './geo';
import { resolveObjects, coordinates, validateWorld, MAX_BYTES } from './model';
import { selfIntersects, area } from './compiler';
import clipping from 'polygon-clipping';
export function importOverture(w: World, data: any, attribution: string) {
  if (!attribution.trim()) throw Error('Licensed Overture source attribution is required.');
  if (
    data?.type !== 'FeatureCollection' ||
    !Array.isArray(data.features) ||
    data.features.length > 10000
  )
    throw Error('Expected bounded GeoJSON FeatureCollection, max 10,000 buildings.');
  if (new TextEncoder().encode(JSON.stringify(data)).length > MAX_BYTES)
    throw Error('Extract exceeds 20 MiB. No features have been imported.');
  const existing = resolveObjects(w).filter((o) => o.kind === 'building'),
    added: WorldObject[] = [];
  const ids = new Set([...w.sourceObjects, ...w.additions].map((o) => o.id));
  const featureIds = new Set<string>();
  let parts = 0;
  for (const f of data.features) {
    const sourceId = String(f.id ?? f.properties?.id ?? '');
    if (!sourceId) throw Error('Every Overture feature needs a stable ID.');
    if (featureIds.has(sourceId)) throw Error('Duplicate Overture source ID: ' + sourceId);
    featureIds.add(sourceId);
    const polygons =
      f.geometry?.type === 'Polygon'
        ? [f.geometry.coordinates]
        : f.geometry?.type === 'MultiPolygon'
          ? f.geometry.coordinates
          : null;
    if (!Array.isArray(polygons) || !polygons.length)
      throw Error('Expected a nonempty Polygon or MultiPolygon building.');
    for (const [part, polygon] of polygons.entries()) {
      if (++parts > 10000)
        throw Error('Extract exceeds 10,000 footprint parts. Split the extract.');
      if (!Array.isArray(polygon) || !polygon.length || polygon.length > 100)
        throw Error('Invalid building footprint rings.');
      const rings: Point[][] = polygon.map((r: unknown) => {
        if (!Array.isArray(r) || r.length < 4 || r.length > 10000)
          throw Error('Invalid footprint ring: expected 4–10,000 coordinates.');
        const converted = r.map((p: unknown) => {
          if (
            !Array.isArray(p) ||
            p.length < 2 ||
            !Number.isFinite(p[0]) ||
            !Number.isFinite(p[1]) ||
            p[0] < -9 ||
            p[0] > 3 ||
            p[1] < 49 ||
            p[1] > 61
          )
            throw Error('Building coordinates must be finite UK WGS84 longitude/latitude.');
          return toWorld(p[1], p[0], w.geo.origin);
        });
        if (
          converted[0][0] !== converted.at(-1)![0] ||
          converted[0][1] !== converted.at(-1)![1] ||
          selfIntersects(converted)
        )
          throw Error('Building footprint is open or self-intersecting.');
        return converted;
      });
      if (area([rings]) < 0.1) throw Error('Building footprint has no usable area.');
      const id = 'overture/' + sourceId + (polygons.length > 1 ? '/part/' + part : '');
      if (ids.has(id)) continue; // Reimport is idempotent, including manually deleted/edited sources.
      const c = centroid(rings[0]);
      if (
        [...existing, ...added].some(
          (o) => clipping.intersection([rings], [o.rings!.map((r) => coordinates(o, r))]).length,
        )
      )
        continue;
      const props = f.properties || {};
      added.push({
        id,
        kind: 'building',
        name: props.names?.primary || 'Overture building',
        x: c[0],
        z: c[1],
        y: 0,
        rotation: 0,
        scale: 1,
        rings: rings.map((r) => r.map((p) => [p[0] - c[0], p[1] - c[1]])),
        height: props.height ?? (props.num_floors ? props.num_floors * 3 : 7.8),
        roof: props.roof_shape || 'flat',
        source: {
          provider: 'overture',
          id: sourceId,
          confidence: props.height ? 'source' : 'estimated',
          tags: {
            license: attribution,
            'overture:part': String(part),
            'overture:properties': JSON.stringify(props),
          },
          inferred: props.height ? [] : ['height estimated; not surveyed'],
        },
      });
      ids.add(id);
    }
  }
  return validateWorld({
    ...w,
    additions: [...w.additions, ...added],
    attribution: [...new Set([...w.attribution, attribution])],
  });
}
