// Where road markings start and stop at junctions (issue #4). One set of rules, read by the line painter
// (world.js), the give-way and stop-line placement (net.js) and the signs and approach markings (signs.js),
// so a give-way line, the lane lines leading up to it and the triangle before it always agree.
//
// A node is a junction when three or more roads meet there, or it is on a roundabout. A node where only two
// meet is a bend, a change of name or width or lane count on one road: the lines carry straight on through it.
import { laneInfo } from './net.js';

export const nodeDegree = (net, v) => new Set(net.inc[v].map(o => o.e.id)).size;
export const onRoundabout = (net, v) => net.inc[v].some(o => o.e.way.rb);
export const isJunction = (net, v) => nodeDegree(net, v) >= 3 || onRoundabout(net, v);
// how far the other roads at node v reach out from it: half the widest of them
export const junctionBox = (net, v, e) => Math.max(0, ...net.inc[v].filter(o => o.e !== e).map(o => o.e.way.w / 2));
// where the give-way (or stop) line goes on edge e approaching node v: just clear of the other carriageway
export const giveWayDist = (net, v, e) => junctionBox(net, v, e) + (onRoundabout(net, v) ? 0.8 : 1.0);
// how far before the line the long warning dashes begin (Traffic Signs Manual: lane lines lengthen on approach)
export const WARN = 38;

// distance from the line `f` (a give-way or stop line on edge f.e, facing f.dir) to the node it faces
export const toNode = (f) => (f.dir > 0 ? f.e.len - f.s : f.s);
export const facedNode = (f) => (f.dir > 0 ? f.e.b : f.e.a);

// How far the lane and centre lines stay back from each end of edge e: at a junction they stop at the
// give-way or stop line (or just short of the other carriageway if there is none); through a bend they
// carry on; at a dead end they stop just short.
export function markingEnds(net, e) { return [e.a, e.b].map((v, i) => endAt(net, e, v, i ? 1 : -1, 0)); }
// the clearance at node v for edge e (`toward` is the travel direction heading into v). Through a bend the
// lines carry on, unless a junction is only a few metres beyond it along the road: then they stop short of
// that junction just as if they reached it.
function endAt(net, e, v, toward, depth) {
  const deg = nodeDegree(net, v);
  if (deg <= 1) return { clear: 1, junction: false };
  if (!isJunction(net, v)) {
    const on = depth < 3 && net.inc[v].find(o => o.e !== e);
    if (!on || on.e.len > 20) return { clear: 0, junction: false };
    const far = on.e.a === v ? on.e.b : on.e.a, beyond = endAt(net, on.e, far, on.e.a === v ? 1 : -1, depth + 1);
    return beyond.junction ? { clear: Math.max(0, beyond.clear - on.e.len), junction: beyond.clear > on.e.len } : { clear: 0, junction: false };
  }
  let clear = giveWayDist(net, v, e) + 1.5;
  for (const f of (net.giveByEdge?.get(e.id) || []).concat((net.stopsByEdge?.get(e.id) || []).filter(s => !s.single)))
    if (f.dir === toward && toNode(f) < WARN) clear = Math.max(clear, toNode(f) + 1.2);
  return { clear, junction: true };
}

// Every dash of lane and centre line on edge e: { s, len, off } with s along the edge, off to the left of
// the edge direction. Lane dividers lengthen to 7 m dashes in the last 38 m before a junction.
export function lineDashes(net, e) {
  const wy = e.way, out = [];
  if (wy.rb || e.len <= 1) return out;
  const [A, B] = markingEnds(net, e), start = A.clear, end = e.len - B.clear;
  for (const dir of wy.oneway ? [1] : [1, -1]) {
    const L = laneInfo(e, dir);
    for (let k = 1; k < L.n; k++) {
      const off = (L.outer - L.laneW * k) * dir;
      for (let s = start; s + 1.2 < end; s += 9) {
        const toJ = dir > 0 ? (B.junction ? e.len - s : Infinity) : (A.junction ? s : Infinity);
        out.push({ s, len: Math.min(toJ < WARN ? 7 : 3, end - s), off, kind: 'lane' });
      }
    }
  }
  if (!wy.oneway && (/^(primary|secondary|tertiary|trunk)/.test(wy.cls) || wy.lanes >= 2))
    for (let s = start; s + 1.2 < end; s += 9) out.push({ s, len: Math.min(3.2, end - s), off: 0, kind: 'centre' });
  return out;
}
