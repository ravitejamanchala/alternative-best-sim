/** Opt-in integration for a learner development build. This module never creates or changes an assessment. */
import type * as THREE from 'three';
import { buildNet } from '../vendor/slaydrive/net.js';
import { WorldScene } from '../render/world-scene';
import { compile } from '../world/compiler';
import { importTrack, exportTrack } from './adapter';
export { createLearnerView } from './learner-view';
export function loadWorldTrack(scene: THREE.Scene, text: string) {
  const world = importTrack(text),
    compiled = compile(world),
    envelope = exportTrack(world);
  const network = buildNet(envelope.network),
    rendering = new WorldScene(world, compiled);
  scene.add(rendering.root);
  return {
    world,
    network,
    rendering,
    spawn: envelope.spawn,
    plan: envelope.plan,
    export: () => JSON.stringify(exportTrack(world)),
    dispose: () => rendering.dispose(),
  };
}
