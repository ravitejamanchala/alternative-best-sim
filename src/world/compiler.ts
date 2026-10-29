import ClipperLib from 'clipper-lib';
import clipping from 'polygon-clipping';
import type { World, Point, MultiPolygon, CompiledWorld, Diagnostic, WorldObject } from './types';
import { coordinates, resolveObjects, roadPoints } from './model';
import { inPolygon, ringArea, segmentDistance } from './geo';
const C = ClipperLib as any,
  SCALE = 1000;
const bufferCache = new Map<string, MultiPolygon>();
const path = (p: Point[]) =>
  p.map(([x, z]) => ({ X: Math.round(x * SCALE), Y: Math.round(z * SCALE) }));
export function buffer(points: Point[], radius: number): MultiPolygon {
  if (points.length < 2 || radius <= 0) return [];
  const key = radius + ':' + JSON.stringify(points);
  const cached = bufferCache.get(key);
  if (cached) return cached;
  const offset = new C.ClipperOffset(2, 0.025 * SCALE);
  offset.AddPath(path(points), C.JoinType.jtRound, C.EndType.etOpenRound);
  const tree = new C.PolyTree();
  offset.Execute(tree, radius * SCALE);
  const out: MultiPolygon = [];
  const ring = (node: any): Point[] => {
    const r: Point[] = node.Contour().map((v: any) => [v.X / SCALE, v.Y / SCALE]);
    return [...r, r[0]];
  };
  const walk = (node: any) => {
    for (const child of node.Childs()) {
      if (!child.IsHole())
        out.push([
          ring(child),
          ...child
            .Childs()
            .filter((n: any) => n.IsHole())
            .map(ring),
        ]);
      walk(child);
    }
  };
  walk(tree);
  if (points.length < 1000) {
    bufferCache.set(key, out);
    if (bufferCache.size > 512) bufferCache.delete(bufferCache.keys().next().value!);
  }
  return out;
}
export function union(shapes: MultiPolygon[]): MultiPolygon {
  const valid = shapes.filter((p) => p.length);
  if (!valid.length) return [];
  return clipping.union(valid[0], ...valid.slice(1)) as MultiPolygon;
}
export function area(p: MultiPolygon) {
  return p.reduce(
    (s, r) =>
      s + Math.abs(ringArea(r[0])) - r.slice(1).reduce((v, h) => v + Math.abs(ringArea(h)), 0),
    0,
  );
}
export const surfaceContains = (p: Point, s: MultiPolygon) => s.some((poly) => inPolygon(p, poly));
export function offsetPath(points: Point[], offset: number): Point[] {
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)],
      b = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] + ((b[1] - a[1]) / len) * offset, p[1] - ((b[0] - a[0]) / len) * offset];
  });
}
/** Dashes keep their phase around bends and source vertices. */
export function paintPath(points: Point[], width = 0.1, dash = 3, gap = 6): MultiPolygon {
  if (!gap) return buffer(points, width / 2);
  const shapes: MultiPolygon[] = [];
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let at = 0;
    while (at < len - 1e-7) {
      const phase = travelled % (dash + gap),
        draw = phase < dash;
      const step = Math.min(len - at, (draw ? dash : dash + gap) - phase);
      if (step < 1e-7) {
        travelled += 1e-7;
        continue;
      }
      if (draw)
        shapes.push(
          buffer(
            [
              [a[0] + ((b[0] - a[0]) * at) / len, a[1] + ((b[1] - a[1]) * at) / len],
              [
                a[0] + ((b[0] - a[0]) * (at + step)) / len,
                a[1] + ((b[1] - a[1]) * (at + step)) / len,
              ],
            ],
            width / 2,
          ),
        );
      at += step;
      travelled += step;
    }
  }
  return union(shapes);
}
export function selfIntersects(r: Point[]) {
  for (let i = 0; i < r.length - 1; i++)
    for (let j = i + 2; j < r.length - 1; j++) {
      if (i === 0 && j === r.length - 2) continue;
      const a = r[i],
        b = r[i + 1],
        c = r[j],
        d = r[j + 1],
        cross = (p: Point, q: Point, t: Point) =>
          (q[0] - p[0]) * (t[1] - p[1]) - (q[1] - p[1]) * (t[0] - p[0]);
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true;
    }
  return false;
}
export function compile(w: World): CompiledWorld {
  const started = performance.now(),
    objects = resolveObjects(w),
    roads = objects.filter((o) => o.kind === 'road'),
    diagnostics: Diagnostic[] = w.sourceIssues.map((message) => ({
      code: 'source-coverage',
      severity: 'warning',
      message,
    }));
  const surfaces: MultiPolygon[] = [],
    envelopes: MultiPolygon[] = [];
  for (const o of roads) {
    const p = roadPoints(w, o);
    surfaces.push(buffer(p, o.width! / 2));
    if (!['no', 'none', 'separate'].includes(o.sidewalk || '')) {
      // Offset whole polylines, then subtract the shared road union. No per-segment pavement rectangles.
      let env = buffer(p, o.width! / 2 + 1.8);
      if (o.sidewalk === 'left' || o.sidewalk === 'right') {
        const side: Point[] = [];
        for (let i = 0; i < p.length; i++) {
          const a = p[Math.max(0, i - 1)],
            b = p[Math.min(p.length - 1, i + 1)],
            len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1,
            k = o.sidewalk === 'left' ? 1 : -1;
          side.push([
            p[i][0] + ((k * (b[1] - a[1])) / len) * (o.width! / 2 + 0.9),
            p[i][1] - ((k * (b[0] - a[0])) / len) * (o.width! / 2 + 0.9),
          ]);
        }
        env = buffer(side, 0.9);
      }
      envelopes.push(env);
    }
    for (let i = 1; i < p.length; i++)
      if (Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) < 0.02)
        diagnostics.push({
          code: 'short-segment',
          severity: 'warning',
          objectId: o.id,
          point: p[i],
          message: 'Duplicate or sub-2 cm road segment',
        });
  }
  for (const o of objects.filter((o) => o.kind === 'junction')) {
    const rings = o.rings!.map((r) => coordinates(o, r));
    if (rings.some(selfIntersects)) continue;
    surfaces.push([rings]);
    // Authored junction boundaries join the same asphalt and pavement unions.
    if (o.sidewalk !== 'no') envelopes.push(union([[rings], ...rings.map((r) => buffer(r, 1.8))]));
  }
  const asphalt = union(surfaces);
  let pavement = envelopes.length
    ? (clipping.difference(union(envelopes), asphalt) as MultiPolygon)
    : [];
  const gaps = objects
    .filter((o) => o.kind === 'zone' && o.source.tags.purpose === 'pavement-gap' && o.rings)
    .map((o) => [o.rings!.map((r) => coordinates(o, r))]);
  if (gaps.length) pavement = clipping.difference(pavement, union(gaps)) as MultiPolygon;
  const neighbours = new Map<string, { ids: Set<string>; point: Point; width: number }>();
  for (const r of roads) {
    const p = roadPoints(w, r);
    r.nodeIds!.forEach((id, i) => {
      const node = neighbours.get(id) || { ids: new Set<string>(), point: p[i], width: 0 };
      if (i) node.ids.add(r.nodeIds![i - 1]);
      if (i < p.length - 1) node.ids.add(r.nodeIds![i + 1]);
      node.width = Math.max(node.width, r.width || 6);
      neighbours.set(id, node);
    });
  }
  const conflict = union(
    [...neighbours.values()]
      .filter((n) => n.ids.size > 2)
      .map((n) => buffer([n.point, [n.point[0] + 0.001, n.point[1]]], n.width * 0.65)),
  );
  const paint: MultiPolygon[] = [];
  for (const o of objects) {
    if (o.kind === 'road' && o.source.tags.lane_markings === 'yes' && (o.lanes || 1) > 1) {
      const lines = union(
        Array.from({ length: o.lanes! - 1 }, (_, i) =>
          paintPath(
            offsetPath(roadPoints(w, o), ((i + 1 - o.lanes! / 2) * (o.width || 6)) / o.lanes!),
          ),
        ),
      );
      paint.push(conflict.length ? (clipping.difference(lines, conflict) as MultiPolygon) : lines);
    }
    if (o.kind === 'lane') {
      const points = coordinates(o),
        half = ((o.width || 3) * o.scale) / 2;
      paint.push(
        union(
          [-half, half].map((offset) =>
            paintPath(offsetPath(points, offset), 0.1, 3, o.markingType === 'solid' ? 0 : 6),
          ),
        ),
      );
      if (points.some((p) => !surfaceContains(p, asphalt)))
        diagnostics.push({
          code: 'lane-clearance',
          severity: 'warning',
          objectId: o.id,
          point: [o.x, o.z],
          message:
            'Lane guide leaves the carriageway; paint is clipped to asphalt. Repair its control points.',
        });
    }
    if (o.kind === 'marking') {
      const half = (o.width || 2.4) / 2,
        thick = o.markingType === 'stop' ? 0.2 : 0.1;
      const line = (z: number) =>
        paintPath(
          coordinates(o, [
            [-half, z],
            [half, z],
          ]),
          thick,
          o.markingType === 'give-way' ? 0.6 : 3,
          o.markingType === 'give-way' ? 0.3 : o.markingType === 'dashed' ? 6 : 0,
        );
      paint.push(o.markingType === 'give-way' ? union([line(-0.15), line(0.15)]) : line(0));
    }
  }
  const markings =
    paint.length && asphalt.length
      ? (clipping.intersection(union(paint), asphalt) as MultiPolygon)
      : [];
  // Never trim a mapped building to hide a conflict. Preserve it and diagnose the overlap.
  for (const o of objects) {
    if (o.kind === 'road') continue;
    const p: [number, number] = [o.x, o.z];
    if (o.rings) {
      const rings = o.rings.map((r) => coordinates(o, r));
      if (rings.some(selfIntersects))
        diagnostics.push({
          code: 'self-intersection',
          severity: 'error',
          objectId: o.id,
          point: p,
          message: 'Footprint crosses itself; repair outline before export.',
        });
      else if (
        o.kind === 'building' &&
        asphalt.length &&
        area(clipping.intersection([rings], asphalt) as MultiPolygon) > 0.2
      )
        diagnostics.push({
          code: 'road-clearance',
          severity: 'warning',
          objectId: o.id,
          point: p,
          message: 'Mapped building overlaps estimated carriageway; verify road width.',
        });
    } else if (
      ['tree', 'sign', 'signal'].includes(o.kind) &&
      roads.some((r) => {
        const rp = roadPoints(w, r);
        return rp
          .slice(1)
          .some((b, i) => segmentDistance(p, rp[i], b) < r.width! / 2 + (o.width || 0.2) / 2 + 0.3);
      })
    )
      diagnostics.push({
        code: 'road-clearance',
        severity: 'error',
        objectId: o.id,
        point: p,
        message: 'Roadside object intersects the carriageway clearance.',
      });
  }
  if (!asphalt.length)
    diagnostics.push({
      code: 'no-roads',
      severity: 'warning',
      message: 'No supported drivable roads in this area.',
    });
  const all = roads.flatMap((o) => roadPoints(w, o));
  const xs = all.map((p) => p[0]),
    zs = all.map((p) => p[1]);
  return {
    asphalt,
    pavement,
    markings,
    objects,
    diagnostics,
    elapsedMs: performance.now() - started,
    area: area(pavement) + area(asphalt),
    roadArea: area(asphalt),
    boundary: all.length
      ? [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]
      : [-100, -100, 100, 100],
  };
}
export class SpatialIndex<T> {
  private cells = new Map<string, Set<T>>();
  constructor(public size = 25) {}
  insert(item: T, minX: number, minZ: number, maxX: number, maxZ: number) {
    for (let x = Math.floor(minX / this.size); x <= Math.floor(maxX / this.size); x++)
      for (let z = Math.floor(minZ / this.size); z <= Math.floor(maxZ / this.size); z++) {
        const k = x + ',' + z;
        if (!this.cells.has(k)) this.cells.set(k, new Set());
        this.cells.get(k)!.add(item);
      }
  }
  query(x: number, z: number, r = 0): T[] {
    const out = new Set<T>();
    for (let i = Math.floor((x - r) / this.size); i <= Math.floor((x + r) / this.size); i++)
      for (let j = Math.floor((z - r) / this.size); j <= Math.floor((z + r) / this.size); j++)
        this.cells.get(i + ',' + j)?.forEach((v) => out.add(v));
    return [...out];
  }
}
export function collisionIndex(c: CompiledWorld) {
  const idx = new SpatialIndex<WorldObject>();
  for (const o of c.objects.filter((o) =>
    ['building', 'tree', 'sign', 'signal'].includes(o.kind),
  )) {
    const p = o.rings
      ? coordinates(o, o.rings[0])
      : [
          [o.x - (o.width || 1), o.z - (o.width || 1)],
          [o.x + (o.width || 1), o.z + (o.width || 1)],
        ];
    idx.insert(
      o,
      Math.min(...p.map((p) => p[0])),
      Math.min(...p.map((p) => p[1])),
      Math.max(...p.map((p) => p[0])),
      Math.max(...p.map((p) => p[1])),
    );
  }
  return idx;
}
