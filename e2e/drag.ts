import type { Page } from '@playwright/test';

/** Drags across the canvas with touch on a phone and with the mouse on desktop. */
export async function dragAcross(page: Page, isMobile: boolean) {
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
