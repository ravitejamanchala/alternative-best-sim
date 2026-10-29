import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldScene } from '../src/render/world-scene';
import { compile } from '../src/world/compiler';
import { exportTrack } from '../src/sim/adapter';
import { loadWorldTrack } from '../src/sim/learner-bridge';
import { world, building, road } from './helpers';
test('Building material batching retains exact selection and disposes its geometry', () => {
  const w = world(),
    b = building();
  b.rotation = 0;
  b.roof = 'hipped';
  w.sourceObjects = [
    b,
    road('road', [
      [-40, 0],
      [40, 0],
    ]),
  ];
  const scene = new WorldScene(w, compile(w));
  scene.root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(26, 50, 20), new THREE.Vector3(0, -1, 0));
  assert.ok(ray.intersectObjects(scene.pickables, true).some((h) => h.object.userData.id === b.id));
  assert.ok(scene.chunks.length > 0);
  let geometryCount = 0,
    disposed = 0;
  const seen = new Set();
  scene.root.traverse((o: any) => {
    if (o.geometry && !seen.has(o.geometry)) {
      seen.add(o.geometry);
      geometryCount++;
      o.geometry.addEventListener('dispose', () => disposed++);
    }
  });
  scene.dispose();
  assert.equal(disposed, geometryCount);
});
test('Opt-in learner bridge round trips full world and leaves an existing assessment untouched', () => {
  const w = world();
  w.sourceObjects = [
    building(),
    road('a', [
      [-30, 0],
      [30, 0],
    ]),
  ];
  const scene = new THREE.Scene(),
    assessment = { running: true, passes: 2 },
    existing = new THREE.Object3D();
  scene.userData.assessment = assessment;
  scene.add(existing);
  const envelope = exportTrack(w),
    loaded = loadWorldTrack(scene, JSON.stringify(envelope));
  assert.deepEqual(JSON.parse(loaded.export()), envelope);
  assert.equal(scene.userData.assessment, assessment);
  assert.equal(assessment.running, true);
  assert.equal(assessment.passes, 2);
  loaded.dispose();
  assert.deepEqual(scene.children, [existing]);
});
