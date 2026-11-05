import { expect, test, type Page } from '@playwright/test';

async function openChair(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('chair-page')).toHaveAttribute('data-scene-state', 'ready', { timeout: 30_000 });
  return errors;
}

/** Drags across the canvas with touch on a phone and with the mouse on desktop. */
async function dragAcross(page: Page, isMobile: boolean) {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('Canvas has no size');
  const y = box.y + box.height / 2;
  const startX = box.x + box.width * 0.3;
  const endX = box.x + box.width * 0.7;
  const steps = 8;
  const xAt = (step: number) => startX + ((endX - startX) * step) / steps;

  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, x?: number) =>
      cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: x === undefined ? [] : [{ x, y }] });
    await touch('touchStart', startX);
    for (let step = 1; step <= steps; step++) await touch('touchMove', xAt(step));
    await touch('touchEnd');
  } else {
    await page.mouse.move(startX, y);
    await page.mouse.down();
    for (let step = 1; step <= steps; step++) await page.mouse.move(xAt(step), y);
    await page.mouse.up();
  }
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
