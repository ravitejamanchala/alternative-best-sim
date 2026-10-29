// Player car: physics, glTF model loading (with steering/rolling wheels), L-plates, indicators, and simple box cars for traffic.
import { CAR, HANDLING, steerLock } from './config.js';
import { createVehicleState, canDrive } from './vehicle-state.js';
import { automaticVelocity } from './automatic.js';

const T = THREE;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export const lTexture = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#d2232a'; g.fillRect(16, 10, 11, 44); g.fillRect(16, 43, 32, 11);
  return new T.CanvasTexture(c);
})();

// side profile of a small hatchback (x = length, front at +x; y = height), extruded across the width
const BODY_G = (() => {
  const s = new T.Shape(); const P = [[-2.08, 0.34], [2.08, 0.34], [2.12, 0.62], [2.02, 0.82], [1.15, 0.95], [0.42, 1.44], [-0.95, 1.47], [-1.86, 1.1], [-2.08, 0.86]];
  P.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); s.closePath();
  const g = new T.ExtrudeGeometry(s, { depth: 1.62, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 2 });
  g.translate(0, 0, -0.81); g.rotateY(Math.PI / 2); return g;
})();
const GLASS_G = (() => {
  const s = new T.Shape(); const P = [[1.08, 0.97], [0.46, 1.38], [-0.9, 1.41], [-1.74, 1.08], [-1.7, 0.97]];
  P.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); s.closePath();
  const g = new T.ExtrudeGeometry(s, { depth: 1.8, bevelEnabled: false }); g.translate(0, 0, -0.9); g.rotateY(Math.PI / 2); return g;
})();
const glassMat = new T.MeshLambertMaterial({ color: 0x27323b });

export function makeBoxCar(color, learner) {
  const g = new T.Group();
  const body = new T.Mesh(BODY_G, new T.MeshLambertMaterial({ color })); g.add(body);
  const glass = new T.Mesh(GLASS_G, glassMat); g.add(glass);
  const wg = new T.CylinderGeometry(0.34, 0.34, 0.26, 12); wg.rotateZ(Math.PI / 2); const wm = new T.MeshLambertMaterial({ color: 0x1a1d1f });
  const wheels = [];
  [[-0.86, -1.35], [0.86, -1.35], [-0.86, 1.35], [0.86, 1.35]].forEach(([x, z]) => { const w = new T.Mesh(wg, wm); w.position.set(x, 0.34, z); g.add(w); wheels.push(w); });
  const hl = new T.MeshBasicMaterial({ color: 0xfff6dc }), tl = new T.MeshBasicMaterial({ color: 0xb3141c });
  [-0.6, 0.6].forEach(x => { const h = new T.Mesh(new T.BoxGeometry(0.42, 0.12, 0.04), hl); h.position.set(x, 0.72, -2.2); g.add(h); const t = new T.Mesh(new T.BoxGeometry(0.36, 0.14, 0.04), tl); t.position.set(x, 0.8, 2.17); g.add(t); });
  const indL = new T.MeshBasicMaterial({ color: 0x6b4a10 }), indR = new T.MeshBasicMaterial({ color: 0x6b4a10 });
  if (learner) addLearnerKit(g, { minZ: -2.11, maxZ: 2.11, W: 1.8, H: 1.5 }, indL, indR);
  g.userData = { front: wheels.slice(0, 2), wheels, indL, indR, radius: 0.34, roll: false };
  return g;
}
// cyclist: two wheels, frame, rider in a hi-vis or coloured jacket with a helmet
const JACKETS = [0xd8e23a, 0x2f5d8a, 0xb5562b, 0x3f6b46, 0xe7e2d6, 0x8a3b2f];
export function makeBike(i) {
  const g = new T.Group(), dark = new T.MeshLambertMaterial({ color: 0x1d2124 });
  const wg = new T.TorusGeometry(0.33, 0.035, 6, 18); wg.rotateY(Math.PI / 2);
  const wheels = [-0.52, 0.52].map(z => { const w = new T.Mesh(wg, dark); w.position.set(0, 0.36, z); g.add(w); return w; });
  const frame = new T.Mesh(new T.BoxGeometry(0.05, 0.05, 1.0), new T.MeshLambertMaterial({ color: [0x9b2c2c, 0x2a5c8f, 0x2b2e33][i % 3] })); frame.position.set(0, 0.62, 0); frame.rotation.x = 0.12; g.add(frame);
  const crank = new T.Mesh(new T.BoxGeometry(0.04, 0.32, 0.04), dark); crank.position.set(0, 0.4, 0.05); g.add(crank);
  const jacket = new T.MeshLambertMaterial({ color: JACKETS[i % JACKETS.length] });
  const torso = new T.Mesh(new T.BoxGeometry(0.36, 0.62, 0.26), jacket); torso.position.set(0, 1.2, 0.05); torso.rotation.x = -0.45; g.add(torso);
  const head = new T.Mesh(new T.SphereGeometry(0.13, 10, 8), new T.MeshLambertMaterial({ color: 0xd9b896 })); head.position.set(0, 1.58, -0.12); g.add(head);
  const helmet = new T.Mesh(new T.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new T.MeshLambertMaterial({ color: 0xf2f2ec })); helmet.position.set(0, 1.6, -0.12); g.add(helmet);
  const legs = new T.Mesh(new T.BoxGeometry(0.3, 0.55, 0.16), new T.MeshLambertMaterial({ color: 0x2b2e33 })); legs.position.set(0, 0.72, 0.05); g.add(legs);
  const arms = new T.Mesh(new T.BoxGeometry(0.46, 0.08, 0.5), jacket); arms.position.set(0, 1.2, -0.3); arms.rotation.x = 0.3; g.add(arms);
  g.userData = { wheels, crank };
  return g;
}

