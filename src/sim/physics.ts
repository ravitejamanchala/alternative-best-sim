import * as THREE from 'three';
import clipping from 'polygon-clipping';
import { collisionIndex, surfaceContains } from '../world/compiler';
import { coordinates } from '../world/model';
import type { World, CompiledWorld, Point } from '../world/types';
import type { DrivingInput } from './input';
export async function createPhysics(scene: THREE.Scene, w: World, c: CompiledWorld) {
  (globalThis as any).THREE = THREE;
  const { createPlayer } = await import('../vendor/slaydrive/car.js');
  const player: any = createPlayer(scene),
    idx = collisionIndex(c);
  let contacts = 0;
  const reset = () => {
    player.place(w.spawn.x, w.spawn.z, w.spawn.heading);
    player.sync(0);
  };
  reset();
  function shape(x: number, z: number, th: number): Point[] {
    const p: Point[] = [
      [-0.9, -2.15],
      [0.9, -2.15],
      [0.9, 2.15],
      [-0.9, 2.15],
      [-0.9, -2.15],
    ];
    return p.map(([dx, dz]) => [
      x + dx * Math.cos(th) + dz * Math.sin(th),
      z - dx * Math.sin(th) + dz * Math.cos(th),
    ]);
  }
  function hit(x: number, z: number, th: number) {
    const car = shape(x, z, th);
    return idx.query(x, z, 3).some((o) => {
      if (o.rings)
        return (
          clipping.intersection(
            [car],
            o.rings.map((r) => coordinates(o, r)),
          ).length > 0
        );
      return Math.hypot(x - o.x, z - o.z) < (o.kind === 'tree' ? 0.25 : 0.2) + 1.15;
    });
  }
  return {
    player,
    reset,
    get contacts() {
      return contacts;
    },
    step(dt: number, input: DrivingInput) {
      let remain = Math.min(dt, 0.1);
      while (remain > 1e-6) {
        const h = Math.min(remain, 1 / 120),
          before = { x: player.x, z: player.z, th: player.th };
        player.update(h, input, surfaceContains([player.x, player.z], c.asphalt) ? 'road' : 'off');
        if (hit(player.x, player.z, player.th)) {
          Object.assign(player, before);
          player.v = 0;
          contacts++;
        }
        remain -= h;
      }
      player.sync(performance.now() / 1000);
    },
    dispose() {
      scene.remove(player.mesh);
      const geometries = new Set<THREE.BufferGeometry>(),
        materials = new Set<THREE.Material>();
      player.mesh.traverse((o: any) => {
        if (o.geometry) geometries.add(o.geometry);
        for (const m of [].concat(o.material || [])) materials.add(m);
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
