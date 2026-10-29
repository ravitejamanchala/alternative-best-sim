import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { exportTrack, importTrack } from '../src/sim/adapter';
import { buildNet } from '../src/vendor/slaydrive/net.js';
import { fromOSM } from '../src/world/osm';
import { compile } from '../src/world/compiler';
import { world, road, building } from './helpers';
test('Complete JSON survives World → SlayDrive → native loader → World → re-export', () => {
  const w = world();
  w.sourceObjects = [
    road('r', [
      [-30, 0],
      [0, 0],
      [30, 0],
    ]),
    building(),
  ];
  w.overrides.building = { height: 11 };
  const envelope = exportTrack(w),
    net: any = buildNet(envelope.network);
  assert.equal(net.edges.length, 2);
  assert.equal(net.nx.length, 3);
  const restored = importTrack(JSON.stringify(envelope));
  assert.deepEqual(restored, w);
  assert.deepEqual(exportTrack(restored), envelope);
  assert.deepEqual(compile(restored).asphalt, compile(w).asphalt);
});
test('Native reverse one-way is oriented for the actual learner loader', () => {
  const w = world();
  const r = road(
    'reverse',
    [
      [0, 0],
      [20, 0],
    ],
    ['a', 'b'],
  );
  r.oneway = -1;
  w.sourceObjects = [r];
  const net: any = buildNet(exportTrack(w).network);
  assert.equal(net.out[0].length, 0);
  assert.equal(net.out[1].length, 1);
});
test('Cambridge offline source compiles and passes upstream native decoder', () => {
  const w = fromOSM(JSON.parse(readFileSync('public/samples/cambridge.osm.json', 'utf8')));
  const e = exportTrack(w),
    net: any = buildNet(e.network);
  assert.ok(net.edges.length > 50);
  assert.equal(w.sourceObjects.filter((o) => o.kind === 'building').length, 148);
  assert.deepEqual(importTrack(JSON.stringify(e)), w);
});
test('Legacy import retains every unsupported field instead of dropping it', () => {
  const w = world();
  w.sourceObjects = [
    road('a', [
      [0, 0],
      [10, 0],
    ]),
  ];
  const e: any = exportTrack(w);
  delete e.slaydriveWorld;
  e.customUnknown = { data: [1, 2, 3] };
  const restored = importTrack(JSON.stringify(e));
  assert.deepEqual((restored.legacy as any).customUnknown, { data: [1, 2, 3] });
});
test('Vendored vehicle physics is byte-for-byte the inspected simulator version', () => {
  const manifest = JSON.parse(readFileSync('src/vendor/slaydrive/provenance.json', 'utf8'));
  for (const [file, hash] of Object.entries(manifest.files)) {
    assert.equal(
      createHash('sha256')
        .update(readFileSync('src/vendor/slaydrive/' + file))
        .digest('hex'),
      hash,
    );
  }
});
test('Free drive entry points do not import grading or profile services', () => {
  for (const p of [
    'src/sim/physics.ts',
    'src/sim/input.ts',
    'src/render/Viewport.tsx',
    'src/vendor/slaydrive/car.js',
  ]) {
    const s = readFileSync(p, 'utf8');
    assert.equal(
      /import[^;]*(assessment|test\.js|profile|cloud-sync|curriculum|lesson)/.test(s),
      false,
      p,
    );
  }
});
