import type { Kind, Point, WorldObject, World } from './types';
import { resolveObjects, roadPoints } from './model';
import { distance } from './geo';
import { offsetPath } from './compiler';

export function manualObject(kind: Kind, p: Point): WorldObject {
  const id = 'manual/' + crypto.randomUUID();
  return {
    id,
    kind,
    name: kind[0].toUpperCase() + kind.slice(1),
    x: p[0],
    y: 0,
    z: p[1],
    rotation: 0,
    scale: 1,
    width: kind === 'tree' ? 2 : kind === 'road' ? 6 : kind === 'lane' ? 3 : 2.4,
    height: kind === 'building' ? 7.8 : 5,
    length: 5,
    ...(kind === 'road' || kind === 'lane'
      ? {
          points: [
            [-10, 0],
            [10, 0],
          ] as Point[],
          ...(kind === 'road'
            ? {
                nodeIds: [id + '/a', id + '/b'],
                lanes: 2,
                oneway: 0,
                sidewalk: 'both',
                class: 'residential',
                mph: 20,
              }
            : {}),
        }
      : {}),
    ...(kind === 'building'
      ? {
          rings: [
            [
              [-5, -4],
              [5, -4],
              [5, 4],
              [-5, 4],
              [-5, -4],
            ],
          ] as Point[][],
          roof: 'flat',
        }
      : {}),
    ...(kind === 'zone'
      ? {
          rings: [
            [
              [-5, -5],
              [5, -5],
              [5, 5],
              [-5, 5],
              [-5, -5],
            ],
          ] as Point[][],
        }
      : {}),
    ...(kind === 'junction'
      ? {
          rings: [
            Array.from({ length: 9 }, (_, i) => {
              const a = ((i % 8) / 8) * Math.PI * 2;
              return [Math.cos(a) * 6, Math.sin(a) * 6] as Point;
            }),
          ],
          sidewalk: 'both',
        }
      : {}),
    ...(kind === 'marking' ? { markingType: 'solid' as const } : {}),
    source: { provider: 'manual', id, confidence: 'manual', tags: {}, inferred: [] },
  };
}
export function laneFromRoad(w: World, road: WorldObject) {
  const lane = manualObject('lane', [0, 0]),
    width = (road.width || 6) / (road.lanes || 2);
  lane.width = width;
  lane.name = road.name + ' · authored left lane';
  lane.points = offsetPath(roadPoints(w, road), (road.width || 6) / 2 - width / 2);
  lane.source.tags['parent:road'] = road.id;
  return lane;
}
/** Explicitly requested topology edit; proximity alone never creates connections on import. */
export function connectEndpoints(w: World, road: WorldObject, tolerance = 5) {
  const nodeIds = [...road.nodeIds!],
    points = roadPoints(w, road);
  const others = resolveObjects(w).filter((o) => o.kind === 'road' && o.id !== road.id);
  let connected = 0;
  for (const i of [0, points.length - 1]) {
    const candidates = others
      .flatMap((o) => roadPoints(w, o).map((p, j) => ({ p, id: o.nodeIds![j] })))
      .filter((n) => distance(n.p, roadPoints(w, road)[i]) <= tolerance)
      .sort((a, b) => distance(a.p, points[i]) - distance(b.p, points[i]));
    const target = candidates[0];
    if (!target) continue;
    nodeIds[i] = target.id;
    points[i] = target.p;
    connected++;
  }
  if (!connected)
    throw Error(
      'No other road nodes within 5 m of either endpoint. Move an endpoint closer, then connect.',
    );
  // Bake the transform so new shared coordinates have one unambiguous representation.
  w.overrides[road.id] = {
    ...w.overrides[road.id],
    points,
    nodeIds,
    x: 0,
    z: 0,
    rotation: 0,
    scale: 1,
  };
  return connected;
}
export function approachMarking(
  w: World,
  road: WorldObject,
  end: 'start' | 'end',
  type: 'stop' | 'give-way',
) {
  if ((road.oneway === 1 && end === 'start') || (road.oneway === -1 && end === 'end'))
    throw Error(
      'This is an outbound one-way approach; it cannot have an incoming stop/give-way line.',
    );
  const points = roadPoints(w, road),
    node = road.nodeIds![end === 'start' ? 0 : points.length - 1];
  const ordered = end === 'start' ? points : [...points].reverse();
  const incident = resolveObjects(w).filter(
    (o) => o.kind === 'road' && o.id !== road.id && o.nodeIds?.includes(node),
  );
  if (!incident.length)
    throw Error('This endpoint has no connected junction. Connect its topology first.');
  const setback = Math.max(...incident.map((o) => (o.width || 6) / 2)) + 1;
  let remain = setback;
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1],
      b = ordered[i],
      len = distance(a, b);
    if (remain > len) {
      remain -= len;
      continue;
    }
    const tx = (b[0] - a[0]) / len,
      tz = (b[1] - a[1]) / len,
      width = (road.width || 6) / (road.oneway ? 1 : 2),
      shift = road.oneway ? 0 : width / 2;
    // Approaching the node is opposite to the outward polyline; UK traffic occupies its left side.
    const centre: Point = [a[0] + tx * remain - tz * shift, a[1] + tz * remain + tx * shift];
    const mark = manualObject('marking', centre);
    mark.name = road.name + ' · authored ' + type + ' line';
    mark.width = width;
    mark.markingType = type;
    mark.rotation = (Math.atan2(-tx, tz) * 180) / Math.PI;
    mark.source.tags = {
      approach: road.id,
      node,
      end,
      purpose: type,
      placement: 'estimated setback; manually verify',
    };
    mark.source.inferred = [
      'Approach line setback estimated from connected road widths; manually verify against signs/source',
    ];
    return mark;
  }
  throw Error('Approach is too short to place a line before the junction conflict area.');
}
