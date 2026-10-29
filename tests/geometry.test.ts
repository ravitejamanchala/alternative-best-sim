import { test } from 'node:test';
import assert from 'node:assert/strict';
import clipping from 'polygon-clipping';
import { compile, area, surfaceContains, buffer, selfIntersects } from '../src/world/compiler';
import { toWorld, toGeo, inPolygon } from '../src/world/geo';
import {
  coordinates,
  History,
  transformObject,
  roadPoints,
  setVertex,
  parseWorld,
  validateWorld,
} from '../src/world/model';
import { fromOSM } from '../src/world/osm';
import { retainEdits, checkBounds } from '../src/world/provider';
import { world, road, building } from './helpers';
for (const [name, roads] of Object.entries({
  T: [
    road('a', [
      [-30, 0],
      [0, 0],
      [30, 0],
    ]),
    road('b', [
      [0, 0],
      [0, 30],
    ]),
  ],
  crossroads: [
    road('a', [
      [-30, 0],
      [0, 0],
      [30, 0],
    ]),
    road('b', [
      [0, -30],
      [0, 0],
      [0, 30],
    ]),
  ],
  curve: [
    road('a', [
      [0, 0],
      [5, 1],
      [12, 5],
      [17, 12],
      [20, 20],
    ]),
  ],
  seam: [
    road('a', [
      [-30, 0],
      [0, 0],
    ]),
    road('b', [
      [0, 0],
      [30, 0],
    ]),
  ],
}))
  test(name + ' has continuous asphalt and no pavement overlap', () => {
    const w = world();
    w.sourceObjects = roads;
    const c = compile(w);
    assert.equal(c.asphalt.length, 1);
    assert.ok(area(c.asphalt) > 100);
    assert.equal(area(clipping.intersection(c.pavement, c.asphalt) as any), 0);
    for (const r of roads) for (const p of r.points!) assert.ok(surfaceContains(p, c.asphalt));
    for (const poly of c.pavement)
      for (const ring of poly) assert.equal(selfIntersects(ring), false);
  });
