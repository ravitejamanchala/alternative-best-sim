// Road network: decodes the map file, answers "where am I on the road?", routes, and writes examiner instructions.
import { isJunction, giveWayDist, toNode, facedNode } from './markings.js';

const CELL = 40;
const ck = (cx, cz) => (cx + 4000) * 8192 + (cz + 4000);

export async function loadNet(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Map data did not load (' + r.status + ')');
  return buildNet(await r.json());
}

export function buildNet(d) {
  const net = { origin: d.origin, kx: d.kx, kz: d.kz, names: d.names, chunkSize: 400 };
  // motorway extras: the central reservation barrier, the blue junction signs, and the junction list
  net.barriers = (d.barriers || []).map(f => { const out = []; for (let i = 0; i < f.length; i += 2) out.push([f[i] / 10, f[i + 1] / 10]); return out; });
  net.mwSigns = d.mwSigns || []; net.motorway = d.motorway || null;
  // cl/cr: cycle lane on the left/right of the way's direction (0 none, 1 advisory, 2 mandatory, 3 separate track); cw: lane width
  const ways = d.ways.map(w => ({ name: d.names[w[0]], cls: d.classes[w[1]], mph: w[2], assumed: !!w[3], oneway: w[4], w: w[5], rb: !!w[6], lanes: w[7], cl: w[8] || 0, cr: w[9] || 0, cw: (w[10] || 15) / 10, hs: (w[11] || 0) / 10 }));
  const nN = d.nodes.length / 2;
  const nx = new Float32Array(nN), nz = new Float32Array(nN);
  for (let i = 0; i < nN; i++) { nx[i] = d.nodes[2 * i] / 10; nz[i] = d.nodes[2 * i + 1] / 10; }
  const edges = d.edges.map(([a, b, wi, f], id) => {
    const n = f.length / 2, px = new Float32Array(n), pz = new Float32Array(n), cum = new Float32Array(n);
    for (let i = 0; i < n; i++) { px[i] = f[2 * i] / 10; pz[i] = f[2 * i + 1] / 10; if (i) cum[i] = cum[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]); }
    return { id, a, b, way: ways[wi], px, pz, cum, len: Math.max(cum[n - 1], 0.01), n };
  });
  const out = Array.from({ length: nN }, () => []), inc = Array.from({ length: nN }, () => []);
  for (const e of edges) {
    out[e.a].push({ e, dir: 1 }); inc[e.a].push({ e, dir: 1 }); inc[e.b].push({ e, dir: -1 });
    if (!e.way.oneway) out[e.b].push({ e, dir: -1 });
  }
  Object.assign(net, { ways, nx, nz, edges, out, inc });

  // spatial grids
  const grid = new Map(), chunks = new Map(), C = net.chunkSize;
  for (const e of edges) {
    for (let i = 0; i < e.n - 1; i++) {
      const x0 = Math.min(e.px[i], e.px[i + 1]) - 12, x1 = Math.max(e.px[i], e.px[i + 1]) + 12;
      const z0 = Math.min(e.pz[i], e.pz[i + 1]) - 12, z1 = Math.max(e.pz[i], e.pz[i + 1]) + 12;
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
        for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
          const k = ck(cx, cz); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(e.id, i);
        }
      for (let cx = Math.floor(x0 / C); cx <= Math.floor(x1 / C); cx++)
        for (let cz = Math.floor(z0 / C); cz <= Math.floor(z1 / C); cz++) {
          const k = ck(cx, cz); let s = chunks.get(k); if (!s) chunks.set(k, s = new Set()); s.add(e);
        }
    }
  }
  net.grid = grid; net.chunks = chunks; net.ck = ck;

  // point features
  net.stops = d.stops.map(([ei, s, dir, cluster, group], id) => feature(net, { id, e: edges[ei], s: s / 10, dir, cluster, group }));
  const cl = new Map();
  for (const st of net.stops) { const c = cl.get(st.cluster) || new Set(); c.add(st.group); cl.set(st.cluster, c); }
  for (const st of net.stops) { st.single = cl.get(st.cluster).size < 2; st.offset = (st.cluster * 7.37) % 32; }
  net.zebras = d.zebras.map(([ei, s], id) => feature(net, { id, e: edges[ei], s: s / 10, dir: 1 }));
  // Surveyed street-lamp positions, where the map has them. Flat x,z pairs in decimetres.
  net.lamps = []; for (let i = 0; d.lamps && i < d.lamps.length; i += 2) net.lamps.push([d.lamps[i] / 10, d.lamps[i + 1] / 10]);
  net.giveways = d.giveways.map(([ei, s, dir, stop]) => feature(net, { e: edges[ei], s: s / 10, dir, stop: !!stop }));
  net.minis = d.minis.map(([x, z]) => ({ x: x / 10, z: z / 10 }));
  net.rbs = d.rbs.map(([x, z, r, w]) => ({ x: x / 10, z: z / 10, r: r / 10, w: w / 10 }));
  // lane arrows painted on an approach, kerb lane first: e.g. ['LS', 'R'] (L left, S straight on, R right)
  net.arrows = new Map(); for (const [ei, dir, ...codes] of d.arrows || []) net.arrows.set(ei + ':' + dir, codes);
  // Dutch-style roundabouts: a one-way (clockwise) cycle track ringing the carriageway, crossing every arm
  net.cycleRings = (d.cycleRings || []).map(([x, z, r]) => ringCrossings(net, { x: x / 10, z: z / 10, r: r / 10 }));
  net.stopsByEdge = new Map(); net.zebrasByEdge = new Map();
  for (const s of net.stops) push(net.stopsByEdge, s.e.id, s);
  for (const z of net.zebras) push(net.zebrasByEdge, z.e.id, z);
  // KEEP CLEAR across the lanes of one direction, centred `s` along the edge and `len` long; only where a
  // map or layout configures it, never by rule (issue #4)
  net.keepClear = (d.keepClear || []).map(([ei, s, dir, len]) => feature(net, { e: edges[ei], s: s / 10, dir, len: (len || 100) / 10 }));
  // yellow box junctions, each over the node at the end of its edge (issue #5); the box itself is js/box-junction.js
  net.boxes = (d.boxes || []).map(([ei, s, dir]) => ({ e: edges[ei], s: s / 10, dir, node: dir > 0 ? edges[ei].b : edges[ei].a }));
  tidyJunctionLines(net);
  net.fillets = junctionFillets(net);
  net.stopGrid = new Map();
  for (const s of net.stops) push(net.stopGrid, ck(Math.floor(s.x / CELL), Math.floor(s.z / CELL)), s);
  return net;
}
// where each road crosses a cycle ring: the crossing point, and which way is "into the roundabout"
function ringCrossings(net, ring) {
  ring.crossings = [];
  for (const e of net.edges) {
    if (e.way.rb) continue;
    for (let i = 0; i < e.n - 1; i++) {
      const d0 = Math.hypot(e.px[i] - ring.x, e.pz[i] - ring.z) - ring.r, d1 = Math.hypot(e.px[i + 1] - ring.x, e.pz[i + 1] - ring.z) - ring.r;
      if ((d0 < 0) === (d1 < 0)) continue;
      const u = d0 / (d0 - d1), x = e.px[i] + (e.px[i + 1] - e.px[i]) * u, z = e.pz[i] + (e.pz[i + 1] - e.pz[i]) * u;
      ring.crossings.push({ x, z, e, s: e.cum[i] + (e.cum[i + 1] - e.cum[i]) * u, ang: Math.atan2(x - ring.x, -(z - ring.z)), w: e.way.w });
    }
  }
  return ring;
}
// Rounded kerbs at junctions: where two roads meet, the sharp kerb corner is replaced by a curve of radius R
// (6 m on side streets, 9 m on main roads), so a car can actually turn from its lane into the next one.
// Each fillet: corner C, tangent points A (on road i's kerb) and B (on road j's kerb), and the curve between them.
function junctionFillets(net) {
  const out = [];
  for (let v = 0; v < net.nx.length; v++) {
    const inc = net.inc[v]; if (inc.length < 2) continue;
    if (inc.length === 2 && !inc.some(o => o.e.way.rb)) continue; // a bend in one road, not a junction
    const x = net.nx[v], z = net.nz[v];
    const arms = inc.map(o => { const e = o.e, d = Math.min(10, e.len * 0.5), p = posAt(e, o.dir > 0 ? d : e.len - d), ux = p.x - x, uz = p.z - z, L = Math.hypot(ux, uz) || 1; return { e, ux: ux / L, uz: uz / L, h: e.way.w / 2, ang: Math.atan2(uz / L, ux / L), len: e.len }; })
      .sort((a, b) => a.ang - b.ang);
    for (let i = 0; i < arms.length; i++) {
      const a = arms[i], b = arms[(i + 1) % arms.length];
      let gap = b.ang - a.ang; if (gap <= 0) gap += 2 * Math.PI;
      if (gap > Math.PI * 0.95 || gap < 0.35) continue; // nearly straight on, or too tight a wedge to round
      if (a.e.way.rb && b.e.way.rb) continue;
      // kerb lines: road a offset towards b by its half width, road b offset towards a
      const na = [-a.uz, a.ux], nb = [b.uz, -b.ux]; // a's left side faces b (counter-clockwise order); b's right side faces a
      const pa = [x + na[0] * a.h, z + na[1] * a.h], pb = [x + nb[0] * b.h, z + nb[1] * b.h];
      const det = a.ux * (-b.uz) - a.uz * (-b.ux); if (Math.abs(det) < 1e-3) continue;
      const t = ((pb[0] - pa[0]) * (-b.uz) - (pb[1] - pa[1]) * (-b.ux)) / det;
      const C = [pa[0] + a.ux * t, pa[1] + a.uz * t];
      const main = /^(trunk|primary|secondary)/.test(a.e.way.cls) || /^(trunk|primary|secondary)/.test(b.e.way.cls) || a.e.way.rb || b.e.way.rb;
      const R = Math.min(main ? 9 : 6, a.len * 0.35, b.len * 0.35);
      const ca = Math.hypot(C[0] - x, C[1] - z); if (ca > 40) continue;
      const A = [C[0] + a.ux * R, C[1] + a.uz * R], B = [C[0] + b.ux * R, C[1] + b.uz * R];
      const pts = []; for (let k = 0; k <= 10; k++) { const u = k / 10, m = 1 - u; pts.push([m * m * A[0] + 2 * u * m * C[0] + u * u * B[0], m * m * A[1] + 2 * u * m * C[1] + u * u * B[1]]); }
      out.push({ node: v, nx: x, nz: z, C, A, B, pts, R, w: Math.max(a.e.way.w, b.e.way.w) });
    }
  }
  return out;
}
// is (x, z) on the rounded part of a junction corner (road surface the edge ribbons don't cover)?
export function inFillet(net, x, z) {
  for (const f of net.fillets) {
    if (Math.abs(x - f.C[0]) > f.R + 1 || Math.abs(z - f.C[1]) > f.R + 1) continue;
    // inside polygon C, A, curve…, B
    const poly = [f.C, ...f.pts]; let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside; }
    if (inside) return true;
  }
  return false;
}
function push(m, k, v) { let a = m.get(k); if (!a) m.set(k, a = []); a.push(v); }
// Give-way and stop lines at the mouth of the junction they serve, one per approach (issue #4). Lines from
// the map that sat inside the other carriageway, or a few metres back from where a learner would stop,
// move to the mouth; a second line on the same approach (the map had both ends of a bell-mouth) is
// dropped, so a learner is never marked twice for one junction. Surveyed stop lines (the `stop` flag)
// stay where they were seen unless that is inside the junction, as do traffic-light stop lines.
function tidyJunctionLines(net) {
  const kept = [], byApproach = new Map();
  for (const g of net.giveways) {
    const v = facedNode(g);
    if (isJunction(net, v)) {
      const want = giveWayDist(net, v, g.e), now = toNode(g);
      const to = g.stop ? Math.max(now, want) : Math.abs(now - want) < 15 ? want : now;
      if (to !== now && to < g.e.len - 0.5) { g.s = g.dir > 0 ? g.e.len - to : to; feature(net, g); }
    }
    const k = g.e.id + ':' + g.dir, same = (byApproach.get(k) || []).find(h => Math.abs(h.s - g.s) < 3);
    if (same) { if (g.stop && !same.stop) Object.assign(same, { stop: true }); continue; }
    push(byApproach, k, g); kept.push(g);
  }
  net.giveways = kept;
  net.giveByEdge = new Map(); for (const g of kept) push(net.giveByEdge, g.e.id, g);
  for (const st of net.stops) {
    const v = facedNode(st); if (st.single || !isJunction(net, v)) continue;
    const want = giveWayDist(net, v, st.e);
    if (toNode(st) < want - 0.7 && want < st.e.len - 0.5) { st.s = st.dir > 0 ? st.e.len - want : want; feature(net, st); }
  }
}

