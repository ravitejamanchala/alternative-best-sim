import { chromium, type Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const base = process.env.STUDIO_URL || 'http://127.0.0.1:5173';
const out = 'test-results';
mkdirSync(out, { recursive: true });
const result: any = {
  at: new Date().toISOString(),
  browser: 'system Chromium, SwiftShader',
  viewport: { width: 1440, height: 960 },
  checks: [],
  errors: [],
  externalRequests: [],
};
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const context = await browser.newContext({ viewport: result.viewport, acceptDownloads: true });
const page = await context.newPage();
page.on('pageerror', (e) => result.errors.push(e.message));
page.on('request', (r) => {
  if (!r.url().startsWith(base) && !r.url().startsWith('blob:') && !r.url().startsWith('data:'))
    result.externalRequests.push(r.url().split('?')[0]);
});
const ready = async (p = page) => {
  await p.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await p.waitForFunction(
    () => document.querySelector('.app')?.getAttribute('data-busy') === 'false',
  );
  await p.getByText('World ready', { exact: true }).waitFor({ timeout: 30000 });
  await p.getByRole('button', { name: 'Test drive', exact: true }).waitFor();
};
const check = async (name: string, action: () => Promise<void>) => {
  const start = Date.now();
  try {
    await action();
    result.checks.push({ name, passed: true, ms: Date.now() - start });
    console.log('PASS', name);
  } catch (e: any) {
    result.checks.push({ name, passed: false, error: e.message });
    await page.screenshot({ path: out + '/failure.png' });
    throw e;
  }
};
async function exported() {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: 'World JSON', exact: false }).click();
  const d = await download;
  const path = await d.path();
  const parsed = JSON.parse(readFileSync(path!, 'utf8'));
  await page.getByRole('button', { name: 'Close dialog' }).click();
  return parsed;
}
try {
  await check('Offline Cambridge loads with no external provider/assets', async () => {
    await page.goto(base);
    await ready();
    assert.equal(await page.locator('.object-row').count(), 16);
    assert.equal(result.errors.length, 0);
    assert.equal(result.externalRequests.length, 0);
    await page.screenshot({ path: out + '/editor-overview.png' });
  });
  await check('Object selection and numeric road width update', async () => {
    await page.getByRole('button', { name: "Bene't Street", exact: true }).click();
    const width = page.getByRole('spinbutton', { name: 'Carriageway width' });
    assert.equal(await width.inputValue(), '6');
    await width.fill('7');
    await width.blur();
    await ready();
    assert.equal(await width.inputValue(), '7');
  });
  await check('Undo, redo, deletion and recovery', async () => {
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await ready();
    assert.equal(
      await page.getByRole('spinbutton', { name: 'Carriageway width' }).inputValue(),
      '6',
    );
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await ready();
    assert.equal(
      await page.getByRole('spinbutton', { name: 'Carriageway width' }).inputValue(),
      '7',
    );
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await ready();
    assert.equal(await page.getByRole('button', { name: "Bene't Street", exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await ready();
    await page.getByRole('button', { name: "Bene't Street", exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: "Bene't Street", exact: true }).count(), 1);
  });
  await check('Building height, duplicate and deletion are real edits', async () => {
    await page.getByRole('textbox', { name: 'Search objects' }).fill('building');
    await page.locator('.object-row').first().click();
    const h = page.getByRole('spinbutton', { name: 'Height' });
    await h.fill('12');
    await h.blur();
    await ready();
    assert.equal(await h.inputValue(), '12');
    const before = (await exported()).additions.length;
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await ready();
    assert.equal((await exported()).additions.length, before + 1);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await ready();
    await page.getByRole('textbox', { name: 'Search objects' }).fill('');
  });
  await check('Road control points can be edited through the inspector and undone', async () => {
    await page.getByRole('button', { name: 'Trumpington Street', exact: true }).click();
    await page
      .locator('.right-panel')
      .getByRole('button', { name: 'Edit control points', exact: true })
      .click();
    const input = page.getByRole('spinbutton', { name: 'Vertex 0:0 X', exact: true });
    const before = Number(await input.inputValue());
    await input.fill(String(before + 1));
    await input.blur();
    await ready();
    assert.ok(Math.abs(Number(await input.inputValue()) - before - 1) < 0.01);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await ready();
    assert.ok(Math.abs(Number(await input.inputValue()) - before) < 0.01);
    await page.getByRole('button', { name: 'Select (V)', exact: true }).click();
  });
  await check('Save, reload and revision restore preserve edits', async () => {
    await page.getByRole('button', { name: 'Save revision', exact: true }).click();
    await page.getByText('Immutable revision saved on this device').waitFor();
    await page.reload();
    await ready();
    await page.getByRole('button', { name: "Bene't Street", exact: true }).click();
    assert.equal(
      await page.getByRole('spinbutton', { name: 'Carriageway width' }).inputValue(),
      '7',
    );
    await page.getByRole('button', { name: 'Revision history' }).click();
    await page.locator('.revision').first().waitFor();
    assert.ok((await page.locator('.revision').count()) > 0);
    await page.locator('.revision').first().click();
    await ready();
  });
  await check('Regeneration retains authored road width', async () => {
    await page.getByRole('button', { name: 'Use Cambridge offline example' }).click();
    await ready();
    await page.getByRole('button', { name: "Bene't Street", exact: true }).click();
    assert.equal(
      await page.getByRole('spinbutton', { name: 'Carriageway width' }).inputValue(),
      '7',
    );
  });
  await check('Complete native adapter export/import/re-export parity in browser', async () => {
    const original = await exported();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'SlayDrive track JSON', exact: false }).click();
    const path = await (await pending).path();
    const track = JSON.parse(readFileSync(path!, 'utf8'));
    assert.deepEqual(track.slaydriveWorld.world, original);
    await page.locator('input[type=file]').setInputFiles({
      name: 'track.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(track)),
    });
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await ready();
    assert.deepEqual(await exported(), original);
  });
  await check('Malformed and oversized imports leave current world intact', async () => {
    const before = await exported();
    await page.locator('input[type=file]').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"schema":"broken"}'),
    });
    await page.getByRole('alert').waitFor();
    await page.getByRole('button', { name: 'Dismiss error' }).click();
    assert.deepEqual(await exported(), before);
    await page.locator('input[type=file]').setInputFiles({
      name: 'huge.json',
      mimeType: 'application/json',
      buffer: Buffer.alloc(20 * 1024 * 1024 + 1, 32),
    });
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /20 MiB/);
    await page.getByRole('button', { name: 'Dismiss error' }).click();
    assert.deepEqual(await exported(), before);
  });
  await check('Provider failure and cancellation retain the compiled world', async () => {
    await page.route('**/api/maps/osm', (r) =>
      r.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Test provider unavailable' }),
      }),
    );
    await page.getByRole('button', { name: 'Generate world', exact: false }).click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /Test provider unavailable/);
    await page.getByRole('button', { name: 'Dismiss error' }).click();
    await page.unroute('**/api/maps/osm');
    await page.route('**/api/maps/osm', async (r) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: readFileSync('public/samples/cambridge.osm.json', 'utf8'),
      });
    });
    await page.getByRole('button', { name: 'Generate world', exact: false }).click();
    await page.getByRole('button', { name: 'Cancel generation' }).click();
    await page.waitForTimeout(3000);
    assert.match(await page.locator('.statusbar').innerText(), /Cancelled/);
    assert.equal(await page.locator('canvas').count(), 1);
    await page.unroute('**/api/maps/osm');
  });
  await check('Overview and top-down screenshots render same geography', async () => {
    await page.getByRole('button', { name: 'Fit world', exact: true }).click();
    await page.getByRole('button', { name: 'Top view', exact: true }).click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: out + '/editor-top.png' });
    await page.getByRole('button', { name: 'Perspective view', exact: true }).click();
  });
  await check('Actual SlayDrive keyboard driving, camera and reset', async () => {
    await page.getByRole('button', { name: 'Test drive', exact: true }).click();
    await page.getByText('FREE DRIVE · NO ASSESSMENT').waitFor();
    await page.waitForTimeout(1200);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(3000);
    await page.keyboard.up('KeyW');
    assert.ok(Number(await page.getByTestId('speed').innerText()) > 1);
    await page.screenshot({ path: out + '/drive-chase.png' });
    await page.getByRole('button', { name: 'Chase camera', exact: true }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: out + '/drive-first-person.png' });
    await page.getByRole('button', { name: 'Reset to spawn', exact: true }).click();
    await page.waitForTimeout(900);
    assert.equal(Number(await page.getByTestId('speed').innerText()), 0);
    await page.getByRole('button', { name: 'Ambient traffic', exact: true }).click();
    await page.getByRole('button', { name: 'Pedestrians', exact: true }).click();
    await page.waitForTimeout(900);
    assert.equal(
      await page
        .getByRole('button', { name: 'Ambient traffic', exact: true })
        .getAttribute('class'),
      'active',
    );
    await page.getByRole('button', { name: 'Stop driving', exact: true }).click();
  });
  await check('Performance counters are recorded, not inferred', async () => {
    await page.locator('.statusbar button').click();
    const rows = await page.locator('.performance-grid>div').allTextContents();
    result.performance = rows;
    await page.getByRole('button', { name: 'Close dialog' }).click();
  });
  await check('Touch controls drive at mobile viewport', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Test drive', exact: true }).click();
    await page.waitForTimeout(900);
    const drive = page.getByRole('button', { name: 'Drive', exact: true }),
      b = await drive.boundingBox();
    await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(2500);
    await page.mouse.up();
    assert.ok(Number(await page.getByTestId('speed').innerText()) > 0);
    await page.screenshot({ path: out + '/drive-mobile.png' });
    await page.getByRole('button', { name: 'Stop driving', exact: true }).click();
  });
  assert.deepEqual(result.errors, []);
  result.passed = true;
} catch (e: any) {
  result.passed = false;
  result.failure = e.stack;
  process.exitCode = 1;
} finally {
  writeFileSync(out + '/browser-results.json', JSON.stringify(result, null, 2));
  await browser.close();
  console.log(
    JSON.stringify(
      {
        passed: result.passed,
        checks: result.checks.length,
        errors: result.errors,
        failure: result.failure,
      },
      null,
      2,
    ),
  );
}
