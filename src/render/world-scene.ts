import * as T from 'three';
import * as GeometryUtilities from 'three/examples/jsm/utils/BufferGeometryUtils.js';
// Three r128's examples are ESM in browsers but load through a CJS wrapper under Node/tsx.
const BufferGeometryUtils =
  GeometryUtilities.BufferGeometryUtils ||
  Reflect.get(GeometryUtilities, 'default')?.BufferGeometryUtils;
import type { World, CompiledWorld, MultiPolygon, Point, WorldObject } from '../world/types';
import { coordinates, roadPoints } from '../world/model';
import { inPolygon, distance } from '../world/geo';
export function dispose(root: T.Object3D) {
  const gs = new Set<T.BufferGeometry>(),
    ms = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  root.traverse((o: any) => {
    if (o.geometry) gs.add(o.geometry);
    if (o.material)
      [].concat(o.material).forEach((m: any) => {
        ms.add(m);
        if (m.map) textures.add(m.map);
      });
  });
  gs.forEach((g) => g.dispose());
  ms.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
  root.parent?.remove(root);
}
function shape(poly: Point[][]) {
  const s = new T.Shape(poly[0].map((p) => new T.Vector2(p[0], -p[1])));
  for (const r of poly.slice(1)) s.holes.push(new T.Path(r.map((p) => new T.Vector2(p[0], -p[1]))));
  return s;
}
export function surface(polys: MultiPolygon, color: string, y: number, depth = 0) {
  const group = new T.Group();
  for (const p of polys) {
    const s = shape(p);
    const g = depth
      ? new T.ExtrudeGeometry(s, { depth, bevelEnabled: false, steps: 1 })
      : new T.ShapeGeometry(s);
    g.rotateX(-Math.PI / 2);
    const mesh = new T.Mesh(g, new T.MeshLambertMaterial({ color, side: T.DoubleSide }));
    mesh.position.y = y;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
function box(w: number, h: number, d: number, color: string) {
  return new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshLambertMaterial({ color }));
}
function tree(o: WorldObject) {
  const g = new T.Group();
  const trunk = new T.Mesh(
    new T.CylinderGeometry(0.13, 0.22, 2, 6),
    new T.MeshLambertMaterial({ color: '#79674b' }),
  );
  trunk.position.y = 1;
  g.add(trunk);
  const crown = new T.Mesh(
    new T.IcosahedronGeometry(o.width || 2.3, 1),
    new T.MeshLambertMaterial({ color: '#6f9164' }),
  );
  crown.position.y = o.height || 5;
  crown.scale.y = 1.3;
  crown.castShadow = true;
  g.add(crown);
  return g;
}
function building(o: WorldObject) {
  const g = new T.Group();
  const rings = o.rings!;
  const h = o.height || 7.8;
  const use = o.source.tags.building || 'yes',
    shop = !!o.shops?.length || use === 'retail' || o.source.tags.amenity === 'pub';
  const s = shape(rings);
  const geo = new T.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, steps: 1 });
  geo.rotateX(-Math.PI / 2);
  const walls = new T.Mesh(geo, [
    new T.MeshLambertMaterial({ color: o.roof === 'flat' ? '#aaa497' : '#716961' }),
    new T.MeshLambertMaterial({ color: o.color || '#c0ad96' }),
  ]);
  walls.castShadow = true;
  walls.receiveShadow = true;
  g.add(walls);

  // Tagged simple roofs fit inside the footprint. Complex roofs keep their tagged metadata and a flat visual cap.
  if (
    ['gabled', 'hipped', 'pyramidal'].includes(o.roof || '') &&
    rings.length === 1 &&
    rings[0].length === 5
  ) {
    const raw = rings[0].slice(0, 4);
    const r =
      distance(raw[0], raw[1]) >= distance(raw[1], raw[2]) ? raw : [raw[1], raw[2], raw[3], raw[0]];
    const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let ra = mid(r[0], r[3]),
      rb = mid(r[1], r[2]);
    const centre = mid(ra, rb),
      rise = Math.min(2.2, distance(r[0], r[3]) * 0.45);
    if (o.roof === 'pyramidal') ra = rb = centre;
    else if (o.roof === 'hipped') {
      const k = Math.min(0.35, (distance(r[0], r[3]) / (distance(ra, rb) || 1)) * 0.4);
      const a = ra,
        b = rb;
      ra = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      rb = [b[0] + (a[0] - b[0]) * k, b[1] + (a[1] - b[1]) * k];
    }
    const pos: number[] = [];
    const tri = (a: Point, ay: number, b: Point, by: number, c: Point, cy: number) =>
      pos.push(a[0], ay, a[1], b[0], by, b[1], c[0], cy, c[1]);
    tri(r[0], h, r[1], h, rb, h + rise);
    tri(r[0], h, rb, h + rise, ra, h + rise);
    tri(r[2], h, r[3], h, ra, h + rise);
    tri(r[2], h, ra, h + rise, rb, h + rise);
    tri(r[3], h, r[0], h, ra, h + rise);
    tri(r[1], h, r[2], h, rb, h + rise);
    const rg = new T.BufferGeometry();
    rg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    rg.computeVertexNormals();
    g.add(new T.Mesh(rg, new T.MeshLambertMaterial({ color: '#706d68', side: T.DoubleSide })));
  }
  // Original decorative doors sit on an outer wall; their placement is explicitly illustrative.
  const outer = rings[0];
  let frontage = 1;
  for (let i = 2; i < outer.length; i++)
    if (distance(outer[i - 1], outer[i]) > distance(outer[frontage - 1], outer[frontage]))
      frontage = i;
  const a = outer[frontage - 1],
    b = outer[frontage],
    len = distance(a, b);
  if (len > 2) {
    const dx = (b[0] - a[0]) / len,
      dz = (b[1] - a[1]) / len,
      px = (a[0] + b[0]) / 2,
      pz = (a[1] + b[1]) / 2;
    let nx = -dz,
      nz = dx;
    if (!inPolygon([px + nx * 0.1, pz + nz * 0.1], rings)) {
      nx = -nx;
      nz = -nz;
    }
    const count =
      use === 'terrace'
        ? Math.max(1, Math.floor(len / 5))
        : use === 'semidetached_house' && len > 6
          ? 2
          : 1;
    for (let k = 0; k < count; k++) {
      const t = ((k + 0.5) * len) / count,
        cx = a[0] + dx * t,
        cz = a[1] + dz * t,
        industrial = use === 'industrial' || use === 'warehouse';
      const dw = industrial ? Math.min(3, len - 1) : 0.9,
        dh = industrial ? Math.min(3, h - 0.3) : Math.min(2.05, h - 0.2);
      const door = box(dw, dh, 0.08, industrial ? '#7c8888' : '#465a50');
      door.position.set(cx + nx * 0.03, dh / 2, cz + nz * 0.03);
      door.rotation.y = -Math.atan2(dz, dx);
      g.add(door);
      const lintel = box(dw + 0.2, 0.12, 0.11, '#d6cbb5');
      lintel.position.set(cx + nx * 0.04, dh + 0.05, cz + nz * 0.04);
      lintel.rotation.y = door.rotation.y;
      g.add(lintel);
    }
    if (shop && len > 4 && h > 3) {
      const sw = Math.min(len - 1, 10),
        fascia = box(sw, 0.55, 0.1, '#455d4c');
      fascia.position.set(px + nx * 0.025, 2.65, pz + nz * 0.025);
      fascia.rotation.y = -Math.atan2(dz, dx);
      g.add(fascia);
      for (const side of [-1, 1]) {
        const glass = box((sw - 1.4) / 2, 1.65, 0.08, '#7e9a9b');
        glass.position.set(
          px + (dx * side * (sw + 1.4)) / 4 + nx * 0.025,
          1.35,
          pz + (dz * side * (sw + 1.4)) / 4 + nz * 0.025,
        );
        glass.rotation.y = fascia.rotation.y;
        g.add(glass);
      }
      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 64;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#455d4c';
        ctx.fillRect(0, 0, 512, 64);
        ctx.fillStyle = '#f7edd1';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '500 32px sans-serif';
        ctx.fillText(o.shops?.[0] || o.name, 256, 32, 490);
        const texture = new T.CanvasTexture(canvas);
        texture.encoding = T.sRGBEncoding;
        const label = new T.Mesh(
          new T.PlaneGeometry(sw - 0.15, 0.45),
          new T.MeshBasicMaterial({ map: texture, side: T.DoubleSide }),
        );
        label.position.set(px - nx * 0.03, 2.65, pz - nz * 0.03);
        label.rotation.y = fascia.rotation.y;
        label.userData.unbatched = true;
        g.add(label);
      }
    }
  }
  return g;
}
export class WorldScene {
  root = new T.Group();
  objects = new Map<string, T.Object3D>();
  pickables: T.Object3D[] = [];
  diagnostics = new T.Group();
  route = new T.Group();
  windows: T.InstancedMesh | null = null;
  chunks: T.Object3D[] = [];
  constructor(
    public world: World,
    public compiled: CompiledWorld,
  ) {
    this.root.name = 'Shared compiled world';
    this.root.add(surface(compiled.asphalt, '#5c6568', 0.02));
    this.root.add(surface(compiled.pavement, '#d9d6c9', 0.025, 0.16));
    this.root.add(surface(compiled.markings, '#eeeae0', 0.04));
    const transforms: T.Matrix4[] = [],
      dummy = new T.Object3D();
    for (const o of compiled.objects) {
      let g: T.Object3D;
      if (['road', 'lane', 'junction'].includes(o.kind)) {
        const p = o.kind === 'road' ? roadPoints(world, o) : coordinates(o),
          geo = new T.BufferGeometry().setFromPoints(p.map(([x, z]) => new T.Vector3(x, 0.26, z)));
        const line = new T.Line(
          geo,
          new T.LineBasicMaterial({
            color: '#a6dd69',
            transparent: true,
            opacity: 0,
            depthWrite: false,
          }),
        );
        line.userData.id = o.id;
        g = line;
      } else {
        if (o.kind === 'building') {
          g = building(o);
          const rings = o.rings!,
            h = o.height || 7.8;
          for (const ring of rings)
            for (let j = 1; j < ring.length; j++) {
              const a = ring[j - 1],
                b = ring[j],
                len = distance(a, b);
              if (len < 2) continue;
              const dx = (b[0] - a[0]) / len,
                dz = (b[1] - a[1]) / len;
              let nx = -dz,
                nz = dx;
              const mid: Point = [(a[0] + b[0]) / 2 + nx * 0.12, (a[1] + b[1]) / 2 + nz * 0.12];
              if (!inPolygon(mid, rings)) {
                nx = -nx;
                nz = -nz;
              }
              const use = o.source.tags.building || '',
                commercial = ['office', 'apartments'].includes(use),
                industrial = ['industrial', 'warehouse'].includes(use),
                shop = !!o.shops?.length || use === 'retail' || o.source.tags.amenity === 'pub';
              const count = Math.floor(len / (industrial ? 6 : commercial ? 2.6 : 3.1));
              for (let level = shop ? 1 : 0; level < Math.min(10, Math.floor(h / 3)); level++)
                for (let k = 0; k < count; k++) {
                  const t = ((k + 0.5) * len) / count,
                    px = a[0] + dx * t + nx * 0.025,
                    pz = a[1] + dz * t + nz * 0.025;
                  if (!inPolygon([px, pz], rings)) continue;
                  const angle = (o.rotation * Math.PI) / 180;
                  dummy.position.set(
                    o.x + (px * Math.cos(angle) - pz * Math.sin(angle)) * o.scale,
                    o.y + (1.55 + level * 3) * o.scale,
                    o.z + (px * Math.sin(angle) + pz * Math.cos(angle)) * o.scale,
                  );
                  dummy.rotation.set(0, -Math.atan2(dz, dx) - angle, 0);
                  dummy.scale.set(
                    (industrial ? 1.8 : commercial ? 1.4 : 0.85) * o.scale,
                    (industrial ? 0.8 : 1.3) * o.scale,
                    0.08,
                  );
                  dummy.updateMatrix();
                  transforms.push(dummy.matrix.clone());
                }
            }
        } else if (o.kind === 'tree') g = tree(o);
        else if (o.kind === 'sign' || o.kind === 'signal') {
          const group = new T.Group(),
            pole = box(0.1, 2.5, 0.1, '#747c7a');
          pole.position.y = 1.25;
          group.add(pole);
          const head = box(
            o.kind === 'sign' ? 0.8 : 0.32,
            o.kind === 'sign' ? 0.7 : 0.85,
            0.1,
            o.kind === 'sign' ? '#e7e6db' : '#283332',
          );
          head.position.y = 2.2;
          group.add(head);
          if (o.kind === 'signal')
            for (let i = 0; i < 3; i++) {
              const lens = new T.Mesh(
                new T.SphereGeometry(0.075, 8, 6),
                new T.MeshBasicMaterial({ color: ['#ec6657', '#dac762', '#6d846b'][i] }),
              );
              lens.position.set(0, 2.45 - i * 0.25, 0.09);
              group.add(lens);
            }
          g = group;
        } else {
          const color =
            o.kind === 'parking'
              ? '#e8e8d4'
              : o.kind === 'checkpoint'
                ? '#b9e96e'
                : o.kind === 'zone'
                  ? '#d9b56c'
                  : '#eee9d6';
          if (o.kind === 'marking') {
            g = box(o.width || 2.4, 0.06, 0.6, color);
            const mat = (g as T.Mesh).material as T.Material;
            mat.transparent = true;
            mat.opacity = 0;
            mat.depthWrite = false;
          } else if (o.kind === 'parking') {
            const bay = new T.Group(),
              w = o.width || 2.4,
              l = o.length || 5;
            for (const x of [-w / 2, w / 2]) {
              const line = box(0.1, 0.025, l, color);
              line.position.set(x, 0.21, 0);
              bay.add(line);
            }
            const end = box(w, 0.025, 0.1, color);
            end.position.set(0, 0.21, -l / 2);
            bay.add(end);
            g = bay;
          } else if (o.rings) g = surface([o.rings], color, 0.035);
          else {
            g = box(o.width || 2.4, 0.06, o.length || 5, color);
            g.position.y = 0.2;
          }
        }
        g.position.set(o.x, o.y, o.z);
        g.rotation.y = (-o.rotation * Math.PI) / 180;
        g.scale.setScalar(o.scale);
        g.traverse((c) => (c.userData.id = o.id));
      }
      this.root.add(g);
      this.objects.set(o.id, g);
      this.pickables.push(g);
    }
    // Batch opaque building faces by 100 m cell. Retain non-rendering meshes for exact selection.
    this.root.updateMatrixWorld(true);
    const batches = new Map<string, T.BufferGeometry[]>();
    for (const o of compiled.objects.filter((o) => o.kind === 'building')) {
      const key = Math.floor(o.x / 100) + ',' + Math.floor(o.z / 100),
        group = this.objects.get(o.id)!;
      if (!batches.has(key)) batches.set(key, []);
      group.traverse((mesh: any) => {
        if (!mesh.isMesh || mesh.userData.unbatched) return;
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        geometry.applyMatrix4(mesh.matrixWorld);
        const count = geometry.attributes.position.count,
          colors = new Float32Array(count * 3),
          materials: T.MeshLambertMaterial[] = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
        const groups = geometry.groups.length
          ? geometry.groups
          : [{ start: 0, count, materialIndex: 0 }];
        for (const gr of groups) {
          const c = (materials[gr.materialIndex || 0] || materials[0]).color
            .clone()
            .convertSRGBToLinear();
          for (let i = gr.start; i < Math.min(count, gr.start + gr.count); i++) {
            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;
          }
        }
        geometry.clearGroups();
        geometry.deleteAttribute('uv');
        geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
        batches.get(key)!.push(geometry);
        materials.forEach((m) => (m.visible = false));
      });
    }
    for (const [key, parts] of batches) {
      const geom = BufferGeometryUtils.mergeBufferGeometries(parts, false);
      if (!geom) throw Error('Building batch geometry incompatible');
      const mesh = new T.Mesh(geom, new T.MeshLambertMaterial({ vertexColors: true }));
      geom.computeBoundingSphere();
      mesh.userData.centre = geom.boundingSphere!.center.clone();
      mesh.userData.chunk = key;
      this.chunks.push(mesh);
      this.root.add(mesh);
      parts.forEach((g) => g.dispose());
    }
    if (transforms.length) {
      const instances = new Map<string, T.Matrix4[]>();
      for (const m of transforms) {
        const e = m.elements,
          key = Math.floor(e[12] / 100) + ',' + Math.floor(e[14] / 100);
        if (!instances.has(key)) instances.set(key, []);
        instances.get(key)!.push(m);
      }
      for (const [key, matrices] of instances) {
        const mesh = new T.InstancedMesh(
          new T.BoxGeometry(1, 1, 1),
          new T.MeshLambertMaterial({ color: '#576f76' }),
          matrices.length,
        );
        matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.userData.centre = new T.Vector3(matrices[0].elements[12], 0, matrices[0].elements[14]);
        mesh.userData.detail = true;
        mesh.frustumCulled = false;
        this.chunks.push(mesh);
        this.root.add(mesh);
        this.windows = mesh;
      }
    }
    if (world.route) {
      const p = world.route.points.map(([x, z]) => new T.Vector3(x, 0.3, z));
      const line = new T.Line(
        new T.BufferGeometry().setFromPoints(p),
        new T.LineBasicMaterial({ color: '#b6eb60' }),
      );
      this.route.add(line);
      world.route.points
        .filter((_, i) => i === 0 || i === world.route!.points.length - 1)
        .forEach(([x, z]) => {
          const m = new T.Mesh(
            new T.CylinderGeometry(1.4, 1.4, 0.12, 24),
            new T.MeshBasicMaterial({ color: '#c3f177' }),
          );
          m.position.set(x, 0.3, z);
          this.route.add(m);
        });
      this.root.add(this.route);
    }
    const spawn = new T.Mesh(
      new T.ConeGeometry(1.2, 3, 3),
      new T.MeshBasicMaterial({ color: '#b6e96b' }),
    );
    spawn.rotation.x = -Math.PI / 2;
    spawn.rotation.z = -world.spawn.heading;
    spawn.position.set(world.spawn.x, 0.6, world.spawn.z);
    this.root.add(spawn);
    for (const d of compiled.diagnostics.filter((d) => d.point)) {
      const m = new T.Mesh(
        new T.RingGeometry(2, 2.4, 24),
        new T.MeshBasicMaterial({
          color: d.severity === 'error' ? '#ee7464' : '#e4b65e',
          side: T.DoubleSide,
        }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(d.point![0], 0.3, d.point![1]);
      this.diagnostics.add(m);
    }
    this.diagnostics.visible = false;
    this.root.add(this.diagnostics);
    const materials = new Set<T.Material>();
    this.root.traverse((o: any) => {
      if (o.material) for (const m of [].concat(o.material)) materials.add(m);
    });
    materials.forEach((m: any) => m.color?.convertSRGBToLinear());
  }
  updateVisibility(camera: T.Camera, driving: boolean) {
    for (const mesh of this.chunks) {
      const d = mesh.userData.centre.distanceTo(camera.position);
      mesh.visible = d < (driving ? (mesh.userData.detail ? 240 : 500) : 1800);
    }
  }
  dispose() {
    dispose(this.root);
    this.objects.clear();
  }
}
