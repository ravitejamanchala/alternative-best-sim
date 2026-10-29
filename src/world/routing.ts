import type { World, Point } from './types';
import { resolveObjects, roadPoints } from './model';
import { distance, ringArea } from './geo';
export interface Arc {
  from: string;
  to: string;
  way: string;
  length: number;
}
export function graph(w: World) {
  const nodes = new Map<string, Point>(),
    out = new Map<string, Arc[]>();
  for (const o of resolveObjects(w).filter((o) => o.kind === 'road')) {
    const tags = o.source.tags;
    if (
      ['reversible', 'alternating'].includes(tags.oneway) ||
      Object.keys(tags).some((k) => /^(oneway|access|motorcar|motor_vehicle):conditional$/.test(k))
    )
      continue;
    const p = roadPoints(w, o);
    p.forEach((v, i) => nodes.set(o.nodeIds![i], v));
    for (let i = 1; i < p.length; i++) {
      const a = o.nodeIds![i - 1],
        b = o.nodeIds![i],
        len = distance(p[i - 1], p[i]);
      const add = (from: string, to: string) => {
        if (!out.has(from)) out.set(from, []);
        out.get(from)!.push({ from, to, way: o.id, length: len });
      };
      if (o.oneway !== -1) add(a, b);
      if (o.oneway !== 1) add(b, a);
    }
  }
  return { nodes, out };
}
export function route(
  w: World,
  stops: string[],
  mode: 'route' | 'clockwise' | 'anticlockwise' = 'route',
) {
  if (w.sourceIssues.some((s) => s.startsWith('Unsupported via-way or conditional restriction')))
    throw Error(
      'Known complex turn restrictions require review before routing this area. No unrestricted fallback route is generated.',
    );
  const g = graph(w);
  if (stops.length < 2 || new Set(stops).size < 2)
    throw Error('Choose distinct start and destination pins.');
  let result: string[] = [],
    prior: string | undefined;
  for (let leg = 1; leg < stops.length; leg++) {
    const start = stops[leg - 1],
      end = stops[leg];
    if (!g.nodes.has(start) || !g.nodes.has(end))
      throw Error('Waypoint is no longer on the network.');
    type S = { id: string; way?: string; cost: number; path: string[] };
    const queue: S[] = [{ id: start, way: prior, cost: 0, path: [start] }],
      best = new Map<string, number>();
    let found: S | undefined;
    while (queue.length) {
      queue.sort((a, b) => b.cost - a.cost);
      const s = queue.pop()!,
        key = s.id + '|' + s.way;
      if ((best.get(key) ?? Infinity) <= s.cost) continue;
      best.set(key, s.cost);
      if (s.id === end) {
        found = s;
        break;
      }
      for (const a of g.out.get(s.id) || []) {
        const rules = w.restrictions.filter((r) => r.via === s.id && r.from === s.way);
        if (rules.some((r) => (r.only ? a.way !== r.to : a.way === r.to))) continue;
        queue.push({ id: a.to, way: a.way, cost: s.cost + a.length, path: [...s.path, a.to] });
      }
    }
    if (!found)
      throw Error(
        'No connected, permitted practice route between these pins. Try different roads.',
      );
    prior = found.way;
    result.push(...(leg === 1 ? found.path : found.path.slice(1)));
  }
  return { nodeIds: result, points: result.map((id) => g.nodes.get(id)!), mode };
}
export function loop(w: World, start: string, clockwise: boolean) {
  const g = graph(w);
  if (!g.nodes.has(start)) throw Error('Choose a start pin.');
  if (w.sourceIssues.some((s) => s.startsWith('Unsupported via-way or conditional restriction')))
    throw Error('Known complex turn restrictions require review before practice loop generation.');
  // Bounded deterministic cycle search: simple cycles only, every directed arc and turn checked.
  const stack: { nodes: string[]; way?: string; length: number }[] = [
    { nodes: [start], length: 0 },
  ];
  let expanded = 0;
  while (stack.length && expanded++ < 20000) {
    const s = stack.pop()!,
      at = s.nodes.at(-1)!;
    for (const a of g.out.get(at) || []) {
      if (s.length + a.length > 2500) continue;
      const rules = w.restrictions.filter((r) => r.via === at && r.from === s.way);
      if (rules.some((r) => (r.only ? a.way !== r.to : a.way === r.to))) continue;
      if (a.to === start && s.nodes.length > 3 && s.length > 80) {
        const points = [...s.nodes, start].map((id) => g.nodes.get(id)!);
        const signed = ringArea(points);
        if (Math.abs(signed) > 50 && signed > 0 === clockwise) {
          const firstWay = (g.out.get(start) || []).find((e) => e.to === s.nodes[1])?.way;
          const endRules = w.restrictions.filter((r) => r.via === start && r.from === a.way);
          if (endRules.some((r) => (r.only ? firstWay !== r.to : firstWay === r.to))) continue;
          return {
            nodeIds: [...s.nodes, start],
            points,
            mode: clockwise ? ('clockwise' as const) : ('anticlockwise' as const),
          };
        }
      } else if (!s.nodes.includes(a.to) && s.nodes.length < 120)
        stack.push({ nodes: [...s.nodes, a.to], way: a.way, length: s.length + a.length });
    }
  }
  throw Error(
    'No suitable ' +
      (clockwise ? 'clockwise' : 'anticlockwise') +
      ' loop found within the 2.5 km / 20,000-state search budget. Try another start.',
  );
}
export function nearestNode(w: World, p: Point) {
  let id = '',
    best = Infinity;
  for (const [key, v] of graph(w).nodes) {
    const d = distance(p, v);
    if (d < best) {
      id = key;
      best = d;
    }
  }
  return id;
}