function addLearnerKit(root, b, indL, indR) {
  const pm = new T.MeshBasicMaterial({ map: lTexture, side: T.DoubleSide });
  const f = new T.Mesh(new T.PlaneGeometry(0.4, 0.4), pm); f.position.set(0, b.H * 0.36, b.minZ - 0.03); root.add(f);
  const r = new T.Mesh(new T.PlaneGeometry(0.4, 0.4), pm); r.position.set(0, b.H * 0.36, b.maxZ + 0.03); root.add(r);
  const t = new T.Mesh(new T.PlaneGeometry(0.4, 0.4), pm); t.rotation.x = -Math.PI / 2; t.position.set(0, b.H + 0.02, b.roofZ || 0.2); root.add(t);
  [[-1, b.minZ, indL], [-1, b.maxZ, indL], [1, b.minZ, indR], [1, b.maxZ, indR]].forEach(([sx, z, m]) => {
    const k = new T.Mesh(new T.BoxGeometry(0.14, 0.1, 0.1), m); k.position.set(sx * (b.W / 2 - 0.1), b.H * 0.42, z + (z < 0 ? 0.03 : -0.03)); root.add(k);
  });
}

// Load a glTF car, scale it to CAR.length, split out wheels so they can steer and roll.
export function loadCarModel(url, options = {}) {
  const spec={...CAR,...options};
  return new Promise((res, rej) => {
    if (!T.GLTFLoader) return rej(new Error('GLTFLoader missing'));
    new T.GLTFLoader().load(url, gltf => {
      try {
        const root = new T.Group(), model = gltf.scene;
        const drop = []; model.traverse(o => { if (spec.hide && spec.hide.test(o.name)) drop.push(o); }); drop.forEach(o => o.parent && o.parent.remove(o));
        model.traverse(o => { if (o.isMesh && o.material && o.material.isMeshStandardMaterial) { o.material.roughness = CAR.material.roughness; o.material.metalness = CAR.material.metalness; } });
        model.rotation.y = spec.yaw; root.add(model); root.updateMatrixWorld(true);
        let box = new T.Box3().setFromObject(model); const size = box.getSize(new T.Vector3());
        model.scale.multiplyScalar(Math.min(CAR.length / size.z,spec.maxWidth ? spec.maxWidth/size.x : Infinity)); root.updateMatrixWorld(true);
        box = new T.Box3().setFromObject(model); const c = box.getCenter(new T.Vector3());
        model.position.set(-c.x, -box.min.y + CAR.lift, -c.z); root.updateMatrixWorld(true);
        box = new T.Box3().setFromObject(model);
        const wheelMeshes = []; model.traverse(o => { if (o.isMesh && spec.wheel(o)) wheelMeshes.push(o); });
        const wheels = [], front = []; let radius = 0.33;
        for (const m of wheelMeshes) {
          const wb = new T.Box3().setFromObject(m), wc = wb.getCenter(new T.Vector3());
          radius = (wb.max.y - wb.min.y) / 2;
          const p = new T.Group(); p.rotation.order = 'YXZ'; p.position.copy(wc); root.add(p); p.updateMatrixWorld(true); p.attach(m);
          wheels.push(p); if (wc.z < 0) front.push(p);
        }
        const indL = new T.MeshBasicMaterial({ color: 0x6b4a10 }), indR = new T.MeshBasicMaterial({ color: 0x6b4a10 });
        // Only the learner's own car carries L plates; the same models are also used for traffic.
        if (spec.learner !== false) addLearnerKit(root, { minZ: box.min.z, maxZ: box.max.z, W: box.max.x - box.min.x, H: box.max.y, roofZ: 0.25 }, indL, indR);
        root.userData = { front, wheels, indL, indR, radius, roll: true };
        res(root);
      } catch (err) { rej(err); }
    }, undefined, rej);
  });
}