function feature(net, f) {
  const p = posAt(f.e, f.s);
  f.x = p.x; f.z = p.z; f.tx = p.tx * f.dir; f.tz = p.tz * f.dir; f.w = f.e.way.w;
  f.ts = f.dir > 0 ? f.s : f.e.len - f.s; // distance along the edge in travel direction
  return f;
}

// position & tangent at arc length s along edge (edge direction)
export function posAt(e, s) {
  if (s <= 0) s = 0; if (s >= e.len) s = e.len;
  let lo = 0, hi = e.n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (e.cum[m] <= s) lo = m; else hi = m; }
  const L = (e.cum[hi] - e.cum[lo]) || 1e-6, t = (s - e.cum[lo]) / L;
  const tx = (e.px[hi] - e.px[lo]) / L, tz = (e.pz[hi] - e.pz[lo]) / L;
  return { x: e.px[lo] + (e.px[hi] - e.px[lo]) * t, z: e.pz[lo] + (e.pz[hi] - e.pz[lo]) * t, tx, tz };
}
// position travelling along edge in `dir`, `ts` metres from the start of travel, offset to the traveller's left
export function along(e, ts, dir, off = 0) {
  const p = posAt(e, dir > 0 ? ts : e.len - ts);
  const tx = p.tx * dir, tz = p.tz * dir;
  return { x: p.x + tz * off, z: p.z - tx * off, tx, tz };
}
// ---------- lanes ----------
// Offsets are measured to the traveller's left of the road centreline.
export const cycleLeft = (e, dir) => dir > 0 ? e.way.cl : e.way.cr;
const isLane = (c) => c === 1 || c === 2;
export function laneInfo(e, dir) {
  const w = e.way, cyc = isLane(cycleLeft(e, dir)) ? w.cw : 0;
  const n = w.oneway ? Math.max(1, w.lanes || (w.w > 7.6 && !w.rb ? 2 : 1)) : Math.max(1, Math.floor((w.lanes || 2) / 2));
  const inner = w.oneway ? -w.w / 2 : 0, outer = w.w / 2 - cyc;
  return { n, inner, outer, laneW: (outer - inner) / n, cyc };
}
// centre of lane i (0 = nearest the kerb)
export function laneCentre(e, dir, i = 0) {
  const L = laneInfo(e, dir); i = Math.min(i, L.n - 1);
  return L.outer - L.laneW * (i + 0.5);
}
// How far paved road reaches from a way's centre line on its widest side: the hard shoulder on a
// motorway is road surface, not verge, so stopping on it is not "mounting the kerb".
export const paved = (w) => w.w / 2 + Math.max(w.hs || 0, w.cls === 'motorway' ? 1 : 0);
export const laneOffset = (w) => w.oneway ? (w.w > 7.6 && !w.rb ? w.w / 4 : (w.rb ? 0.8 : 0)) : Math.min(w.w / 4, 2.2);
export const endNode = (st) => st.dir > 0 ? st.e.b : st.e.a;
export const startNode = (st) => st.dir > 0 ? st.e.a : st.e.b;

