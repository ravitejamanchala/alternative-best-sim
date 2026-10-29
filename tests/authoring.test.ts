import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, road } from './helpers';
import {
  manualObject,
  laneFromRoad,
  connectEndpoints,
  approachMarking,
} from '../src/world/authoring';
import { compile, area, surfaceContains, paintPath } from '../src/world/compiler';
import { validateWorld, roadPoints, resolveObjects, setVertex } from '../src/world/model';
import { exportTrack, importTrack } from '../src/sim/adapter';
import clipping from 'polygon-clipping';
test('Authored junctions join the road union and lane paint stays on shared asphalt through round trip', () => {
  const w = world(),
    r = road('road', [
      [-30, 0],
      [30, 0],
    ]);
  w.sourceObjects = [r];
  w.additions = [manualObject('junction', [0, 0]), laneFromRoad(w, r)];
  validateWorld(w);
  const c = compile(w);
  assert.equal(c.asphalt.length, 1);
  assert.ok(surfaceContains([0, 5], c.asphalt));
  assert.ok(area(c.markings) > 1);
  assert.ok(area(clipping.intersection(c.asphalt, c.pavement)) < 1e-6);
  assert.ok(area(clipping.difference(c.markings, c.asphalt)) < 1e-6);
  const reloaded = importTrack(JSON.stringify(exportTrack(w)));
  assert.deepEqual(reloaded, w);
  assert.deepEqual(compile(reloaded).markings, c.markings);
  setVertex(w, w.additions[1], 0, [-25, 1]);
  assert.deepEqual(resolveObjects(w).find((o) => o.kind === 'lane')!.points![0], [-25, 1]);
});
test('Explicit endpoint connection joins topology; nearby unconnected roads remain distinct beforehand', () => {
  const w = world(),
    a = road(
      'source',
      [
        [0, 0],
        [30, 0],
      ],
      ['a', 'b'],
    ),
    b = manualObject('road', [40, 1]);
  w.sourceObjects = [a];
  w.additions = [b];
  assert.notEqual(b.nodeIds![0], 'b');
  assert.equal(connectEndpoints(w, b), 1);
  const changed = resolveObjects(w).find((o) => o.id === b.id)!;
  assert.equal(changed.nodeIds![0], 'b');
  assert.deepEqual(roadPoints(w, changed)[0], [30, 0]);
  assert.doesNotThrow(() => validateWorld(w));
});
test('Explicit approach lines precede the conflict area on the incoming left side and reject outbound one-ways', () => {
  const w = world(),
    cross = road(
      'cross',
      [
        [-30, 0],
        [0, 0],
        [30, 0],
      ],
      ['a', 'junction', 'b'],
    ),
    approach = road(
      'approach',
      [
        [0, 30],
        [0, 0],
      ],
      ['c', 'junction'],
    );
  w.sourceObjects = [cross, approach];
  const mark = approachMarking(w, approach, 'end', 'give-way');
  assert.equal(mark.z, 4);
  assert.equal(mark.x, -1.5);
  assert.equal(mark.markingType, 'give-way');
  w.additions = [mark];
  const c = compile(w);
  assert.ok(area(c.markings) > 0.2);
  assert.ok(c.markings.flat(2).every((p) => p[1] > 3));
  approach.oneway = -1;
  assert.throws(() => approachMarking(w, approach, 'end', 'stop'), /outbound/);
});
test('Dash phase continues across vertices and automatic dividers avoid junction conflict areas', () => {
  assert.equal(
    surfaceContains(
      [4, 0],
      paintPath([
        [0, 0],
        [2, 0],
        [12, 0],
      ]),
    ),
    false,
  );
  assert.equal(
    surfaceContains(
      [10, 0],
      paintPath([
        [0, 0],
        [2, 0],
        [12, 0],
      ]),
    ),
    true,
  );
  const w = world(),
    a = road('a', [
      [-30, 0],
      [0, 0],
      [30, 0],
    ]),
    b = road('b', [
      [0, 0],
      [0, 30],
    ]);
  a.source.tags.lane_markings = 'yes';
  w.sourceObjects = [a, b];
  const c = compile(w);
  assert.ok(area(c.markings) > 0);
  assert.equal(surfaceContains([0, 0], c.markings), false);
});
