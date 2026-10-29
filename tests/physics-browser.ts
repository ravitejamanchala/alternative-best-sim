import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173');
  await page.getByText('World ready', { exact: true }).waitFor();
  const result = await page.evaluate(async () => {
    const root = '/src',
      THREE = await import(root + '/../node_modules/three/build/three.module.js'),
      { createPhysics } = await import(root + '/sim/physics.ts'),
      { compile } = await import(root + '/world/compiler.ts'),
      { fromOSM } = await import(root + '/world/osm.ts'),
      { CompilerJob } = await import(root + '/world/jobs.ts');
    const sample = fromOSM(await (await fetch('/samples/cambridge.osm.json')).json());
    const w = structuredClone(sample);
    w.sourceObjects = [
      {
        id: 'road',
        kind: 'road',
        name: 'Test road',
        x: 0,
        y: 0,
        z: 0,
        rotation: 0,
        scale: 1,
        points: [
          [0, 80],
          [0, -80],
        ],
        nodeIds: ['a', 'b'],
        width: 20,
        sidewalk: 'both',
        source: { provider: 'manual', id: 'road', confidence: 'manual', tags: {}, inferred: [] },
      },
    ];
    w.spawn = { x: 0, z: 0, heading: 0 };
    w.additions = [];
    w.overrides = {};
    w.sourceIssues = [];
    const scene = new THREE.Scene(),
      p = await createPhysics(scene, w, compile(w));
    const upstream = await import(root + '/vendor/slaydrive/car.js'),
      original = upstream.createPlayer(new THREE.Scene());
    original.place(0, 0, 0);
    for (let i = 0; i < 300; i++) {
      const input = {
        throttle: i < 200 ? 1 : 0,
        brake: i >= 200 ? 1 : 0,
        steer: i < 120 ? 0.12 : 0,
        analog: false,
      };
      p.step(1 / 120, input);
      original.update(1 / 120, input, 'road');
    }
    const parity = Math.max(
      Math.abs(p.player.x - original.x),
      Math.abs(p.player.z - original.z),
      Math.abs(p.player.v - original.v),
    );
    p.dispose();
    w.additions = [
      {
        id: 'wall',
        kind: 'building',
        name: 'Collision fixture',
        x: 0,
        y: 0,
        z: -20,
        rotation: 0,
        scale: 1,
        height: 10,
        rings: [
          [
            [-5, -5],
            [5, -5],
            [5, 5],
            [-5, 5],
            [-5, -5],
          ],
        ],
        source: { provider: 'manual', id: 'wall', confidence: 'manual', tags: {}, inferred: [] },
      },
    ];
    const collision = await createPhysics(new THREE.Scene(), w, compile(w));
    for (let i = 0; i < 1200; i++)
      collision.step(1 / 120, { throttle: 1, brake: 0, steer: 0, analog: false });
    const stopped = {
      z: collision.player.z,
      speed: collision.player.v,
      contacts: collision.contacts,
    };
    collision.reset();
    const reset = { x: collision.player.x, z: collision.player.z, speed: collision.player.v };
    collision.dispose();
    const job = new CompilerJob();
    let cancelled = false;
    const first = job.run(sample).catch((e: any) => {
      cancelled = e.name === 'AbortError';
    });
    job.cancel();
    await first;
    const second = await job.run(w);
    job.cancel();
    return { parity, stopped, reset, cancelled, nextJobObjects: second.objects.length };
  });
  assert.ok(result.parity < 1e-10);
  assert.ok(result.stopped.z > -13 && result.stopped.z < -12);
  assert.equal(result.stopped.speed, 0);
  assert.ok(result.stopped.contacts > 0);
  assert.deepEqual(result.reset, { x: 0, z: 0, speed: 0 });
  assert.equal(result.cancelled, true);
  assert.equal(result.nextJobObjects, 2);
  mkdirSync('test-results', { recursive: true });
  writeFileSync(
    'test-results/physics-browser.json',
    JSON.stringify({ passed: true, ...result }, null, 2),
  );
  console.log(
    'PASS actual vehicle physics parity, swept collision stop, reset, worker cancellation and next-job recovery',
    result,
  );
} finally {
  await browser.close();
}
