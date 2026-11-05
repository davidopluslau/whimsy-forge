import { expect, test, type Page } from '@playwright/test';
import { accessToken } from './access-token';

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'CF_Authorization', value: await accessToken(), url: baseURL! }]);
  await page.goto('/editor/new');
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
});

/** Maps plan meters to page pixels, reading the zoom from the canvas. The origin starts at its center. */
async function planMapper(page: Page) {
  const canvas = page.getByTestId('plan-canvas');
  const box = (await canvas.boundingBox())!;
  const scale = Number(await canvas.getAttribute('data-scale'));
  return (x: number, y: number) => ({ x: box.x + box.width / 2 + x * scale, y: box.y + box.height / 2 + y * scale });
}

async function clickPlan(page: Page, at: (x: number, y: number) => { x: number; y: number }, x: number, y: number) {
  const { x: px, y: py } = at(x, y);
  await page.mouse.move(px, py);
  await page.mouse.click(px, py);
}

async function typeLengthToward(page: Page, at: (x: number, y: number) => { x: number; y: number }, x: number, y: number, text: string) {
  const { x: px, y: py } = at(x, y);
  await page.mouse.move(px, py);
  await page.getByTestId('typed-length').fill(text);
  await page.keyboard.press('Enter');
}

async function drawTypedRoom(page: Page) {
  const at = await planMapper(page);
  await clickPlan(page, at, -2, -2.5);
  await typeLengthToward(page, at, 3, -2.5, '4');
  await typeLengthToward(page, at, 2, 3, '5');
  await typeLengthToward(page, at, -3, 2.5, '4');
  await clickPlan(page, at, -2, -2.5);
}

test('a 4 × 5 m room is drawn with typed lengths in under a minute', async ({ page }) => {
  const started = Date.now();
  await drawTypedRoom(page);
  await expect(page.getByTestId('room-status')).toHaveText('Closed room · floor 20.00 m²');
  expect(Date.now() - started).toBeLessThan(60_000);

  const dimensions = page.getByTestId('wall-dimension');
  await expect(dimensions).toHaveText(['4.00 m', '5.00 m', '4.00 m', '5.00 m']);
  await expect(page.getByTestId('plan-editor')).toHaveAttribute('data-tool', 'select');
});

test('dimensions switch between meters and feet', async ({ page }) => {
  await drawTypedRoom(page);
  await page.getByRole('button', { name: 'Feet' }).click();
  await expect(page.getByTestId('wall-dimension').first()).toHaveText(`13' 1.5"`);
  await expect(page.getByTestId('room-status')).toHaveText('Closed room · floor 215.3 ft²');
  await expect(page.getByLabel('Wall height')).toHaveValue(`8' 2.5"`);
});

test('an L-shaped room drawn by clicking gets the right floor, on the grid and snapped shut', async ({ page }) => {
  const at = await planMapper(page);
  const corners: [number, number][] = [[-2, -2], [2, -2], [2, 0], [0, 0], [0, 3], [-2, 3]];
  for (const [x, y] of corners) await clickPlan(page, at, x, y);
  await expect(page.getByTestId('room-status')).toContainText('not a closed room');

  // Slightly off the first corner: endpoint snapping has to close the room.
  await clickPlan(page, at, -2.08, -1.93);
  await expect(page.getByTestId('room-status')).toHaveText('Closed room · floor 14.00 m²');
});

test('a selected wall takes a typed length and stays rectangular, and can be deleted', async ({ page }) => {
  await drawTypedRoom(page);
  const at = await planMapper(page);

  await clickPlan(page, at, 0, -2.5);
  const length = page.getByLabel('Wall length');
  await expect(length).toHaveValue('4.00 m');
  await length.fill('6');
  await length.press('Enter');
  await expect(page.getByTestId('room-status')).toHaveText('Closed room · floor 30.00 m²');

  await page.getByRole('button', { name: 'Delete wall' }).click();
  await expect(page.getByTestId('room-status')).toContainText('3 walls');
});

test('a typed length keeps the direction last pointed at after the mouse leaves the plan', async ({ page }) => {
  const at = await planMapper(page);
  await clickPlan(page, at, 0, -2);
  const { x, y } = at(0, 2);
  await page.mouse.move(x, y);

  const input = page.getByTestId('typed-length');
  await input.click();
  await input.fill('3');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('wall-dimension')).toHaveText(['3.00 m']);
  const dimension = await page.getByTestId('wall-dimension').boundingBox();
  // The wall runs down the plan from y = -2 to y = 1, so its label is level with y = -0.5.
  // Had the direction been lost, the wall would run along +x with its label near y = -2.
  expect(Math.abs(dimension!.y + dimension!.height / 2 - at(0, -0.5).y)).toBeLessThan(5);
});

test('the plan does not shift or resize while drawing, even in a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  const canvas = page.getByTestId('plan-canvas');
  const at = await planMapper(page);
  const before = await canvas.boundingBox();

  await clickPlan(page, at, -2, -2);
  expect(await canvas.boundingBox()).toEqual(before);
  await clickPlan(page, at, 2, -2);
  await clickPlan(page, at, 2, 2);
  await expect(page.getByTestId('room-status')).toContainText('2 walls');
  expect(await canvas.boundingBox()).toEqual(before);
  await clickPlan(page, at, -2, 2);
  await clickPlan(page, at, -2, -2);
  await expect(page.getByTestId('room-status')).toContainText('Closed room');
  expect(await canvas.boundingBox()).toEqual(before);
});

test('Backspace takes back the last wall while drawing', async ({ page }) => {
  const at = await planMapper(page);
  await clickPlan(page, at, -2, -2);
  await clickPlan(page, at, 2, -2);
  await expect(page.getByTestId('room-status')).toContainText('1 wall');
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('room-status')).toHaveText('No walls yet');
});

test('the 3D view shows the room, keeps up with wall height, and the views can be toggled', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const scene = page.getByTestId('room-scene');
  const canvas = scene.locator('canvas');
  await expect(canvas).toBeVisible();
  const settled = async () => {
    let shot = await canvas.screenshot();
    await expect(async () => {
      await page.waitForTimeout(300);
      const next = await canvas.screenshot();
      const same = Buffer.compare(shot, next) === 0;
      shot = next;
      expect(same).toBe(true);
    }).toPass({ timeout: 15_000 });
    return shot;
  };
  const empty = await settled();

  await drawTypedRoom(page);
  await expect(scene).toHaveAttribute('data-wall-count', '4');
  const drawn = await settled();
  expect(Buffer.compare(empty, drawn)).not.toBe(0);

  const height = page.getByLabel('Wall height');
  await height.fill('3.5');
  await height.press('Enter');
  await expect(height).toHaveValue('3.50 m');
  expect(Buffer.compare(drawn, await settled())).not.toBe(0);

  await page.getByRole('button', { name: '3D' }).click();
  await expect(page.getByTestId('plan-canvas')).toBeHidden();
  await expect(canvas).toBeVisible();

  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  await expect(canvas).toBeHidden();
  await expect(page.getByTestId('wall-dimension')).toHaveCount(4);

  expect(errors).toEqual([]);
});