// nearest road to a point among the edges `ok` accepts (e.g. only the motorway, while on a slip road)
export function nearestWhere(net, x, z, ok) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  let best = null, bd = 1e18;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const a = net.grid.get(ck(cx + i, cz + j)); if (!a) continue;
    for (let k = 0; k < a.length; k += 2) {
      const e = net.edges[a[k]]; if (!ok(e)) continue;
      const s = a[k + 1], ax = e.px[s], az = e.pz[s], dx = e.px[s + 1] - ax, dz = e.pz[s + 1] - az, L2 = dx * dx + dz * dz || 1e-9;
      let t = ((x - ax) * dx + (z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + dx * t, qz = az + dz * t, dd = (x - qx) ** 2 + (z - qz) ** 2;
      if (dd < bd) { bd = dd; const L = Math.sqrt(L2); best = { e, way: e.way, d: Math.sqrt(dd), s: e.cum[s] + t * L, tx: dx / L, tz: dz / L, lat: (x - qx) * (dz / L) - (z - qz) * (dx / L) }; }
    }
  }
  return best;
}
// nearest road to a point
export function nearest(net, x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  let best = null, bd = 1e18;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const a = net.grid.get(ck(cx + i, cz + j)); if (!a) continue;
    for (let k = 0; k < a.length; k += 2) {
      const e = net.edges[a[k]], s = a[k + 1];
      const ax = e.px[s], az = e.pz[s], dx = e.px[s + 1] - ax, dz = e.pz[s + 1] - az, L2 = dx * dx + dz * dz || 1e-9;
      let t = ((x - ax) * dx + (z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + dx * t, qz = az + dz * t, dd = (x - qx) ** 2 + (z - qz) ** 2;
      if (dd < bd) {
        bd = dd; const L = Math.sqrt(L2);
        best = { e, way: e.way, d: Math.sqrt(dd), s: e.cum[s] + t * L, tx: dx / L, tz: dz / L, lat: (x - qx) * (dz / L) - (z - qz) * (dx / L) };
      }
    }
  }
  return best;
}
// Is the point on paved road, within `margin` of some road's paved edge? Not just the nearest centre
// line: where a slip road leaves a motorway, the slip's centre line can be nearer than the motorway's
// while the car is plainly on the motorway.
export function onPaved(net, x, z, margin = 0) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const a = net.grid.get(ck(cx + i, cz + j)); if (!a) continue;
    for (let k = 0; k < a.length; k += 2) {
      const e = net.edges[a[k]], s = a[k + 1], lim = paved(e.way) + margin;
      const ax = e.px[s], az = e.pz[s], dx = e.px[s + 1] - ax, dz = e.pz[s + 1] - az, L2 = dx * dx + dz * dz || 1e-9;
      let t = ((x - ax) * dx + (z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      if ((x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2 < lim * lim) return true;
    }
  }
  return false;
}
export function stopsNear(net, x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), out = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = net.stopGrid.get(ck(cx + i, cz + j)); if (a) out.push(...a); }
  return out;
}
export function ll2xz(net, lat, lon) { return { x: (lon - net.origin[1]) * net.kx, z: -(lat - net.origin[0]) * net.kz }; }

