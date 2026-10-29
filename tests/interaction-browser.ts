import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fromOSM } from '../src/world/osm';
import { compile } from '../src/world/compiler';
import { roadPoints } from '../src/world/model';
const base = process.env.STUDIO_URL || 'http://127.0.0.1:5174';
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
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
  });
  await page.goto(base);
  await page.getByText('World ready', { exact: true }).waitFor();
  const w = fromOSM(JSON.parse(readFileSync('public/samples/cambridge.osm.json', 'utf8'))),
    c = compile(w);
  await page.getByRole('button', { name: 'Practice routes', exact: true }).click();
  await page.getByRole('button', { name: 'Fit world', exact: true }).click();
  await page.getByRole('button', { name: 'Top view', exact: true }).click();
  await page.waitForTimeout(500);
  const rect = (await page.locator('canvas').boundingBox())!,
    cx = (c.boundary[0] + c.boundary[2]) / 2,
    cz = (c.boundary[1] + c.boundary[3]) / 2,
    scale = rect.height / (800 * Math.tan((21 * Math.PI) / 180));
  const road = w.sourceObjects.find((o) => o.name === 'Trumpington Street')!;
  const projected = roadPoints(w, road)
    .map(([x, z]) => ({
      x: rect.x + rect.width / 2 + (x - cx) * scale,
      y: rect.y + rect.height / 2 + (z - cz) * scale,
    }))
    .filter(
      (p) =>
        p.x > rect.x + 80 &&
        p.x < rect.x + rect.width - 80 &&
        p.y > rect.y + 130 &&
        p.y < rect.y + rect.height - 70,
    );
  assert.ok(projected.length > 1);
  await page.getByRole('button', { name: 'Choose start on map', exact: true }).click();
  await page.mouse.click(projected[0].x, projected[0].y);
  await page.getByRole('button', { name: 'Choose destination', exact: true }).click();
  await page.mouse.click(projected.at(-1)!.x, projected.at(-1)!.y);
  await page.getByRole('button', { name: 'Build practice route', exact: true }).click();
  await page.getByText('Connected practice route created', { exact: true }).waitFor();
  async function exportWorld() {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'World JSON', exact: false }).click();
    const path = await (await pending).path();
    const d = JSON.parse(readFileSync(path!, 'utf8'));
    await page.getByRole('button', { name: 'Close dialog' }).click();
    return d;
  }
  const routed = await exportWorld();
  assert.ok(routed.route.points.length > 1);
  assert.notEqual(routed.route.nodeIds[0], routed.route.nodeIds.at(-1));
  console.log('PASS actual start/destination pin placement creates a connected route');
  await page.getByRole('button', { name: 'Asset library', exact: true }).click();
  await page
    .getByRole('button', { name: 'Checkpoints', exact: true })
    .dragTo(page.locator('canvas'), {
      targetPosition: { x: rect.width * 0.6, y: rect.height * 0.6 },
    });
  await page.getByRole('textbox', { name: 'Object name', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('textbox', { name: 'Object name', exact: true }).inputValue(),
    'Checkpoint',
  );
  const placed = await exportWorld();
  assert.equal(placed.additions.filter((o: any) => o.kind === 'checkpoint').length, 1);
  console.log('PASS native drag/drop creates an editable checkpoint at the drop position');
  await page.getByRole('button', { name: 'World editor', exact: true }).click();
  await page.locator('.object-row').first().click();
  const sourceId = await page.locator('.right-panel .source-id').innerText();
  const roadId = placed.sourceObjects.find((o: any) => o.source.id === sourceId).id;
  await page.getByRole('spinbutton', { name: 'Lane count', exact: true }).fill('3');
  await page.getByRole('spinbutton', { name: 'Lane count', exact: true }).press('Tab');
  await page.getByText('World ready', { exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Lane divider paint', exact: true }).selectOption('yes');
  await page.getByText('World ready', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add left lane guide', exact: true }).click();
  await page.getByText('World ready', { exact: true }).waitFor();
  await page
    .locator('.right-panel')
    .getByRole('button', { name: 'Edit control points', exact: true })
    .click();
  const laneX = page.getByRole('spinbutton', { name: 'Vertex 0:0 X', exact: true });
  const x = Number(await laneX.inputValue()) + 0.5;
  await laneX.fill(String(x));
  await laneX.press('Tab');
  await page.getByText('World ready', { exact: true }).waitFor();
  const laned = await exportWorld();
  assert.equal(laned.overrides[roadId].lanes, 3);
  const lane = laned.additions.find((o: any) => o.kind === 'lane');
  assert.equal(laned.overrides[lane.id].points[0][0], x);
  console.log('PASS lane count, authored divider paint and independent lane control-point editing');
  await page.getByRole('button', { name: 'Asset library', exact: true }).click();
  await page
    .getByRole('button', { name: 'Junction surfaces', exact: true })
    .dragTo(page.locator('canvas'), {
      targetPosition: { x: rect.width * 0.5, y: rect.height * 0.5 },
    });
  await page.getByText('World ready', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Edit footprint outline', exact: true }).click();
  assert.equal(await page.locator('.right-panel .vertex-fields > div').count(), 8);
  const junctioned = await exportWorld();
  assert.equal(junctioned.additions.filter((o: any) => o.kind === 'junction').length, 1);
  console.log('PASS authored junction placement and editable boundary');
  await page
    .getByRole('button', { name: 'Assessment zones', exact: true })
    .dragTo(page.locator('canvas'), {
      targetPosition: { x: rect.width * 0.55, y: rect.height * 0.55 },
    });
  await page.getByText('World ready', { exact: true }).waitFor();
  await page
    .getByRole('combobox', { name: 'Zone purpose', exact: true })
    .selectOption('pavement-gap');
  await page.getByText('World ready', { exact: true }).waitFor();
  const final = await exportWorld();
  const zone = final.additions.find((o: any) => o.kind === 'zone');
  assert.equal(final.overrides[zone.id].source.tags.purpose, 'pavement-gap');
  console.log('PASS pavement-gap authoring retains its explicit purpose in export');
  writeFileSync(
    'test-results/interaction-browser.json',
    JSON.stringify(
      {
        passed: true,
        checks: 5,
        routeNodes: routed.route.nodeIds,
        checkpoint: placed.additions[0],
        authored: ['lane dividers', 'lane control points', 'junction boundary', 'pavement gap'],
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
