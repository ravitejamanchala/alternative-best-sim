import * as T from 'three';
import type { loadWorldTrack } from './learner-bridge';
/** View lifecycle expected by the learner main loop. Native assessment stays in the learner. */
export function createLearnerView(scene: T.Scene, loaded: ReturnType<typeof loadWorldTrack>) {
  const environment = new T.Group(),
    sky = new T.Color('#cbdce0');
  scene.background = sky;
  scene.fog = new T.Fog(sky, 450, 1500);
  const hemi = new T.HemisphereLight('#edf3f6', '#858578', 0.85),
    sun = new T.DirectionalLight('#fff0d2', 0.8);
  sun.position.set(-120, 220, 100);
  environment.add(hemi, sun, sun.target);
  const ground = new T.Mesh(
    new T.PlaneGeometry(10000, 10000),
    new T.MeshLambertMaterial({ color: '#c3cbb1' }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  environment.add(ground);
  scene.add(environment);
  const view = new T.PerspectiveCamera();
  return {
    updateChunks(x: number, z: number) {
      view.position.set(x, 2, z);
      loaded.rendering.updateVisibility(view, true);
    },
    chunkCount() {
      return loaded.rendering.chunks.filter((c) => c.visible).length;
    },
    setShadows(on: boolean) {
      sun.castShadow = on;
    },
    updateSun(x: number, z: number) {
      sun.position.set(x - 120, 220, z + 100);
      sun.target.position.set(x, 0, z);
    },
    setTimeOfDay(mode: string) {
      const dusk = mode === 'dusk';
      scene.background = new T.Color(dusk ? '#536575' : '#cbdce0');
      scene.fog!.color.copy(scene.background);
      hemi.intensity = dusk ? 0.4 : 0.85;
      sun.intensity = dusk ? 0.3 : 0.8;
    },
    updateSignals() {
      /* No invented phases: authored static signals remain static. */
    },
    dispose() {
      loaded.dispose();
      ground.geometry.dispose();
      ground.material.dispose();
      scene.remove(environment);
    },
  };
}