// What the driver's seat should look like in this car: the body colour, how wide it is, how high the
// bonnet sits in front of you and where your eyes are. Measured from the model, so the view from
// inside a tall SUV is not the view from inside a coupe.
export function carMetrics(root) {
  if (!root) return null;
  const box = new T.Box3().setFromObject(root), size = box.getSize(new T.Vector3());
  const wheels = new Set(root.userData?.wheels || []);
  const inWheel = (o) => { for (let p = o; p; p = p.parent) if (wheels.has(p)) return true; return false; };
  // The body is the part with the most triangles that is not a wheel or a window. Triangle count beats
  // bounding volume here: a car's shell is by far the most detailed piece, while a black roof panel can
  // have a bigger box than the body around it. Dark is not disqualifying — some cars really are black.
  let body = null, mostTriangles = 0;
  root.traverse(o => {
    if (!o.isMesh || inWheel(o)) return;
    const material = [].concat(o.material)[0];
    if (!material || !material.color || material.transparent) return;
    const index = o.geometry?.index, position = o.geometry?.attributes?.position;
    const triangles = (index ? index.count : position ? position.count : 0) / 3;
    if (triangles > mostTriangles) { mostTriangles = triangles; body = material; }
  });
  return { width: size.x, height: size.y, length: size.z, colour: bodyColour(body) };
}
// A textured model carries its colour in the image, not the material, so sample the texture.
function bodyColour(material, fallback = 0x1d6a46) {
  if (!material) return fallback;
  const hex = material.color.getHex();
  const image = material.map?.image;
  if (!image || !image.width) return hex;
  try {
    const n = 16, canvas = document.createElement('canvas');
    canvas.width = canvas.height = n;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, n, n);
    const data = ctx.getImageData(0, 0, n, n).data;
    let r = 0, g = 0, b = 0, used = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
      if (lum > 0.93) continue; // windows, lights and bare highlights say nothing about the paint
      r += data[i]; g += data[i + 1]; b += data[i + 2]; used++;
    }
    if (!used) return hex;
    return (Math.round(r / used) << 16) | (Math.round(g / used) << 8) | Math.round(b / used);
  } catch (_) { return hex; } // a cross-origin texture cannot be read back
}

