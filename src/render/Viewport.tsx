import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import * as T from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { WorldScene, dispose } from './world-scene';
import { coordinates, roadPoints } from '../world/model';
import { toGeo } from '../world/geo';
import type { World, CompiledWorld, WorldObject, Point, Kind } from '../world/types';
import { createPhysics } from '../sim/physics';
import { Input } from '../sim/input';
import { graph } from '../world/routing';
export interface ViewHandle {
  focus: (id?: string) => void;
  view: (top: boolean) => void;
  zoom: (by: number) => void;
  reset: () => void;
  touch: (key: 'throttle' | 'brake' | 'steer', v: number) => void;
}
interface Props {
  world: World;
  compiled: CompiledWorld;
  selected: string | null;
  mode: 'translate' | 'rotate' | 'scale' | 'vertices' | 'select';
  snap: boolean;
  driving: boolean;
  camera: 'chase' | 'first';
  traffic: boolean;
  pedestrians: boolean;
  diagnostics: boolean;
  pinMode: string | null;
  onSelect: (id: string | null) => void;
  onTransform: (id: string, patch: Partial<WorldObject>) => void;
  onVertex: (id: string, index: number, p: Point, ring: number) => void;
  onPlace: (kind: Kind, p: Point) => void;
  onPin: (p: Point) => void;
  onStats: (stats: any) => void;
  onError: (message: string) => void;
}
export const Viewport = forwardRef<ViewHandle, Props>(function Viewport(props, ref) {
  const host = useRef<HTMLDivElement>(null),
    engine = useRef<any>(null),
    current = useRef(props);
  current.current = props;
  useImperativeHandle(ref, () => ({
    focus: (id) => engine.current?.focus(id),
    view: (top) => engine.current?.view(top),
    zoom: (by) => engine.current?.zoom(by),
    reset: () => engine.current?.physics?.reset(),
    touch: (key, v) => {
      if (engine.current?.input) engine.current.input.touch[key] = v;
    },
  }));
  useEffect(() => {
    if (!host.current) return;
    const el = host.current,
      scene = new T.Scene();
    scene.background = new T.Color('#e5e9dc');
    scene.fog = new T.Fog('#e5e9dc', 1000, 2300);
    const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const gl = renderer.getContext(),
      debug = gl.getExtension('WEBGL_debug_renderer_info'),
      rendererName = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'unreported';
    renderer.setPixelRatio(
      /swiftshader|llvmpipe/i.test(rendererName) ? 0.75 : Math.min(devicePixelRatio, 1.5),
    );
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    el.appendChild(renderer.domElement);
    const camera = new T.PerspectiveCamera(42, 1, 2, 2000),
      orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.maxPolarAngle = Math.PI * 0.49;
    orbit.minDistance = 8;
    orbit.maxDistance = 1600;
    camera.position.set(-250, 320, 330);
    orbit.target.set(0, 0, 0);
    orbit.update();
    scene.add(new T.HemisphereLight('#ffffff', '#b5bda4', 0.9));
    const light = new T.DirectionalLight('#fff9eb', 0.8);
    light.position.set(-160, 240, 100);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    Object.assign(light.shadow.camera, {
      left: -300,
      right: 300,
      top: 300,
      bottom: -300,
      far: 800,
    });
    light.shadow.bias = -0.00025;
    scene.add(light);
    const ground = new T.Mesh(
      new T.PlaneGeometry(5000, 5000),
      new T.MeshLambertMaterial({ color: '#ced7bd' }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    (ground.material as T.MeshLambertMaterial).color.convertSRGBToLinear();
    scene.add(ground);
    const grid = new T.GridHelper(2000, 200, '#aeb9a0', '#bac5ac');
    grid.position.y = -0.025;
    const gm = grid.material as T.Material;
    gm.transparent = true;
    gm.opacity = 0.22;
    scene.add(grid);
    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setSize(0.8);
    scene.add(gizmo);
    const pivot = new T.Object3D();
    scene.add(pivot);
    let selectedBox: T.BoxHelper | null = null,
      vertexHandles = new T.Group(),
      selectedVertex: { index: number; ring: number } | null = null;
    const ray = new T.Raycaster();
    ray.params.Line = { threshold: 2 };
    const cursor = new T.Vector2(),
      plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
    const groundPoint = (e: { clientX: number; clientY: number }): Point => {
      const rect = el.getBoundingClientRect();
      cursor.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(cursor, camera);
      const p = new T.Vector3();
      ray.ray.intersectPlane(plane, p);
      return [p.x, p.z];
    };
    const state: any = {
      renderer,
      camera,
      scene,
      orbit,
      gizmo,
      pivot,
      input: new Input(),
      physics: null,
      worldScene: null,
      active: false,
      driverVersion: 0,
    };
    engine.current = state;
    state.focus = (id?: string) => {
      if (id) {
        const o = current.current.compiled.objects.find((o) => o.id === id);
        if (o) {
          orbit.target.set(o.x, 0, o.z);
          camera.position.set(o.x - 45, 60, o.z + 65);
        }
      } else {
        const b = current.current.compiled.boundary;
        const x = (b[0] + b[2]) / 2,
          z = (b[1] + b[3]) / 2,
          d = Math.max(b[2] - b[0], b[3] - b[1], 150);
        orbit.target.set(x, 0, z);
        camera.position.set(x - d * 0.55, d * 0.7, z + d * 0.75);
      }
      orbit.update();
    };
    state.view = (top: boolean) => {
      const p = orbit.target;
      camera.position.set(p.x + (top ? 0 : -180), top ? 400 : 220, p.z + (top ? 0.1 : 230));
      orbit.update();
    };
    state.zoom = (by: number) => {
      camera.position.sub(orbit.target).multiplyScalar(by).add(orbit.target);
      orbit.update();
    };
    const resize = new ResizeObserver(() => {
      const w = el.clientWidth,
        h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    resize.observe(el);
    let dragging = false;
    gizmo.addEventListener('dragging-changed', (e: any) => {
      dragging = e.value;
      orbit.enabled = !e.value;
    });
    gizmo.addEventListener('mouseUp', () => {
      const p = current.current;
      if (!p.selected) return;
      if (selectedVertex) {
        p.onVertex(
          p.selected,
          selectedVertex.index,
          [pivot.position.x, pivot.position.z],
          selectedVertex.ring,
        );
      } else
        p.onTransform(p.selected, {
          x: pivot.position.x,
          z: pivot.position.z,
          y: pivot.position.y,
          rotation: (-pivot.rotation.y * 180) / Math.PI,
          scale: pivot.scale.x,
        });
    });
    let down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const click = (e: MouseEvent) => {
      if (
        current.current.driving ||
        dragging ||
        Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 ||
        gizmo.axis
      )
        return;
      const p = groundPoint(e);
      if (current.current.pinMode) {
        current.current.onPin(p);
        return;
      }
      const vertexHit = ray.intersectObjects(vertexHandles.children, true)[0];
      if (vertexHit) {
        const d = vertexHit.object.userData;
        selectedVertex = { index: d.index, ring: d.ring };
        pivot.position.copy(vertexHit.object.position);
        pivot.rotation.set(0, 0, 0);
        pivot.scale.setScalar(1);
        gizmo.setMode('translate');
        gizmo.attach(pivot);
        return;
      }
      const hit = state.worldScene
        ? ray.intersectObjects(state.worldScene.pickables, true)[0]
        : null;
      current.current.onSelect(hit?.object.userData.id || null);
    };
    const dragOver = (e: DragEvent) => e.preventDefault(),
      drop = (e: DragEvent) => {
        e.preventDefault();
        const kind = e.dataTransfer?.getData('slaydrive/object') as Kind;
        if (kind) current.current.onPlace(kind, groundPoint(e));
      };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('click', click);
    el.addEventListener('dragover', dragOver);
    el.addEventListener('drop', drop);
    state.select = () => {
      const p = current.current;
      gizmo.detach();
      if (selectedBox) {
        dispose(selectedBox);
        selectedBox = null;
      }
      dispose(vertexHandles);
      vertexHandles = new T.Group();
      scene.add(vertexHandles);
      selectedVertex = null;
      state.worldScene?.objects.forEach((g: T.Object3D, id: string) => {
        if (g instanceof T.Line)
          (g.material as T.LineBasicMaterial).opacity = id === p.selected ? 1 : 0;
      });
      const o = p.compiled.objects.find((o) => o.id === p.selected),
        mesh = state.worldScene?.objects.get(p.selected);
      if (!o || !mesh || p.driving) return;
      if (o.kind !== 'road') {
        selectedBox = new T.BoxHelper(mesh, 0xa6cc51);
        scene.add(selectedBox);
      }
      if (p.mode === 'vertices' && (o.points || o.rings)) {
        const rings =
          o.kind === 'road'
            ? [roadPoints(p.world, o)]
            : o.points
              ? [coordinates(o)]
              : o.rings!.map((r) => coordinates(o, r));
        rings.forEach((r, ri) =>
          r.slice(0, o.points ? undefined : -1).forEach((v, i) => {
            const m = new T.Mesh(
              new T.SphereGeometry(0.65, 10, 8),
              new T.MeshBasicMaterial({ color: '#547539', depthTest: false }),
            );
            m.position.set(v[0], 0.4, v[1]);
            m.userData = { index: i, ring: ri };
            m.renderOrder = 10;
            vertexHandles.add(m);
          }),
        );
      } else if (p.mode !== 'select') {
        pivot.position.set(o.x, o.y, o.z);
        pivot.rotation.set(0, (-o.rotation * Math.PI) / 180, 0);
        pivot.scale.setScalar(o.scale);
        gizmo.setMode(p.mode);
        gizmo.attach(pivot);
      }
      gizmo.setTranslationSnap(p.snap ? 1 : null);
      gizmo.setRotationSnap(p.snap ? Math.PI / 12 : null);
      gizmo.setScaleSnap(p.snap ? 0.1 : null);
    };
    let frame = 0,
      last = performance.now(),
      frames: number[] = [],
      lastReport = last,
      ambient = new T.Group(),
      ambientVersion = '';
    scene.add(ambient);
    const rebuildAmbient = () => {
      dispose(ambient);
      ambient = new T.Group();
      scene.add(ambient);
      const p = current.current,
        g = graph(p.world),
        arcs = [...g.out.values()].flat();
      if (p.traffic && arcs.length)
        for (let i = 0; i < Math.min(6, arcs.length); i++) {
          const a = arcs[(i * 7) % arcs.length],
            car = new T.Group();
          const body = new T.Mesh(
            new T.BoxGeometry(1.7, 1, 4),
            new T.MeshLambertMaterial({ color: ['#c67e61', '#69888b', '#e2d8bc'][i % 3] }),
          );
          body.position.y = 0.65;
          car.add(body);
          const roof = new T.Mesh(
            new T.BoxGeometry(1.5, 0.6, 2),
            new T.MeshLambertMaterial({ color: '#435b61' }),
          );
          roof.position.y = 1.35;
          car.add(roof);
          car.userData = { arc: a, t: 0, graph: g };
          ambient.add(car);
        }
      if (p.pedestrians) {
        const ring = p.compiled.pavement[0]?.[0];
        if (ring)
          for (let i = 0; i < 5; i++) {
            const ped = new T.Group(),
              body = new T.Mesh(
                new T.CylinderGeometry(0.2, 0.22, 1, 6),
                new T.MeshLambertMaterial({ color: ['#927267', '#5c7c78', '#b1986d'][i % 3] }),
              );
            body.position.y = 0.9;
            ped.add(body);
            const head = new T.Mesh(
              new T.SphereGeometry(0.14, 8, 6),
              new T.MeshLambertMaterial({ color: '#d4b89c' }),
            );
            head.position.y = 1.55;
            ped.add(head);
            ped.userData = { ped: true, ring, segment: i % Math.max(1, ring.length - 1), t: 0 };
            ambient.add(ped);
          }
      }
    };
    const animate = (now: number) => {
      frame = requestAnimationFrame(animate);
      const dt = Math.min((now - last) / 1000, 0.05);
      frames.push(now - last);
      last = now;
      const p = current.current;
      const av = p.world.id + '|' + p.traffic + '|' + p.pedestrians + '|' + p.driving;
      if (av !== ambientVersion) {
        ambientVersion = av;
        rebuildAmbient();
      }
      ambient.visible = p.driving;
      if (p.driving && state.physics) {
        const phy = state.physics,
          pl = phy.player;
        const before = { x: pl.x, z: pl.z };
        phy.step(dt, state.input.read());
        for (const m of ambient.children) {
          if (m.userData.ped) {
            const u = m.userData,
              a = u.ring[u.segment],
              b = u.ring[u.segment + 1],
              len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            u.t += (dt * 0.9) / (len || 1);
            if (u.t > 1) {
              u.t = 0;
              u.segment = (u.segment + 1) % (u.ring.length - 1);
            }
            m.position.set(a[0] + (b[0] - a[0]) * u.t, 0.17, a[1] + (b[1] - a[1]) * u.t);
          } else {
            const u = m.userData,
              a = u.graph.nodes.get(u.arc.from),
              b = u.graph.nodes.get(u.arc.to),
              len = u.arc.length;
            u.t += (dt * 3.5) / Math.max(len, 1);
            if (u.t >= 1) {
              const next = (u.graph.out.get(u.arc.to) || []).filter(
                (n: any) => n.to !== u.arc.from,
              );
              if (next.length) {
                u.arc = next[Math.floor(now / 1000) % next.length];
                u.t = 0;
              } else u.t = 1;
            }
            const dx = (b[0] - a[0]) / len,
              dz = (b[1] - a[1]) / len;
            m.position.set(
              a[0] + (b[0] - a[0]) * Math.min(u.t, 1) + dz * 1.4,
              0,
              a[1] + (b[1] - a[1]) * Math.min(u.t, 1) - dx * 1.4,
            );
            m.rotation.y = Math.atan2(-dx, -dz);
          }
          if (m.position.distanceTo(new T.Vector3(pl.x, 0, pl.z)) < (m.userData.ped ? 1.3 : 3.5)) {
            pl.x = before.x;
            pl.z = before.z;
            pl.v = 0;
          }
        }
        const first = p.camera === 'first',
          look = new T.Vector3(
            pl.x - Math.sin(pl.th) * 12,
            first ? 1.4 : 1,
            pl.z - Math.cos(pl.th) * 12,
          ),
          target = new T.Vector3(
            pl.x + Math.sin(pl.th) * (first ? -0.3 : 11) + Math.cos(pl.th) * (first ? 0.36 : 0),
            first ? 1.55 : 6,
            pl.z + Math.cos(pl.th) * (first ? -0.3 : 11) - Math.sin(pl.th) * (first ? 0.36 : 0),
          );
        camera.position.lerp(target, first ? 1 : Math.min(1, dt * 7));
        camera.lookAt(look);
        pl.mesh.visible = !first;
      } else orbit.update();
      if (state.worldScene) {
        state.worldScene.diagnostics.visible = p.diagnostics;
        state.worldScene.updateVisibility(camera, p.driving);
      }
      renderer.render(scene, camera);
      if (now - lastReport > 600) {
        const sorted = frames.slice().sort((a, b) => a - b);
        p.onStats({
          renderer: rendererName,
          pixelRatio: renderer.getPixelRatio(),
          fps: Math.round(1000 / (frames.reduce((a, b) => a + b, 0) / frames.length)),
          frameMs: +(frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(1),
          p95: +(sorted[Math.floor(sorted.length * 0.95)] || 0).toFixed(1),
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          mph: state.physics ? Math.round(Math.abs(state.physics.player.v) * 2.23694) : 0,
          position: state.physics
            ? [state.physics.player.x, state.physics.player.z]
            : [camera.position.x, camera.position.z],
          contacts: state.physics?.contacts || 0,
        });
        frames = [];
        lastReport = now;
      }
    };
    frame = requestAnimationFrame(animate);
    return () => {
      state.driverVersion++;
      cancelAnimationFrame(frame);
      resize.disconnect();
      orbit.dispose();
      gizmo.dispose();
      state.input.dispose();
      state.physics?.dispose();
      state.worldScene?.dispose();
      dispose(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      el.removeEventListener('drop', drop);
      el.removeEventListener('dragover', dragOver);
      engine.current = null;
    };
  }, []);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    let next: WorldScene;
    try {
      next = new WorldScene(props.world, props.compiled);
    } catch (error) {
      props.onError(
        'World rendering failed: ' + (error instanceof Error ? error.message : String(error)),
      );
      return;
    }
    e.worldScene?.dispose();
    e.worldScene = next;
    e.scene.add(e.worldScene.root);
    if (!e.initialized) {
      e.focus();
      e.initialized = true;
    }
    e.select();
    const token = ++e.driverVersion;
    e.physics?.dispose();
    e.physics = null;
    if (props.driving)
      createPhysics(e.scene, props.world, props.compiled)
        .then((p) => {
          if (e.driverVersion !== token) {
            p.dispose();
            return;
          }
          e.physics = p;
        })
        .catch((err) => props.onError(err.message));
  }, [props.compiled, props.driving]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.select();
    if (props.driving && !e.wasDriving)
      e.editorPose = { position: e.camera.position.clone(), target: e.orbit.target.clone() };
    if (!props.driving && e.wasDriving && e.editorPose) {
      e.camera.position.copy(e.editorPose.position);
      e.orbit.target.copy(e.editorPose.target);
      e.orbit.update();
    }
    e.wasDriving = props.driving;
    e.camera.near = props.driving ? 0.15 : 2;
    e.camera.far = props.driving ? 1000 : 2000;
    e.camera.updateProjectionMatrix();
    e.orbit.enabled = !props.driving;
    e.gizmo.enabled = !props.driving;
  }, [props.selected, props.mode, props.snap, props.driving]);
  return (
    <div
      ref={host}
      className="viewport-canvas"
      data-testid="viewport"
      aria-label="Interactive 3D world viewport"
    />
  );
});
