import { expect, test, type Page } from '@playwright/test';
import { dragAcross } from './drag';

async function openChair(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('chair-page')).toHaveAttribute('data-scene-state', 'ready', { timeout: 30_000 });
  return errors;
}

test('shows the chair loaded from R2 and it can be orbited', async ({ page, isMobile }) => {
  const glb = page.waitForResponse((response) => response.url().endsWith('/api/assets/painted-wooden-chair-01/model.glb'));
  const errors = await openChair(page);

  const response = await glb;
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('model/gltf-binary');

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(async () => {
    const before = await canvas.screenshot();
    await page.waitForTimeout(300);
    expect(Buffer.compare(before, await canvas.screenshot())).toBe(0);
  }).toPass({ timeout: 15_000 });
  const before = await canvas.screenshot();

  await dragAcross(page, isMobile);

  const root = page.getByTestId('chair-page');
  await expect(root).toHaveAttribute('data-camera', /.+/);
  await expect(async () => {
    expect(Buffer.compare(before, await canvas.screenshot())).not.toBe(0);
  }).toPass({ timeout: 10_000 });
  expect(errors).toEqual([]);
});

test('fits the screen without page scrolling', async ({ page }) => {
  await openChair(page);
  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
  expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth);
  expect(size.scrollHeight).toBeLessThanOrEqual(size.clientHeight);

  const canvasBox = await page.locator('canvas').boundingBox();
  expect(canvasBox?.width).toBeGreaterThanOrEqual(size.clientWidth - 1);
});