// ---------- routing ----------
const COST = { residential: 1.6, living_street: 2.6, unclassified: 1.3 };
export function shortestPath(net, from, to, noFirstEdge = null) {
  if (from === to) return [];
  const n = net.nx.length, dist = new Float64Array(n).fill(Infinity), prev = new Array(n);
  const heap = [[0, from]]; dist[from] = 0;
  const pushH = (it) => { heap.push(it); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const popH = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, u] = popH(); if (d > dist[u]) continue; if (u === to) break;
    for (const o of net.out[u]) {
      if (u === from && o.e === noFirstEdge) continue;
      const v = o.dir > 0 ? o.e.b : o.e.a, nd = d + o.e.len * (COST[o.e.way.cls] || 1);
      if (nd < dist[v]) { dist[v] = nd; prev[v] = o; pushH([nd, v]); }
    }
  }
  if (!prev[to]) return null;
  const steps = []; let v = to;
  while (v !== from) { const o = prev[v]; steps.push({ e: o.e, dir: o.dir }); v = o.dir > 0 ? o.e.a : o.e.b; }
  return steps.reverse();
}
export function snapWaypoint(net, wp) {
  const p = wp.x !== undefined ? wp : ll2xz(net, wp.lat, wp.lon); let best = -1, bd = 1e18;
  for (const e of net.edges) {
    if (wp.road && e.way.name !== wp.road) continue;
    for (const v of [e.a, e.b]) { const d = (net.nx[v] - p.x) ** 2 + (net.nz[v] - p.z) ** 2; if (d < bd) { bd = d; best = v; } }
  }
  return best;
}

