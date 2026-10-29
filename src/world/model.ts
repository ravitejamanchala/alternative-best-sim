import { z } from 'zod';
import type { World, WorldObject, Point } from './types';
import { centroid } from './geo';
const finite = z.number().finite().min(-1e6).max(1e6),
  point = z.tuple([finite, finite]);
const object = z
  .object({
    id: z.string().min(1).max(150),
    kind: z.enum([
      'road',
      'junction',
      'lane',
      'building',
      'tree',
      'sign',
      'signal',
      'parking',
      'checkpoint',
      'zone',
      'marking',
      'spawn',
    ]),
    name: z.string().max(300),
    x: finite,
    y: finite,
    z: finite,
    rotation: finite,
    scale: z.number().positive().max(100),
    points: z.array(point).min(2).max(10000).optional(),
    nodeIds: z.array(z.string()).max(10000).optional(),
    rings: z.array(z.array(point).min(4).max(10000)).max(100).optional(),
    width: z.number().positive().max(100).optional(),
    height: z.number().positive().max(500).optional(),
    length: z.number().positive().max(500).optional(),
    markingType: z.enum(['solid', 'dashed', 'stop', 'give-way']).optional(),
    lanes: z.number().int().min(1).max(12).optional(),
    oneway: z.union([z.literal(-1), z.literal(0), z.literal(1)]).optional(),
    source: z.object({
      provider: z.enum(['osm', 'overture', 'manual', 'legacy']),
      id: z.string(),
      confidence: z.enum(['source', 'estimated', 'manual']),
      tags: z.record(z.string(), z.string()),
      inferred: z.array(z.string()),
    }),
  })
  .passthrough();
