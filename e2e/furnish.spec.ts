import { expect, test, type Page } from '@playwright/test';
import catalog from '../seed/catalog.json' with { type: 'json' };
import { accessToken } from './access-token';

type Entry = { id: string; kind: string; mount: string };

const floorModels = (catalog as Entry[]).filter((asset) => asset.kind === 'model' && asset.mount === 'floor');

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'CF_Authorization', value: await accessToken(), url: baseURL! }]);
  await page.goto('/editor/new');
  await expect(page.getByTestId('catalog')).toHaveAttribute('data-status', 'ready');
});

/** Maps plan meters to page pixels, reading the zoom from the canvas. The origin starts at its center. */
async function planMapper(page: Page) {
  const canvas = page.getByTestId('plan-canvas');
  const box = (await canvas.boundingBox())!;
  const scale = Number(await canvas.getAttribute('data-scale'));
  return (x: number, y: number) => ({ x: box.x + box.width / 2 + x * scale, y: box.y + box.height / 2 + y * scale });
}

async function drawTypedRoom(page: Page) {
  const at = await planMapper(page);
  const click = async (x: number, y: number) => {
    const point = at(x, y);
    await page.mouse.move(point.x, point.y);
    await page.mouse.click(point.x, point.y);
  };
  const typeToward = async (x: number, y: number, length: string) => {
    const point = at(x, y);
    await page.mouse.move(point.x, point.y);
    await page.getByTestId('typed-length').fill(length);
    await page.keyboard.press('Enter');
  };
  await click(-2, -2.5);
  await typeToward(3, -2.5, '4');
  await typeToward(2, 3, '5');
  await typeToward(-3, 2.5, '4');
  await click(-2, -2.5);
  await expect(page.getByTestId('room-status')).toHaveText('Closed room · floor 20.00 m²');
}

const tile = (page: Page, id: string) => page.locator(`.catalog__tile[data-asset-id="${id}"]`);

/** A small WebP photo, made in the page so the test needs no image file. */
async function photoFile(page: Page, color: string) {
  const bytes = await page.evaluate(async (fill) => {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = fill;
    context.fillRect(0, 0, 300, 200);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((made) => resolve(made!), 'image/webp'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, color);
  return { name: 'photo.webp', mimeType: 'image/webp', buffer: Buffer.from(bytes) };
}

test('furnish a room with drag and drop, hang pictures, lay a rug, then undo it all step by step', async ({ page }) => {
  test.setTimeout(120_000);
  const scene = page.getByTestId('room-scene');
  const itemCount = async () => Number(await scene.getAttribute('data-item-count'));

  await drawTypedRoom(page);
  const canvas = page.getByTestId('plan-canvas');
  const at = await planMapper(page);
  const box = (await canvas.boundingBox())!;
  const onPlan = (x: number, y: number) => {
    const point = at(x, y);
    return { x: point.x - box.x, y: point.y - box.y };
  };

  // Six items are dragged onto the plan, two onto the 3D view, and two are placed from their preview.
  const planSpots: [number, number][] = [
    [-1.2, -1.2],
    [0, -1.2],
    [1.2, -1.2],
    [-1.2, 1.2],
    [0, 1.2],
    [1.2, 1.2],
  ];
  for (const [index, [x, y]] of planSpots.entries()) {
    await tile(page, floorModels[index]!.id).dragTo(canvas, { targetPosition: onPlan(x, y) });
    await expect.poll(itemCount).toBe(index + 1);
  }
  await expect(page.locator('[data-testid="plan-item"]')).toHaveCount(6);
  for (const [index, asset] of floorModels.slice(6, 8).entries()) {
    await tile(page, asset.id).dragTo(scene.locator('canvas'));
    await expect.poll(itemCount).toBe(7 + index);
  }
  for (const asset of floorModels.slice(8, 10)) {
    await tile(page, asset.id).click();
    await page.getByRole('button', { name: 'Place in room' }).click();
  }
  await expect.poll(itemCount).toBe(10);

  // Two pictures and a rug from a photo, each at a typed width.
  await page.getByRole('radio', { name: 'Picture on a wall' }).check();
  for (const [index, color] of ['#c96d3a', '#3a7bc9'].entries()) {
    await page.getByLabel('Photo', { exact: true }).setInputFiles(await photoFile(page, color));
    await page.getByRole('button', { name: 'Add to room' }).click();
    await expect.poll(itemCount).toBe(11 + index);
  }
  await expect(scene).toHaveAttribute('data-selected-item', /.+/);

  await page.getByRole('radio', { name: 'Rug on the floor' }).check();
  await page.getByLabel('Photo', { exact: true }).setInputFiles(await photoFile(page, '#7a9a4a'));
  await page.getByRole('button', { name: 'Add to room' }).click();
  await expect.poll(itemCount).toBe(13);

  // Every placement is one undo step, so undoing thirteen times empties the room one item at a time.
  for (let remaining = 12; remaining >= 0; remaining--) {
    await page.keyboard.press('Control+z');
    await expect.poll(itemCount).toBe(remaining);
  }
  await expect(page.getByTestId('room-status')).toHaveText('Closed room · floor 20.00 m²');

  await page.keyboard.press('Control+Shift+z');
  await expect.poll(itemCount).toBe(1);
});

test('a dropped item is selected, so it can be turned and removed from the keyboard', async ({ page }) => {
  const scene = page.getByTestId('room-scene');
  await drawTypedRoom(page);
  await tile(page, floorModels[0]!.id).dragTo(page.getByTestId('plan-canvas'), { targetPosition: { x: 120, y: 120 } });
  await expect(scene).toHaveAttribute('data-item-count', '1');

  await page.keyboard.press('r');
  await page.keyboard.press('Delete');
  await expect(scene).toHaveAttribute('data-item-count', '0');
  await page.keyboard.press('Control+z');
  await expect(scene).toHaveAttribute('data-item-count', '1');
});