export function buildRoute(net, nodes, meta = {}) {
  let steps = [];
  const wpS = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const leg = (i === 0 && meta.noUturnEdge && shortestPath(net, nodes[i], nodes[i + 1], meta.noUturnEdge)) || shortestPath(net, nodes[i], nodes[i + 1]);
    if (!leg) throw new Error('No road route between waypoints ' + i + ' and ' + (i + 1));
    steps = steps.concat(leg);
    // a waypoint past the turn makes the route drive on and come straight back: cut that spur out
    for (let k = steps.length - leg.length - 1; k >= 0 && k + 1 < steps.length;) {
      if (steps[k].e === steps[k + 1].e && steps[k].dir === -steps[k + 1].dir) { steps.splice(k, 2); k = Math.max(0, k - 1); } else break;
    }
    wpS.push(steps.length);
  }
  // geometry in travel order
  const xs = [], zs = [], stepS = [];
  let acc = 0;
  for (const st of steps) {
    stepS.push(acc);
    const e = st.e, n = e.n;
    for (let k = 0; k < n; k++) {
      const i = st.dir > 0 ? k : n - 1 - k;
      if (k === 0 && xs.length) continue;
      xs.push(e.px[i]); zs.push(e.pz[i]);
    }
    acc += e.len;
  }
  const cum = new Float32Array(xs.length);
  for (let i = 1; i < xs.length; i++) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  const route = { steps, xs: Float32Array.from(xs), zs: Float32Array.from(zs), cum, len: cum[cum.length - 1], stepS, nodes, wpStep: wpS, ...meta };
  route.instructions = makeInstructions(net, route);
  return route;
}

