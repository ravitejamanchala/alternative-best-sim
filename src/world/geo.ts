import type { Point } from './types';
export const EARTH = 6378137;
export function factors(origin: Point): Point {
  return [(Math.PI / 180) * EARTH * Math.cos((origin[0] * Math.PI) / 180), (Math.PI / 180) * EARTH];
}
export function toWorld(lat: number, lon: number, origin: Point): Point {
  const [kx, kz] = factors(origin);
  return [(lon - origin[1]) * kx, (origin[0] - lat) * kz];
}
export function toGeo(x: number, z: number, origin: Point): Point {
  const [kx, kz] = factors(origin);
  return [origin[0] - z / kz, origin[1] + x / kx];
}
export const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function centroid(ring: Point[]): Point {
  const r = ring.length > 1 && distance(ring[0], ring.at(-1)!) < 0.001 ? ring.slice(0, -1) : ring;
  return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
}
export function ringArea(r: Point[]): number {
  return (
    r.reduce((s, p, i) => {
      const q = r[(i + 1) % r.length];
      return s + (p[0] * q[1] - q[0] * p[1]);
    }, 0) / 2
  );
}
export function inRing(p: Point, r: Point[]): boolean {
  let yes = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i],
      b = r[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      yes = !yes;
  }
  return yes;
}
export function inPolygon(p: Point, r: Point[][]) {
  return !!r[0] && inRing(p, r[0]) && !r.slice(1).some((h) => inRing(p, h));
}
export function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    u = Math.max(
      0,
      Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)),
    );
  return distance(p, [a[0] + u * dx, a[1] + u * dz]);
}
