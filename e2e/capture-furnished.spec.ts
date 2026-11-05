import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { storeFurnishedSnapshot } from './furnished-room';

const MEASURE = process.env.E2E_MEASURE;

const OUTPUT = process.env.E2E_CAPTURE_DIR;
const LABEL = process.env.E2E_CAPTURE_LABEL ?? 'shot';

/**
 * What each quality tier costs at a phone's size and pixel ratio, drawing every frame from the opening view.
 * Software rendering is far slower than a phone's GPU, so read these against each other, not as a phone's
 * frame rate. It takes no part in a normal run.
 * E2E_MEASURE=1 npx playwright test capture-furnished --project=phone --workers=1
 */
test('measure each quality tier', async ({ page, request }) => {
  test.skip(!MEASURE, 'Set E2E_MEASURE to measure.');
  test.setTimeout(300_000);
  const id = await storeFurnishedSnapshot(request);
  for (const tier of ['high', 'medium', 'low', 'minimal']) {
    await page.goto(`/v/${id}?stats&quality=${tier}`);
    const panel = page.getByTestId('viewer-stats');
    await expect(panel).toHaveAttribute('data-fps', /\d+/, { timeout: 60_000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    const fps: number[] = [];
    for (let sample = 0; sample < 8; sample++) {
      await page.waitForTimeout(600);
      fps.push(Number(await panel.getAttribute('data-fps')));
    }
    const read = (name: string) => panel.getAttribute(`data-${name}`);
    console.log(tier, 'fps', fps.join(' '), 'draws', await read('draw-calls'), 'tris', await read('triangles'), 'texture MB', await read('texture-mb'), 'pixels', await read('pixels'));
  }
});

/**
 * Pictures of the furnished room, for comparing lighting by eye. It takes no part in a normal run.
 * E2E_CAPTURE_DIR=<dir> E2E_CAPTURE_LABEL=after npx playwright test capture-furnished --project=desktop
 */
test('capture the furnished room', async ({ page, request }) => {
  test.skip(!OUTPUT, 'Set E2E_CAPTURE_DIR to take pictures.');
  test.setTimeout(180_000);
  mkdirSync(OUTPUT!, { recursive: true });

  await page.setViewportSize({ width: 1280, height: 720 });
  const id = await storeFurnishedSnapshot(request);
  await page.goto(`/v/${id}`);
  const viewer = page.getByTestId('snapshot-viewer');
  await expect(viewer).toHaveAttribute('data-catalog', 'ready');
  const canvas = page.locator('canvas');

  const settle = async () => {
    await expect(async () => {
      const before = await canvas.screenshot();
      await page.waitForTimeout(1500);
      expect(Buffer.compare(before, await canvas.screenshot())).toBe(0);
    }).toPass({ timeout: 120_000 });
  };

  for (const view of ['Overview', 'Eye level']) {
    await page.getByRole('button', { name: view }).click();
    await settle();
    await canvas.screenshot({ path: join(OUTPUT!, `${LABEL}-${view.toLowerCase().replace(' ', '-')}.png`) });
  }
});