test('Roundabout preserves central island and approaches', () => {
  const w = world();
  const pts: Array<[number, number]> = Array.from({ length: 49 }, (_, i) => [
    Math.cos((i / 48) * Math.PI * 2) * 20,
    Math.sin((i / 48) * Math.PI * 2) * 20,
  ]);
  pts[48] = pts[0];
  w.sourceObjects = [
    road('ring', pts),
    road('arm', [
      [20, 0],
      [50, 0],
    ]),
  ];
  const c = compile(w);
  assert.equal(surfaceContains([0, 0], c.asphalt), false);
  assert.equal(surfaceContains([20, 0], c.asphalt), true);
  assert.ok(c.asphalt.some((p) => p.length > 1));
});
test('Narrow traffic island remains between separate carriageways', () => {
  const w = world(),
    a = road('a', [
      [-20, -3.25],
      [20, -3.25],
    ]),
    b = road('b', [
      [-20, 3.25],
      [20, 3.25],
    ]);
  a.width = b.width = 6;
  w.sourceObjects = [a, b];
  const c = compile(w);
  assert.equal(surfaceContains([0, 0], c.asphalt), false);
  assert.equal(c.asphalt.length, 2);
});
test('Courtyard holes survive rotation and remain empty', () => {
  const b = building();
  const poly = b.rings!.map((r) => coordinates(b, r));
  assert.equal(inPolygon([20, 20], poly), false);
  assert.equal(inPolygon(coordinates(b, [[6, 0]])[0], poly), true);
});
test('Source-node edit moves all incident roads; undo restores topology', () => {
  const w = world();
  w.sourceObjects = [
    road('a', [
      [0, 0],
      [10, 0],
    ]),
    road('b', [
      [10, 0],
      [10, 10],
    ]),
  ];
  const history = new History(w),
    next = structuredClone(w);
  setVertex(next, w.sourceObjects[0], 1, [12, 2]);
  history.commit(next);
  assert.deepEqual(roadPoints(next, next.sourceObjects[1])[0], [12, 2]);
  assert.deepEqual(roadPoints(history.undo(), w.sourceObjects[1])[0], [10, 0]);
  assert.deepEqual(roadPoints(history.redo(), w.sourceObjects[1])[0], [12, 2]);
});
test('Mapped pavement gaps cut only pavement, not road', () => {
  const w = world();
  w.sourceObjects = [
    road('a', [
      [-30, 0],
      [30, 0],
    ]),
  ];
  const gap = building('gap');
  gap.kind = 'zone';
  gap.x = 0;
  gap.z = 0;
  gap.rotation = 0;
  gap.source.tags.purpose = 'pavement-gap';
  gap.rings = [
    [
      [-2, -6],
      [2, -6],
      [2, 6],
      [-2, 6],
      [-2, -6],
    ],
  ];
  w.additions.push(gap);
  const c = compile(w);
  assert.equal(surfaceContains([0, 4], c.pavement), false);
  assert.equal(surfaceContains([0, 0], c.asphalt), true);
});
test('Roadside objects inside carriageway fail clearance', () => {
  const w = world();
  w.sourceObjects = [
    road('a', [
      [-20, 0],
      [20, 0],
    ]),
  ];
  w.additions = [{ ...building('tree'), kind: 'tree', x: 0, z: 0, rings: undefined, width: 2 }];
  assert.ok(
    compile(w).diagnostics.some((d) => d.code === 'road-clearance' && d.severity === 'error'),
  );
});
test('Coordinate convention is reversible to sub-millimetre precision', () => {
  for (const lat of [50, 52.2, 55, 59]) {
    const origin: [number, number] = [lat, -0.12],
      p = toWorld(lat + 0.004, -0.11, origin),
      ll = toGeo(...p, origin);
    assert.ok(p[0] > 0 && p[1] < 0);
    assert.ok(Math.abs(ll[0] - (lat + 0.004)) < 1e-12);
    assert.ok(Math.abs(ll[1] + 0.11) < 1e-12);
  }
});
test('Manual edits and deletion survive regeneration', () => {
  const w = world();
  w.sourceObjects = [
    road('road', [
      [-10, 0],
      [10, 0],
    ]),
    building(),
  ];
  w.overrides.road = { width: 8 };
  w.overrides.building = { deleted: true };
  const n = structuredClone(w);
  n.overrides = {};
  assert.deepEqual(retainEdits(w, n).overrides, w.overrides);
});
test('Disappearing edited sources are retained explicitly', () => {
  const w = world();
  w.sourceObjects = [building()];
  w.overrides.building = { height: 11 };
  const n = world();
  const kept = retainEdits(w, n);
  assert.equal(kept.additions[0].height, 11);
  assert.doesNotThrow(() => validateWorld(kept));
});
test('Schema rejects corrupt, oversized and nonfinite documents', () => {
  assert.throws(() => parseWorld('{}'), /Invalid world/);
  assert.throws(() => parseWorld(' '.repeat(20 * 1024 * 1024 + 1)), /20 MiB/);
  const w = world();
  w.additions = [building()];
  w.additions[0].x = Infinity;
  assert.throws(() => validateWorld(w));
});
test('Oversized geographic request rejected before provider fetch', () => {
  assert.throws(() => checkBounds([52, 0.1, 52.5, 0.8]), /2 × 2 km/);
  assert.doesNotThrow(() => checkBounds([52.2, 0.1, 52.21, 0.11]));
});
test('Small JSON cannot request an unbounded spatial geometry allocation', () => {
  const w = world(),
    b = building();
  b.rings = [
    [
      [-1e6, -1e6],
      [1e6, -1e6],
      [1e6, 1e6],
      [-1e6, 1e6],
      [-1e6, -1e6],
    ],
  ];
  w.sourceObjects = [b];
  assert.throws(() => validateWorld(w), /4 × 4 km/);
});
test('OSM relation joins members and assigns courtyard holes, shop only to solid footprint', () => {
  const elements: any[] = [];
  const points = [
    [0, 0],
    [0.001, 0],
    [0.001, 0.001],
    [0, 0.001],
    [0.0004, 0.0004],
    [0.0004, 0.0006],
    [0.0006, 0.0006],
    [0.0006, 0.0004],
  ];
  points.forEach(([x, y], i) =>
    elements.push({ type: 'node', id: i + 1, lat: 52 + y, lon: 0.1 + x }),
  );
  elements.push(
    { type: 'way', id: 10, nodes: [1, 2, 3] },
    { type: 'way', id: 11, nodes: [3, 4, 1] },
    { type: 'way', id: 12, nodes: [5, 6, 7, 8, 5] },
    {
      type: 'relation',
      id: 20,
      tags: { building: 'yes', height: '12' },
      members: [
        { type: 'way', ref: 10, role: 'outer' },
        { type: 'way', ref: 11, role: 'outer' },
        { type: 'way', ref: 12, role: 'inner' },
      ],
    },
    {
      type: 'node',
      id: 30,
      lat: 52.0005,
      lon: 0.1005,
      tags: { shop: 'books', name: 'Courtyard POI' },
    },
    {
      type: 'node',
      id: 31,
      lat: 52.0001,
      lon: 0.1001,
      tags: { shop: 'books', name: 'Contained shop' },
    },
  );
  const w = fromOSM({ elements }, [52, 0.1, 52.001, 0.101]);
  const b = w.sourceObjects.find((o) => o.kind === 'building')!;
  assert.equal(b.rings!.length, 2);
  assert.equal(b.height, 12);
  assert.deepEqual(b.shops, ['Contained shop']);
});