export function createPlayer(scene) {
  const p = { x: 0, z: 0, th: 0, v: 0, steer: 0, delta: 0, roll: 0, hold: 0, lean: 0, isPlayer: true, indicator: null, indTh: 0, headlights: false, mesh: makeBoxCar(0x1a7c52, true) };
  p.operation = createVehicleState(); p.observations = [];
  scene.add(p.mesh);
  p.setModel = (m) => { const par = p.mesh.parent || scene; par.remove(p.mesh); p.mesh = m; par.add(m); p.model = m; p.onModel?.(m); };
  p.place = (x, z, th) => Object.assign(p, { x, z, th, v: 0, steer: 0, delta: 0 });
  p.signal = (d) => { p.indicator = p.indicator === d ? null : d; p.indTh = p.th; };
  p.lookAt = -1e9; // last time the driver checked mirrors and blind spot (B)
  // input: {throttle 0..1, brake 0..1, steer -1..1 (left +)}
  p.update = (dt, inp, surface) => {
    p.rawInput = inp;
    const blocked = !canDrive(p.operation);
    if (blocked) inp = { ...inp, throttle: 0, brake: Math.abs(p.v) > 0.3 ? 1 : 0 };
    p.inp = inp;
    const H = HANDLING, st = clamp(inp.steer, -1, 1) * H.steerSensitivity;
    // keys and touch buttons are all-or-nothing, so the wheel winds on gradually while one is held and
    // comes back when it is let go; a controller's stick or a wheel is followed closely
    const rate = inp.analog ? 8 : Math.abs(st) < 0.01 ? 4.5 : 2.6; p.steer += clamp(st - p.steer, -dt * rate, dt * rate);
    const delta = p.steer * steerLock(Math.abs(p.v)); p.delta = delta;
    if (p.operation.transmission === 'automatic') {
      p.v = automaticVelocity(p.v, p.rawInput, p.operation, dt, H, surface); p.hold = 0;
    } else {
    let acc = 0; const thr = inp.throttle > 0.05, brk = inp.brake > 0.05;
    // power fades towards top speed; light drag so a car can reach 70 mph on a dual carriageway (about 0–60 in 10 s)
    if (thr) acc = p.v < -0.1 ? 8 : H.accel * inp.throttle * (1 - (Math.max(0, p.v) / H.topSpeed) ** 2);
    if (brk) { if (p.v > 0.25) { acc = -H.brake * inp.brake; p.hold = 0; } else { p.hold += dt; if (p.hold > 0.6) acc = -2.2; else p.v = Math.min(p.v, 0) * 0.9; } } else p.hold = 0;
    // off the accelerator while rolling forward: the car settles at a slow creep (like the clutch biting point) instead of
    // rolling to a stop, so corners can be taken slowly; brake to stop. A stopped car stays where it is.
    if (!thr && !brk) acc = p.v > 0.3 && p.v < H.creep ? Math.min(1.2, (H.creep - p.v) * 2) : -Math.sign(p.v) * 0.55;
    if (blocked) { acc = -Math.sign(p.v) * H.brake; if (Math.abs(p.v) < H.brake * dt) { p.v = 0; acc = 0; } }
    acc -= H.drag * p.v * Math.abs(p.v);
    if (surface === 'off') acc -= Math.sign(p.v) * 2.4;
    const nv = p.v + acc * dt;
    if (!thr && !brk && Math.abs(nv) < 0.12 && p.v <= 0.3) p.v = 0; else if (brk && p.v > 0 && nv < 0) p.v = 0; else p.v = nv;
    p.v = clamp(p.v, -H.reverseSpeed, H.topSpeed);
    }
    // bicycle model about the rear axle: the back wheels follow, the front swings out, like a real car
    const half = H.wheelbase / 2;
    let rx = p.x + Math.sin(p.th) * half, rz = p.z + Math.cos(p.th) * half;
    const yawRate = p.v / H.wheelbase * Math.tan(delta);
    rx += -Math.sin(p.th) * p.v * dt; rz += -Math.cos(p.th) * p.v * dt;
    p.th += yawRate * dt;
    p.x = rx - Math.sin(p.th) * half; p.z = rz - Math.cos(p.th) * half;
    // body roll from lateral acceleration (visual only)
    p.lean += ((-yawRate * p.v) * 0.012 - p.lean) * Math.min(1, dt * 6); p.lean = clamp(p.lean, -0.05, 0.05);
    p.roll = (p.roll + p.v * dt / (p.mesh.userData.radius || 0.33)) % (Math.PI * 2);
    if (p.indicator && Math.abs(wrap(p.th - p.indTh)) > 1.15 && Math.abs(p.steer) < 0.12) p.indicator = null;
  };
  p.sync = (clock) => {
    const m = p.mesh, u = m.userData; m.position.set(p.x, 0, p.z); m.rotation.y = p.th; m.rotation.z = p.lean;
    for (const w of u.wheels) { if (u.roll) w.rotation.x = -p.roll; w.rotation.y = u.front.includes(w) ? p.delta : 0; }
    const blink = Math.floor(clock * 3) % 2 === 0;
    u.indL.color.setHex(p.indicator === 'L' && blink ? 0xffb21a : 0x6b4a10); u.indR.color.setHex(p.indicator === 'R' && blink ? 0xffb21a : 0x6b4a10);
  };
  return p;
}
