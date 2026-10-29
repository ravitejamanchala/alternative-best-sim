import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const target = new URL(process.env.STUDIO_URL || 'http://127.0.0.1:4173/alternative-best-sim/');
assert.ok(target.pathname.endsWith('/alternative-best-sim/'), 'Exercise the real repository path');
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
  const errors: string[] = [],
    failures: string[] = [],
    misplaced: string[] = [],
    samples: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) failures.push(r.status() + ' ' + new URL(r.url()).pathname);
  });
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (!['http:', 'https:'].includes(url.protocol)) return;
    if (url.origin !== target.origin || !url.pathname.startsWith(target.pathname))
      misplaced.push(url.origin + url.pathname);
    if (url.pathname.endsWith('/samples/cambridge.osm.json')) samples.push(url.pathname);
  });
  await page.goto(target.href);
  await page.getByText('World ready', { exact: true }).waitFor();
  assert.equal(await page.locator('.object-row').count(), 16);
  await page.getByRole('button', { name: 'Use Cambridge offline example', exact: true }).click();
  await page.getByText('World ready', { exact: true }).waitFor();
  assert.ok(samples.length >= 2, 'Regeneration must also load from the Pages repository path');
  await page.getByRole('button', { name: 'Test drive', exact: true }).click();
  await page.getByText('FREE DRIVE · NO ASSESSMENT').waitFor();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1800);
  await page.keyboard.up('KeyW');
  assert.ok(Number(await page.getByTestId('speed').innerText()) > 0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'World JSON', exact: false }).click();
  const world = JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
  assert.equal(world.sourceObjects.length, 164);
  assert.equal(world.schema, 'slaydrive-world');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  assert.deepEqual(misplaced, []);
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/github-pages.png' });
  writeFileSync(
    'test-results/pages-browser.json',
    JSON.stringify(
      {
        passed: true,
        checks: 4,
        path: target.pathname,
        sampleRequests: samples.length,
        errors,
        failedResponses: failures,
        misplacedRequests: misplaced,
        checksCovered: [
          'repository-path assets and worker',
          'sample regeneration',
          'lazy vehicle physics and driving',
          'complete World export',
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS GitHub Pages path: sample, assets, worker, regeneration, actual driving and complete export',
  );
} finally {
  await browser.close();
}
