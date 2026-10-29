import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route, loop } from '../src/world/routing';
import { world, road } from './helpers';
test('Time-dependent access and reversible roads never become unrestricted route shortcuts', () => {
  const w = world(),
    a = road(
      'a',
      [
        [0, 0],
        [20, 0],
      ],
      ['a', 'b'],
    ),
    b = road(
      'b',
      [
        [20, 0],
        [40, 0],
      ],
      ['b', 'c'],
    );
  w.sourceObjects = [a, b];
  assert.equal(route(w, ['a', 'c']).nodeIds.length, 3);
  b.source.tags.oneway = 'reversible';
  assert.throws(() => route(w, ['a', 'c']), /Waypoint|No connected/);
  delete b.source.tags.oneway;
  b.source.tags['motorcar:conditional'] = 'no @ (Mo-Fr 08:00-09:00)';
  assert.throws(() => route(w, ['a', 'c']), /Waypoint|No connected/);
});
test('Routes respect one-way direction and connectivity', () => {
  const w = world();
  const a = road(
    'a',
    [
      [0, 0],
      [20, 0],
    ],
    ['a', 'b'],
  );
  a.oneway = 1;
  w.sourceObjects = [
    a,
    road(
      'isolated',
      [
        [50, 0],
        [60, 0],
      ],
      ['x', 'y'],
    ),
  ];
  assert.deepEqual(route(w, ['a', 'b']).nodeIds, ['a', 'b']);
  assert.throws(() => route(w, ['b', 'a']), /No connected/);
  assert.throws(() => route(w, ['a', 'y']), /No connected/);
});
test('No-turn and only-turn restrictions are enforced across waypoints', () => {
  const w = world();
  w.sourceObjects = [
    road(
      'in',
      [
        [0, 0],
        [20, 0],
      ],
      ['a', 'b'],
    ),
    road(
      'out',
      [
        [20, 0],
        [20, 20],
      ],
      ['b', 'c'],
    ),
    road(
      'other',
      [
        [20, 0],
        [40, 0],
      ],
      ['b', 'd'],
    ),
  ];
  w.sourceObjects.forEach((r) => (r.oneway = 1));
  w.restrictions = [{ from: 'in', to: 'out', via: 'b', only: false }];
  assert.throws(() => route(w, ['a', 'b', 'c']), /No connected/);
  assert.doesNotThrow(() => route(w, ['a', 'd']));
  w.restrictions[0].only = true;
  assert.throws(() => route(w, ['a', 'd']));
  assert.doesNotThrow(() => route(w, ['a', 'c']));
});
test('Clockwise and anticlockwise loops have actual connected edges', () => {
  const w = world();
  w.sourceObjects = [
    road(
      'loop',
      [
        [0, 0],
        [50, 0],
        [50, 50],
        [0, 50],
        [0, 0],
      ],
      ['a', 'b', 'c', 'd', 'a'],
    ),
  ];
  assert.equal(loop(w, 'a', true).mode, 'clockwise');
  assert.equal(loop(w, 'a', false).mode, 'anticlockwise');
  w.sourceObjects[0].oneway = 1;
  assert.throws(() => loop(w, 'a', false), /No suitable/);
});
test('Known unsupported restrictions fail closed, same start and end is not a practice route', () => {
  const w = world();
  w.sourceObjects = [
    road(
      'a',
      [
        [0, 0],
        [20, 0],
      ],
      ['a', 'b'],
    ),
  ];
  assert.throws(() => route(w, ['a', 'a']), /distinct/);
  w.sourceIssues = [
    'Unsupported via-way or conditional restriction 123; practice routing must be reviewed',
  ];
  assert.throws(() => route(w, ['a', 'b']), /complex turn restrictions/);
  assert.throws(() => loop(w, 'a', true), /complex turn restrictions/);
});
