// TEMPORARY diagnostic for the CI gizmo failure. Not to be merged.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import catalog from '../seed/catalog.json' with { type: 'json' };
import { accessToken } from './access-token';

type Entry = { id: string; kind: string; mount: string };
const floorModel = (catalog as Entry[]).find((asset) => asset.kind === 'model' && asset.mount === 'floor')!;

test('diag: gizmo pixels and idle draw calls', async ({ page, context, baseURL }, info) => {
  test.setTimeout(180_000);
  test.skip(info.project.name !== 'desktop');
  const log = (...parts: unknown[]) => console.log('[diag]', ...parts);
  const started = Date.now();
  const lap = (label: string) => log(label, `${Date.now() - started}ms`);

  await page.addInitScript(() => {
    const counts = { draws: 0 };
    (window as unknown as { __diag: typeof counts }).__diag = counts;
    for (const proto of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype]) {
      for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'] as const) {
        const original = (proto as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
        if (!original) continue;
        (proto as unknown as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]) {
          counts.draws++;
          return original.apply(this, args);
        };
      }
    }
  });
  const draws = () => page.evaluate(() => (window as unknown as { __diag: { draws: number } }).__diag.draws);

  await context.addCookies([{ name: 'CF_Authorization', value: await accessToken(), url: baseURL! }]);
  await page.goto('/editor');
  await expect(page.getByTestId('catalog')).toHaveAttribute('data-status', 'ready');
  lap('editor ready');

  const plan = page.getByTestId('plan-canvas');
  const box = (await plan.boundingBox())!;
  const scale = Number(await plan.getAttribute('data-scale'));
  const at = (x: number, y: number) => ({ x: box.x + box.width / 2 + x * scale, y: box.y + box.height / 2 + y * scale });
  const click = async (x: number, y: number) => {
    await page.mouse.move(at(x, y).x, at(x, y).y);
    await page.mouse.click(at(x, y).x, at(x, y).y);
  };
  const typeToward = async (x: number, y: number, length: string) => {
    await page.mouse.move(at(x, y).x, at(x, y).y);
    await page.getByTestId('typed-length').fill(length);
    await page.keyboard.press('Enter');
  };
  await click(-2, -2.5);
  await typeToward(3, -2.5, '4');
  await typeToward(2, 3, '5');
  await typeToward(-3, 2.5, '4');
  await click(-2, -2.5);
  await expect(page.getByTestId('room-status')).toHaveText('Closed room · floor 20.00 m²');
  lap('room drawn');

  await page.locator(`.catalog__tile[data-asset-id="${floorModel.id}"]`).dragTo(plan, { targetPosition: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.getByTestId('room-scene')).toHaveAttribute('data-item-count', '1');
  lap('item dropped');

  const idle = async (label: string) => {
    const before = await draws();
    await page.waitForTimeout(5_000);
    log(label, 'draw calls during 5s idle:', (await draws()) - before);
  };
  await idle('after drop');

  await page.getByRole('button', { name: 'Rotate' }).click();
  lap('rotate clicked');

  const canvas = page.getByTestId('room-scene').locator('canvas');
  const dir = 'test-results/diag';
  mkdirSync(dir, { recursive: true });
  for (let sample = 0; sample < 4; sample++) {
    const shotStart = Date.now();
    const shot = await canvas.screenshot();
    const shotMs = Date.now() - shotStart;
    writeFileSync(`${dir}/rotate-${sample}.png`, shot);
    const { data, info: image } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let strict = 0;
    let loose = 0;
    let peakExcess = -999;
    for (let i = 0; i < data.length; i += image.channels) {
      const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
      if (g > 200 && r < 60 && b < 60) strict++;
      const excess = g - Math.max(r, b);
      if (excess > 60) loose++;
      if (excess > peakExcess) peakExcess = excess;
    }
    log(`sample ${sample}`, { size: `${image.width}x${image.height}`, shotMs, strict, loose, peakExcess });
    await page.waitForTimeout(3_000);
  }
  await idle('after rotate');
  lap('done');
});
