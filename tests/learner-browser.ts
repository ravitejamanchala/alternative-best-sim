import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fromOSM } from '../src/world/osm';
import { exportTrack } from '../src/sim/adapter';
import { manualObject } from '../src/world/authoring';
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
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
  );
  await page.goto(process.env.LEARNER_URL || 'http://127.0.0.1:5175');
  await page.getByLabel('Import World track', { exact: true }).waitFor({ timeout: 60000 });
  const w = fromOSM(JSON.parse(readFileSync('public/samples/cambridge.osm.json', 'utf8')));
  const marker = manualObject('checkpoint', [w.spawn.x + 20, w.spawn.z + 20]);
  marker.name = 'Learner round-trip checkpoint';
  w.additions.push(marker);
  const original = exportTrack(w);
  await page.getByLabel('Import World track', { exact: true }).setInputFiles({
    name: 'cambridge.slaydrive.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(original)),
  });
  await page
    .getByText('World loaded · complete metadata retained', { exact: true })
    .waitFor({ timeout: 30000 });
  const before = await page.evaluate(() => {
    const d = (window as any).cambridgeDrive;
    d.manual(true);
    d.test.running = true;
    const previous = d.test.S;
    d.test.fault('S', 'Junctions – observation', 'Integration assertion', 'integration-check', 0);
    return {
      seriousBefore: previous,
      seriousAfter: d.test.S,
      passed: d.test.passed(),
      ungraded: d.test.ungraded,
      netEdges: d.net.edges.length,
      area: d.area,
    };
  });
  assert.equal(before.seriousAfter, before.seriousBefore + 1);
  assert.equal(before.passed, false);
  assert.equal(before.ungraded, false);
  assert.equal(before.netEdges, original.network.edges.length);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export World', exact: true }).click();
  const exported = JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
  assert.deepEqual(exported, original);
  await page.reload();
  await page.getByLabel('Import World track', { exact: true }).waitFor({ timeout: 60000 });
  await page.getByLabel('Import World track', { exact: true }).setInputFiles({
    name: 'reload.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await page
    .getByText('World loaded · complete metadata retained', { exact: true })
    .waitFor({ timeout: 30000 });
  const reexport = await page.evaluate(() =>
    JSON.parse((window as any).cambridgeDrive.exportWorld()),
  );
  assert.deepEqual(reexport, original);
  await page.evaluate(() => {
    const d = (window as any).cambridgeDrive;
    d.manual(true);
    d.test.running = false;
    d.setCam(2);
    for (let i = 0; i < 40; i++) d.frame(0.05);
  });
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/learner-world-overhead.png' });
  await page.evaluate(() => {
    const d = (window as any).cambridgeDrive;
    d.setCam(1);
    for (let i = 0; i < 40; i++) d.frame(0.05);
  });
  await page.screenshot({ path: 'test-results/learner-world-driver.png' });
  assert.deepEqual(errors, []);
  writeFileSync(
    'test-results/learner-browser.json',
    JSON.stringify(
      {
        passed: true,
        checks: 3,
        upstream: '912e5e667c3ad991484c54d92cf056767a7f97d2',
        roundTrip:
          'export → actual learner UI import → export → browser reload → reimport → re-export',
        assessment: before,
        scope: 'Local read-only development overlay; existing learner checkout unchanged',
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS existing learner UI World import/export/reload parity, native assessment fault handling, overhead and driver renders',
  );
} finally {
  await browser.close();
}
