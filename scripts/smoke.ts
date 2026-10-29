import { chromium } from 'playwright';
import assert from 'node:assert/strict';
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.STUDIO_URL || 'http://127.0.0.1:5173');
  await page.getByText('World ready', { exact: true }).waitFor();
  assert.equal(await page.locator('.object-row').count(), 16);
  await page.getByRole('button', { name: 'Test drive', exact: true }).click();
  await page.getByText('FREE DRIVE · NO ASSESSMENT').waitFor();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1800);
  await page.keyboard.up('KeyW');
  assert.ok(Number(await page.getByTestId('speed').innerText()) > 0);
  assert.deepEqual(errors, []);
  console.log(
    'Smoke passed: offline Cambridge compiled, viewport rendered, original SlayDrive physics accelerated.',
  );
} finally {
  await browser.close();
}
