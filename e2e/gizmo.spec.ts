import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import catalog from '../seed/catalog.json' with { type: 'json' };
import { accessToken } from './access-token';

type Entry = { id: string; kind: string; mount: string };
type Rgb = [number, number, number];

const floorModel = (catalog as Entry[]).find((asset) => asset.kind === 'model' && asset.mount === 'floor')!;

/** three.js draws the gizmo in pure colors: x red, y green, z blue. */
const RED = (r: number, g: number, b: number) => r > 200 && g < 60 && b < 60;
const GREEN = (r: number, g: number, b: number) => g > 200 && r < 60 && b < 60;
const BLUE = (r: number, g: number, b: number) => b > 200 && r < 60 && g < 60;

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'CF_Authorization', value: await accessToken(), url: baseURL! }]);
  await page.goto('/editor/new');
  await expect(page.getByTestId('catalog')).toHaveAttribute('data-status', 'ready');

  const canvas = page.getByTestId('plan-canvas');
  const box = (await canvas.boundingBox())!;
  const scale = Number(await canvas.getAttribute('data-scale'));
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
});

/** The page position of a pixel on the gizmo part with this color, or null if none is drawn. */
async function findColor(page: Page, matches: (...rgb: Rgb) => boolean) {
  const canvas = page.getByTestId('room-scene').locator('canvas');
  const box = (await canvas.boundingBox())!;
  const { data, info } = await sharp(await canvas.screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const found: { x: number; y: number }[] = [];
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const at = (y * info.width + x) * info.channels;
      if (matches(data[at]!, data[at + 1]!, data[at + 2]!)) found.push({ x: box.x + x, y: box.y + y });
    }
  }
  return found[Math.floor(found.length / 2)] ?? null;
}

async function waitForColor(page: Page, matches: (...rgb: Rgb) => boolean) {
  await expect.poll(async () => (await findColor(page, matches)) !== null, { timeout: 20_000 }).toBe(true);
  return (await findColor(page, matches))!;
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
}

const planItem = (page: Page) => page.getByTestId('plan-item').first();
const corners = async (page: Page) => (await planItem(page).getAttribute('points'))!.split(' ').map((point) => point.split(',').map(Number) as [number, number]);

async function dropItem(page: Page) {
  const canvas = page.getByTestId('plan-canvas');
  const box = (await canvas.boundingBox())!;
  await page.locator(`.catalog__tile[data-asset-id="${floorModel.id}"]`).dragTo(canvas, { targetPosition: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.getByTestId('room-scene')).toHaveAttribute('data-item-count', '1');
}

test('the move gizmo appears on a selected item, drags it with the mouse, and is one undo step', async ({ page }) => {
  await dropItem(page);
  const before = await planItem(page).getAttribute('points');

  await drag(page, await waitForColor(page, RED), 80, 0);
  await expect.poll(() => planItem(page).getAttribute('points')).not.toBe(before);
  await expect(page.getByTestId('room-scene')).toHaveAttribute('data-selected-item', /.+/);

  await page.keyboard.press('Control+z');
  await expect.poll(() => planItem(page).getAttribute('points')).toBe(before);
});

test('the rotate gizmo turns a selected item with the mouse', async ({ page }) => {
  await dropItem(page);
  const before = await planItem(page).getAttribute('points');

  await page.getByRole('button', { name: 'Rotate' }).click();
  await drag(page, await waitForColor(page, GREEN), 40, 40);
  await expect.poll(() => planItem(page).getAttribute('points')).not.toBe(before);
});

test('the move gizmo slides a picture along its wall and keeps it flush', async ({ page }) => {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#888888';
    context.fillRect(0, 0, 300, 200);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((made) => resolve(made!), 'image/webp'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByLabel('Photo', { exact: true }).setInputFiles({ name: 'photo.webp', mimeType: 'image/webp', buffer: Buffer.from(bytes) });
  await page.getByRole('button', { name: 'Add to room' }).click();
  await expect(page.getByTestId('room-scene')).toHaveAttribute('data-item-count', '1');
  const before = await corners(page);

  // The room's longest walls run along the plan's y axis, which is the gizmo's blue z arrow.
  await drag(page, await waitForColor(page, BLUE), 0, 60);
  await expect.poll(async () => (await corners(page))[0]![1]).not.toBeCloseTo(before[0]![1], 1);
  expect((await corners(page))[0]![0]).toBeCloseTo(before[0]![0], 3);
});
