import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importOverture } from '../src/world/overture';
import { toGeo } from '../src/world/geo';
import { world, building } from './helpers';
import { validateWorld } from '../src/world/model';
test('Licensed Overture fills uncovered footprints and preserves holes and stable IDs', () => {
  const w = world(),
    b = building();
  b.x = 0;
  b.z = 0;
  b.rotation = 0;
  w.sourceObjects = [b];
  const feature = (id: string, offset: number) => ({
    type: 'Feature',
    id,
    properties: { height: 12, names: { primary: 'Office' } },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [offset, 0],
          [offset + 10, 0],
          [offset + 10, 10],
          [offset, 10],
          [offset, 0],
        ],
        [
          [offset + 2, 2],
          [offset + 2, 4],
          [offset + 4, 4],
          [offset + 4, 2],
          [offset + 2, 2],
        ],
      ].map((r) =>
        r.map(([x, z]) => {
          const [lat, lon] = toGeo(x, z, w.geo.origin);
          return [lon, lat];
        }),
      ),
    },
  });
  const d = { type: 'FeatureCollection', features: [feature('gap', 40), feature('overlap', 5)] };
  const next = importOverture(w, d, 'Overture fixture, synthetic test licence');
  assert.equal(next.additions.length, 1);
  assert.equal(next.additions[0].id, 'overture/gap');
  assert.equal(next.additions[0].rings?.length, 2);
  assert.equal(next.additions[0].height, 12);
  assert.doesNotThrow(() => validateWorld(next));
  assert.throws(() => importOverture(w, d, ''), /attribution/);
});
test('MultiPolygon parts preserve source identity, holes and metadata across repeat imports', () => {
  const w = world();
  const ring = (x: number, z: number, size: number) =>
    [
      [x, z],
      [x + size, z],
      [x + size, z + size],
      [x, z + size],
      [x, z],
    ].map(([x, z]) => {
      const [lat, lon] = toGeo(x, z, w.geo.origin);
      return [lon, lat];
    });
  const data = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'multipart',
        properties: {
          height: 11,
          num_floors: 3,
          class: 'apartments',
          sources: [{ dataset: 'licensed fixture' }],
        },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [[ring(0, 0, 20), ring(5, 5, 5)], [ring(40, 0, 10)]],
        },
      },
    ],
  };
  const next = importOverture(w, data, 'Licensed fixture');
  assert.deepEqual(
    next.additions.map((o) => o.id),
    ['overture/multipart/part/0', 'overture/multipart/part/1'],
  );
  assert.equal(next.additions[0].rings!.length, 2);
  assert.ok(next.additions.every((o) => o.source.id === 'multipart'));
  assert.deepEqual(
    JSON.parse(next.additions[0].source.tags['overture:properties']),
    data.features[0].properties,
  );
  assert.deepEqual(importOverture(next, data, 'Licensed fixture'), next);
  const broken = structuredClone(data);
  broken.features[0].geometry.coordinates[1][0][0][0] = 999;
  assert.throws(() => importOverture(w, broken, 'Licensed fixture'), /WGS84/);
  assert.equal(
    w.additions.length,
    0,
    'invalid later parts must not partially mutate the current world',
  );
});