const schema = z.object({
  schema: z.literal('slaydrive-world'),
  version: z.literal(1),
  id: z.string().min(1).max(150),
  title: z.string().min(1).max(200),
  geo: z.object({
    origin: z.tuple([z.number().min(49).max(61), z.number().min(-9).max(3)]),
    projection: z.literal('local-equirectangular'),
    axes: z.literal('X east, Y up, Z south'),
    units: z.literal('metres'),
    elevationDatum: z.literal('flat local zero; not surveyed'),
  }),
  bounds: z.tuple([finite, finite, finite, finite]),
  attribution: z.array(z.string()),
  sourceDate: z.string(),
  sourceObjects: z.array(object).max(20000),
  additions: z.array(object).max(20000),
  overrides: z.record(z.string(), object.partial().extend({ deleted: z.boolean().optional() })),
  nodeOverrides: z.record(z.string(), point),
  restrictions: z.array(
    z.object({ from: z.string(), to: z.string(), via: z.string(), only: z.boolean() }),
  ),
  sourceIssues: z.array(z.string()),
  spawn: z.object({ x: finite, z: finite, heading: finite }),
  route: z
    .object({
      nodeIds: z.array(z.string()).max(50000),
      points: z.array(point).max(50000),
      mode: z.enum(['route', 'clockwise', 'anticlockwise']),
    })
    .nullable(),
  legacy: z.unknown().optional(),
});
export const MAX_BYTES = 20 * 1024 * 1024;
export function validateWorld(value: unknown): World {
  const checked = schema.safeParse(value);
  if (!checked.success)
    throw new Error(
      'Invalid world: ' +
        checked.error.issues
          .slice(0, 3)
          .map((e) => e.path.join('.') + ' ' + e.message)
          .join('; '),
    );
  const w = value as World;
  const ids = new Set<string>();
  for (const o of [...w.sourceObjects, ...w.additions]) {
    if (['__proto__', 'constructor', 'prototype'].includes(o.id)) throw Error('Reserved object ID');
    if (ids.has(o.id)) throw Error('Duplicate object ID: ' + o.id);
    ids.add(o.id);
  }
  for (const [id, patch] of Object.entries(w.overrides)) {
    if (!ids.has(id)) throw Error('Override refers to missing object ' + id);
    if (patch.id && patch.id !== id) throw Error('Override cannot change a source ID');
  }
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  for (const o of resolveObjects(w)) {
    if (o.kind === 'road' && (!o.points || !o.nodeIds || o.points.length !== o.nodeIds.length))
      throw Error('Road requires matching nodes and points: ' + o.id);
    if (o.kind === 'road' && !o.width)
      throw Error('Road requires a positive carriageway width: ' + o.id);
    if (o.kind === 'building' && !o.rings?.length)
      throw Error('Building requires a footprint: ' + o.id);
    if (o.kind === 'junction' && !o.rings?.length)
      throw Error('Junction requires a boundary: ' + o.id);
    if (o.kind === 'lane' && !o.points?.length)
      throw Error('Lane requires control points: ' + o.id);
    for (const ring of o.rings || []) {
      if (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1])
        throw Error('Footprint ring is not closed: ' + o.id);
    }
    const points =
      o.kind === 'road'
        ? roadPoints(w, o)
        : o.points
          ? coordinates(o)
          : o.rings
            ? o.rings.flatMap((r) => coordinates(o, r))
            : [[o.x, o.z]];
    for (const [x, z] of points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    if (maxX - minX > 4000 || maxZ - minZ > 4000)
      throw Error(
        'World geometry exceeds the explicit 4 × 4 km safety envelope (including complete source ways). Split the world before import.',
      );
  }
  return w;
}
export function parseWorld(text: string): World {
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES)
    throw Error('Import exceeds the explicit 20 MiB limit. Split the area before importing.');
  return validateWorld(JSON.parse(text));
}
export function resolveObjects(w: World): WorldObject[] {
  return [...w.sourceObjects, ...w.additions]
    .filter((o) => !w.overrides[o.id]?.deleted)
    .map((o) => ({ ...o, ...w.overrides[o.id] }));
}
export function coordinates(o: WorldObject, points = o.points || o.rings?.[0] || []): Point[] {
  const a = (o.rotation * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return points.map(([x, z]) => [o.x + (x * c - z * s) * o.scale, o.z + (x * s + z * c) * o.scale]);
}
export function roadPoints(w: World, o: WorldObject): Point[] {
  return coordinates(o).map((p, i) => w.nodeOverrides[o.nodeIds?.[i] || ''] || p);
}
export function setVertex(w: World, o: WorldObject, index: number, p: Point, ringIndex = 0) {
  if (o.kind === 'road' && o.nodeIds) {
    w.nodeOverrides[o.nodeIds[index]] = p;
    return;
  }
  const a = (-o.rotation * Math.PI) / 180,
    dx = (p[0] - o.x) / o.scale,
    dz = (p[1] - o.z) / o.scale;
  const local: Point = [dx * Math.cos(a) - dz * Math.sin(a), dx * Math.sin(a) + dz * Math.cos(a)];
  if (o.points) {
    const points = structuredClone(o.points);
    points[index] = local;
    w.overrides[o.id] = { ...w.overrides[o.id], points };
    return;
  }
  const rings = structuredClone(o.rings!);
  rings[ringIndex][index] = local;
  if (index === 0) rings[ringIndex][rings[ringIndex].length - 1] = rings[ringIndex][0];
  w.overrides[o.id] = { ...w.overrides[o.id], rings };
}
export function transformObject(w: World, id: string, patch: Partial<WorldObject>) {
  const o = resolveObjects(w).find((o) => o.id === id);
  if (!o) return;
  if (
    o.kind === 'road' &&
    o.nodeIds &&
    (patch.x !== undefined ||
      patch.z !== undefined ||
      patch.rotation !== undefined ||
      patch.scale !== undefined)
  ) {
    const existing = roadPoints(w, o);
    const centre = centroid(existing),
      a = (((patch.rotation ?? o.rotation) - o.rotation) * Math.PI) / 180,
      scale = (patch.scale ?? o.scale) / o.scale;
    existing.forEach(([x, z], i) => {
      const dx = x - centre[0],
        dz = z - centre[1];
      w.nodeOverrides[o.nodeIds![i]] = [
        centre[0] + (patch.x ?? o.x) - o.x + (dx * Math.cos(a) - dz * Math.sin(a)) * scale,
        centre[1] + (patch.z ?? o.z) - o.z + (dx * Math.sin(a) + dz * Math.cos(a)) * scale,
      ];
    });
  }
  w.overrides[id] = { ...w.overrides[id], ...patch };
}
export class History<T> {
  past: T[] = [];
  future: T[] = [];
  trimmed = false;
  constructor(
    public value: T,
    private budget = 64 * 1024 * 1024,
  ) {}
  commit(v: T) {
    this.past.push(this.value);
    this.future = [];
    this.value = v;
    let used = 0;
    for (let i = this.past.length - 1; i >= 0; i--) {
      used += JSON.stringify(this.past[i]).length * 2;
      if (used > this.budget) {
        this.past.splice(0, i + 1);
        this.trimmed = true;
        break;
      }
    }
    return v;
  }
  undo() {
    const v = this.past.pop();
    if (v) {
      this.future.push(this.value);
      this.value = v;
    }
    return this.value;
  }
  redo() {
    const v = this.future.pop();
    if (v) {
      this.past.push(this.value);
      this.value = v;
    }
    return this.value;
  }
}