// lane names, kerb lane first: "left-hand lane", "middle lane", "left or middle lane"
export function laneName(n, ok) {
  const nm = n === 2 ? ['left', 'right'] : n === 3 ? ['left', 'middle', 'right'] : null;
  if (!nm) return ok.map(i => 'lane ' + (i + 1)).join(' or ') + ' (counting from the left)';
  return ok.length === 1 ? (nm[ok[0]] === 'middle' ? 'middle lane' : nm[ok[0]] + '-hand lane') : ok.map(i => nm[i]).join(' or ') + ' lane';
}
const laneText = (n, ok) => ok ? `Get into the ${laneName(n, ok)}. ` : '';
const laneShort = (n, ok) => ok ? laneName(n, ok).replace('-hand', '').replace(/^./, c => c.toUpperCase()) + ' · ' : '';
// which lanes allow a manoeuvre ('L', 'S' or 'R'); null when every lane does (no lane to choose)
function lanesFor(net, e, dir, m) {
  const codes = laneArrows(net, e, dir); if (!codes) return null;
  const ok = codes.map((c, i) => c.includes(m) ? i : -1).filter(i => i >= 0);
  return ok.length && ok.length < codes.length ? ok : null;
}
// lane arrows for an approach: from the map data if painted there, otherwise the usual UK pattern
// (kerb lane left and ahead, outer lane right; at roundabouts the outer lane is for exits to the right)
export function laneArrows(net, e, dir) {
  const k = e.id + ':' + dir; if (net.arrows.has(k)) return net.arrows.get(k);
  if (!net.arrowCache) net.arrowCache = new Map(); if (net.arrowCache.has(k)) return net.arrowCache.get(k);
  const L = laneInfo(e, dir); let codes = null;
  if (L.n >= 2 && !e.way.rb) {
    const v = dir > 0 ? e.b : e.a, tin = endTangent({ e, dir }), hasRb = net.inc[v].some(o => o.e.way.rb);
    const outs = net.out[v].filter(p => p.e !== e).map(p => turnOf(tin, startTangent(p)));
    const left = outs.some(a => a < -0.5), right = outs.some(a => a > 0.5) || hasRb, ahead = outs.some(a => Math.abs(a) <= 0.5) || hasRb;
    codes = [];
    for (let i = 0; i < L.n; i++) codes.push(i === 0 ? (left && ahead ? 'LS' : left ? 'L' : 'S') : i === L.n - 1 ? (hasRb ? 'R' : right && ahead ? 'SR' : right ? 'R' : 'S') : 'S');
  }
  net.arrowCache.set(k, codes); return codes;
}
// manoeuvre letter for a turn angle (radians, <0 left); roundabout exits use a wider "straight on" band
export const manoeuvre = (ang, rb) => { const a = Math.abs(ang), lim = rb ? 0.8 : 0.5; return a <= lim ? 'S' : ang < 0 && a < 2.6 ? 'L' : 'R'; };
// which lane (0 = nearest the kerb) a point at signed lateral offset `lat` (left of edge direction) is in, travelling `dir`
export function laneIndex(e, dir, lat) {
  const L = laneInfo(e, dir), off = lat * dir;
  return Math.max(0, Math.min(L.n - 1, Math.floor((L.outer - off) / L.laneW)));
}
function ord(n) { return n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'); }
function endTangent(st) { const e = st.e; const p = posAt(e, st.dir > 0 ? e.len - 0.5 : 0.5); return { x: p.tx * st.dir, z: p.tz * st.dir }; }
function startTangent(st) { const e = st.e; const p = posAt(e, st.dir > 0 ? Math.min(6, e.len * 0.5) : Math.max(e.len - 6, e.len * 0.5)); return { x: p.tx * st.dir, z: p.tz * st.dir }; }
function turnOf(a, b) { const cross = a.x * b.z - a.z * b.x, dot = a.x * b.x + a.z * b.z; return Math.atan2(cross, dot); } // <0 = left
function signalsAt(net, v, r, junctionOnly) { const x = net.nx[v], z = net.nz[v]; return stopsNear(net, x, z).some(s => Math.hypot(s.x - x, s.z - z) < r && !(junctionOnly && s.single)); }
function miniAt(net, v) { const x = net.nx[v], z = net.nz[v]; return net.minis.some(m => Math.hypot(m.x - x, m.z - z) < 10); }

// Two mini-roundabouts a few metres apart act as one junction (a "double mini"): give one instruction for the whole thing.
function mergeDoubleMinis(S, out) {
  for (let j = 0; j < out.length - 1; j++) {
    const a = out[j], b = out[j + 1];
    if (!a.mini || !b.mini || b.s - a.s > 30) continue;
    const ang = turnOf(endTangent(S[a.stepI]), startTangent(S[b.stepI + 1])), deg = Math.abs(ang) * 180 / Math.PI;
    const kind = deg < 35 ? 'straight' : deg > 150 ? 'uturn' : ang < 0 ? 'left' : 'right';
    const verb = kind === 'straight' ? 'go straight ahead' : kind === 'uturn' ? 'go all the way round and back' : 'turn ' + kind;
    const nm = b.road, lr = kind === 'left' ? 'L' : kind === 'right' ? 'R' : null;
    out.splice(j, 2, { ...a, kind, icon: kind === 'uturn' ? 'rb' : kind, double: true, road: nm,
      text: `At the double mini-roundabout, ${verb}${nm ? ' onto ' + nm : ''}. Give way to the right at each one.`,
      short: `Double mini · ${kind === 'straight' ? 'Straight on' : kind === 'uturn' ? 'All the way round' : 'Turn ' + kind}${nm ? ' · ' + nm : ''}`,
      signal: lr, laneOK: a.laneOK });
  }
}

function makeInstructions(net, route) {
  const S = route.steps, out = [];
  for (let i = 0; i < S.length - 1; i++) {
    const A = S[i], B = S[i + 1], v = endNode(A), sAt = route.stepS[i + 1];
    if (B.e.way.rb && !A.e.way.rb) {
      let k = i + 1, exits = 0, prevExitS = sAt;
      while (k < S.length && S[k].e.way.rb) {
        const vk = endNode(S[k]);
        if (k + 1 >= S.length || !S[k + 1].e.way.rb) { exits++; break; }
        if (net.out[vk].some(o => !o.e.way.rb)) { exits++; prevExitS = route.stepS[k + 1]; }
        k++;
      }
      const ex = S[k + 1]; const nm = ex ? ex.e.way.name : '';
      const m = ex ? manoeuvre(turnOf(endTangent(A), startTangent(ex)), true) : 'S';
      const L = laneInfo(A.e, A.dir), ok = lanesFor(net, A.e, A.dir, m);
      const lights = signalsAt(net, v, 30, false);
      out.push({ s: sAt, node: v, kind: 'rb', icon: 'rb', exitN: exits, exitS: route.stepS[Math.min(k + 1, S.length - 1)], prevExitS, m,
        text: laneText(L.n, ok) + `At the roundabout${lights ? ' (traffic lights on the way in and on the ring)' : ''}, take the ${ord(exits)} exit${nm ? ' onto ' + nm : ''}.`,
        short: laneShort(L.n, ok) + `Roundabout · ${ord(exits)} exit`, road: nm,
        laneOK: ok, lanes: L.n, approach: { e: A.e, dir: A.dir },
        // Rule 186: signal left on approach for an exit to the left, right for an exit to the right; signal left after passing the exit before yours
        signal: m === 'L' ? 'L' : m === 'R' ? 'R' : null, exitSignal: exits >= 2 || m !== 'L' });
      i = k; continue;
    }
    if (A.e.way.rb) continue;
    const opts = net.out[v].filter(o => o.e !== A.e);
    const mini = miniAt(net, v);
    if (opts.length < 1 || (opts.length === 1 && !mini)) continue;
    const ang = turnOf(endTangent(A), startTangent(B)), deg = Math.abs(ang) * 180 / Math.PI;
    const nm = B.e.way.name, change = nm && nm !== A.e.way.name;
    const straightOpt = opts.some(o => Math.abs(turnOf(endTangent(A), startTangent(o))) < 0.5);
    const lights = signalsAt(net, v, 32, deg < 28);
    let kind, verb, icon, short;
    if (deg < 28) {
      if (!lights && !mini && !lanesFor(net, A.e, A.dir, 'S')) continue; // straight on only needs saying at lights, minis, or when the lane matters
      kind = 'straight'; verb = 'go straight ahead'; icon = 'straight'; short = 'Straight on';
    } else if (deg > 150) { kind = 'uturn'; verb = 'turn round'; icon = 'stop'; short = 'Turn round'; }
    else {
      const left = ang < 0, slight = deg < 48 && straightOpt;
      kind = left ? 'left' : 'right'; icon = kind;
      verb = (slight ? 'bear ' : 'turn ') + kind; short = (slight ? 'Bear ' : 'Turn ') + kind;
    }
    const where = mini ? 'At the mini-roundabout, ' : lights ? 'At the traffic lights, ' : (!straightOpt && kind !== 'straight' ? 'At the end of the road, ' : '');
    const onto = nm && (change || kind !== 'straight') ? ' onto ' + nm : '';
    const L = laneInfo(A.e, A.dir), ok = lanesFor(net, A.e, A.dir, kind === 'left' ? 'L' : kind === 'straight' ? 'S' : 'R');
    let text = laneText(L.n, ok) + (where ? where + verb : verb.charAt(0).toUpperCase() + verb.slice(1)) + onto + '.';
    out.push({ s: sAt, node: v, kind, icon, text, short: laneShort(L.n, ok) + short + (nm ? ' · ' + nm : (lights ? ' · lights' : '')), road: nm,
      signal: (kind === 'left' || kind === 'right') && deg > 34 ? (kind === 'left' ? 'L' : 'R') : null,
      laneOK: ok, lanes: L.n, approach: { e: A.e, dir: A.dir }, mini, stepI: i });
  }
  mergeDoubleMinis(S, out);
  // one instruction per junction: drop "straight on" repeats from clustered lights and crossings a few metres apart
  for (let j = out.length - 1; j > 0; j--) {
    const a = out[j - 1], b = out[j];
    if (b.kind === 'straight' && !b.double && b.s - a.s < 45) out.splice(j, 1);
    else if (a.kind === 'straight' && !a.double && b.s - a.s < 30) out.splice(j - 1, 1);
  }
  out.push({ s: Math.max(0, route.len - 12), kind: 'end', icon: 'stop', final: true, text: 'When it is safe, pull up on the left and stop.', short: 'Pull up on the left' });
  return out;
}
