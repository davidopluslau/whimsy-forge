import { expect, test, type Locator, type Page } from '@playwright/test';
import { accessToken } from './access-token';

const SCREENSHOTS = process.env.E2E_SCREENSHOT_DIR;

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'CF_Authorization', value: await accessToken(), url: baseURL! }]);
  await page.goto('/editor');
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
});

type At = (x: number, y: number) => { x: number; y: number };

async function planMapper(page: Page): Promise<At> {
  const canvas = page.getByTestId('plan-canvas');
  const box = (await canvas.boundingBox())!;
  const scale = Number(await canvas.getAttribute('data-scale'));
  return (x, y) => ({ x: box.x + box.width / 2 + x * scale, y: box.y + box.height / 2 + y * scale });
}

async function clickPlan(page: Page, at: At, x: number, y: number) {
  const { x: px, y: py } = at(x, y);
  await page.mouse.move(px, py);
  await page.mouse.click(px, py);
}

async function dragPlan(page: Page, at: At, from: [number, number], to: [number, number]) {
  const start = at(...from);
  const end = at(...to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
}

/** A 4 × 5 m room centered on the plan. The top wall runs along y = -2.5 from x = -2 to x = 2. */
async function drawRoom(page: Page, at: At) {
  for (const [x, y] of [[-2, -2.5], [2, -2.5], [2, 2.5], [-2, 2.5], [-2, -2.5]] as const) await clickPlan(page, at, x, y);
  await expect(page.getByTestId('room-status')).toHaveText('Closed room · floor 20.00 m²');
}

async function addOpening(page: Page, at: At, kind: 'door' | 'window', x: number, y: number) {
  await page.getByRole('button', { name: `Add ${kind}` }).click();
  await clickPlan(page, at, x, y);
  await expect(page.getByTestId('opening-fields')).toBeVisible();
}

async function typeInto(field: Locator, value: string) {
  await field.fill(value);
  await field.press('Enter');
}

async function settled(page: Page, canvas: Locator) {
  let shot = await canvas.screenshot();
  await expect(async () => {
    await page.waitForTimeout(300);
    const next = await canvas.screenshot();
    const same = Buffer.compare(shot, next) === 0;
    shot = next;
    expect(same).toBe(true);
  }).toPass({ timeout: 20_000 });
  return shot;
}

/** Orbits the 3D view by dragging, which is what a user does to look at the room from the other side. */
async function orbit(page: Page, canvas: Locator, dx: number, dy: number) {
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

type Rgba = { width: number; height: number; data: number[] };

async function decode(page: Page, png: Buffer): Promise<Rgba> {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, data: [...context.getImageData(0, 0, image.width, image.height).data] };
  }, png.toString('base64'));
}

/** Indices of the pixels that visibly differ between two screenshots. */
function changedPixels(a: Rgba, b: Rgba): Set<number> {
  const changed = new Set<number>();
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i]! - b.data[i]!) + Math.abs(a.data[i + 1]! - b.data[i + 1]!) + Math.abs(a.data[i + 2]! - b.data[i + 2]!) > 12) changed.add(i / 4);
  }
  return changed;
}

function shared(a: Set<number>, b: Set<number>) {
  let count = 0;
  for (const pixel of a) if (b.has(pixel)) count++;
  return count;
}

test('a door and a window are added on a wall, then moved and resized in the plan', async ({ page }) => {
  const at = await planMapper(page);
  await drawRoom(page, at);

  await addOpening(page, at, 'door', -1, -2.5);
  const offset = page.getByLabel('Offset');
  const width = page.getByLabel('Width');
  const height = page.getByLabel('Height', { exact: true });
  await expect(offset).toHaveValue('0.55 m');
  await expect(width).toHaveValue('0.90 m');
  await expect(height).toHaveValue('2.10 m');
  await expect(page.getByLabel('Sill')).toHaveCount(0);
  await expect(page.getByTestId('plan-editor')).toHaveAttribute('data-tool', 'select');

  // Dragging the door along its wall: half a meter, then onto the 10 cm grid.
  await dragPlan(page, at, [-1, -2.56], [-0.5, -2.56]);
  await expect(offset).toHaveValue('1.10 m');

  // Dragging the far handle out resizes it, leaving the near edge alone.
  await dragPlan(page, at, [0, -2.56], [0.4, -2.56]);
  await expect(offset).toHaveValue('1.10 m');
  await expect(width).toHaveValue('1.30 m');

  await addOpening(page, at, 'window', 1.2, -2.5);
  await expect(page.getByLabel('Sill')).toHaveValue('0.90 m');
  await expect(page.getByTestId('plan-opening')).toHaveCount(2);
  await expect(page.getByTestId('room-scene')).toHaveAttribute('data-opening-count', '2');

  // Typed values, in a different unit.
  await page.getByRole('button', { name: 'Feet' }).click();
  await typeInto(page.getByLabel('Sill'), `3'`);
  await page.getByRole('button', { name: 'Meters' }).click();
  await expect(page.getByLabel('Sill')).toHaveValue('0.91 m');

  // Clicking selects; Delete removes the selected opening, not the wall under it.
  await clickPlan(page, at, 0, -2.56);
  await expect(height).toHaveValue('2.10 m');
  await expect(page.getByLabel('Sill')).toHaveCount(0);
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('plan-opening')).toHaveCount(1);
  await expect(page.getByTestId('room-status')).toContainText('Closed room');
});

test('an opening cannot go past its wall or above the wall height', async ({ page }) => {
  const at = await planMapper(page);
  await drawRoom(page, at);
  await addOpening(page, at, 'door', 0, -2.5);
  const offset = page.getByLabel('Offset');
  const width = page.getByLabel('Width');
  const height = page.getByLabel('Height', { exact: true });

  // Dragging far beyond the wall's end stops at the end.
  await dragPlan(page, at, [0, -2.56], [6, -2.56]);
  await expect(offset).toHaveValue('3.10 m');
  await expect(page.getByTestId('opening-gap')).toHaveCount(1);

  // And the other way.
  await dragPlan(page, at, [1.5, -2.56], [-6, -2.56]);
  await expect(offset).toHaveValue('0.00 m');

  // The far handle stops at the wall's end too.
  await dragPlan(page, at, [-1.1, -2.56], [8, -2.56]);
  await expect(width).toHaveValue('4.00 m');
  await typeInto(width, '0.9');

  // Typed values past the limits are refused, flagged, and change nothing.
  await typeInto(offset, '3.5');
  await expect(offset).toHaveAttribute('aria-invalid', 'true');
  await typeInto(offset, '1');
  await expect(offset).toHaveAttribute('aria-invalid', 'false');

  await typeInto(height, '2.6');
  await expect(height).toHaveAttribute('aria-invalid', 'true');
  await typeInto(height, '2.1');
  await expect(height).toHaveAttribute('aria-invalid', 'false');

  // So are wall edits that would leave the door behind.
  const wallHeight = page.getByLabel('Wall height');
  await typeInto(wallHeight, '2');
  await expect(wallHeight).toHaveAttribute('aria-invalid', 'true');
  await typeInto(wallHeight, '2.5');
  await expect(wallHeight).toHaveAttribute('aria-invalid', 'false');

  await page.keyboard.press('Escape');
  await clickPlan(page, at, -1.7, -2.5);
  const length = page.getByLabel('Wall length');
  await typeInto(length, '0.5');
  await expect(length).toHaveAttribute('aria-invalid', 'true');
});

test('a door and a window show as holes in 3D, from both sides of the wall', async ({ page }) => {
  test.setTimeout(180_000); // Software WebGL makes every settled screenshot slow.
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const multipleThree: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Multiple instances of Three.js')) multipleThree.push(message.text());
  });

  const at = await planMapper(page);
  await drawRoom(page, at);
  const canvas = page.getByTestId('room-scene').locator('canvas');

  // The default camera looks at the inner face of the top plan wall. This drag takes it round about
  // 145°, to the far side of that wall, looking at its outer face.
  const toOutside = -270;

  const insideView = await settled(page, canvas);
  await orbit(page, canvas, toOutside, 0);
  const outsideView = await settled(page, canvas);
  await orbit(page, canvas, -toOutside, 0);
  await settled(page, canvas);

  await addOpening(page, at, 'door', -1, -2.5);
  await addOpening(page, at, 'window', 1, -2.5);

  const insideCut = await settled(page, canvas);
  expect(Buffer.compare(insideView, insideCut)).not.toBe(0);
  if (SCREENSHOTS) await canvas.screenshot({ path: `${SCREENSHOTS}/holes-inside.png` });

  await orbit(page, canvas, toOutside, 0);
  const outsideCut = await settled(page, canvas);
  expect(Buffer.compare(outsideView, outsideCut)).not.toBe(0);
  if (SCREENSHOTS) await canvas.screenshot({ path: `${SCREENSHOTS}/holes-outside.png` });

  if (SCREENSHOTS) await page.screenshot({ path: `${SCREENSHOTS}/editor.png` });

  // A textured wall keeps its holes.
  await orbit(page, canvas, -toOutside, 0);
  await settled(page, canvas);
  await page.keyboard.press('Escape');
  await clickPlan(page, at, 0, -2.5);
  await page.getByLabel('Wall material').selectOption({ label: 'Red brick' });
  await settled(page, canvas);
  if (SCREENSHOTS) await canvas.screenshot({ path: `${SCREENSHOTS}/holes-brick.png` });

  expect(errors).toEqual([]);
  expect(multipleThree).toEqual([]);
});

test('changing a wall material changes only that wall, and the floor only the floor', async ({ page }) => {
  test.setTimeout(180_000); // Software WebGL makes every settled screenshot slow.
  const responses: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/assets/') && !response.ok()) responses.push(`${response.status()} ${response.url()}`);
  });

  const at = await planMapper(page);
  await drawRoom(page, at);
  const canvas = page.getByTestId('room-scene').locator('canvas');
  const before = await decode(page, await settled(page, canvas));

  // The wall along the top of the plan, facing the default camera.
  await clickPlan(page, at, 0, -2.5);
  await page.getByLabel('Wall material').selectOption({ label: 'Red brick' });
  const afterFirst = await decode(page, await settled(page, canvas));
  const firstWall = changedPixels(before, afterFirst);
  expect(firstWall.size).toBeGreaterThan(500);

  // The wall down the left of the plan, also in view.
  await clickPlan(page, at, -2, 0);
  await page.getByLabel('Wall material').selectOption({ label: 'Painted plaster' });
  const afterSecond = await decode(page, await settled(page, canvas));
  const secondWall = changedPixels(afterFirst, afterSecond);
  expect(secondWall.size).toBeGreaterThan(500);

  // A wall's pixels are its own: anything the second change touched is outside the first wall.
  // A few shared pixels are allowed for antialiasing where the two walls meet at the corner.
  expect(shared(firstWall, secondWall)).toBeLessThan(0.01 * Math.min(firstWall.size, secondWall.size));

  await page.keyboard.press('Escape');
  await page.getByLabel('Floor material').selectOption({ label: 'Herringbone parquet' });
  const afterFloor = await decode(page, await settled(page, canvas));
  const floor = changedPixels(afterSecond, afterFloor);
  expect(floor.size).toBeGreaterThan(500);
  expect(shared(floor, firstWall)).toBeLessThan(0.01 * Math.min(floor.size, firstWall.size));
  expect(shared(floor, secondWall)).toBeLessThan(0.01 * Math.min(floor.size, secondWall.size));

  // Back to plain restores that wall's look alone.
  await clickPlan(page, at, 0, -2.5);
  await expect(page.getByLabel('Wall material')).toHaveValue('red-brick');
  await page.getByLabel('Wall material').selectOption({ label: 'Plain' });
  const afterPlain = await decode(page, await settled(page, canvas));
  expect(shared(changedPixels(afterFloor, afterPlain), secondWall)).toBeLessThan(0.01 * secondWall.size);

  expect(responses).toEqual([]);
  if (SCREENSHOTS) await canvas.screenshot({ path: `${SCREENSHOTS}/materials.png` });
});

test('material textures are served with an image type', async ({ request }) => {
  const response = await request.get('/api/assets/red-brick/color.webp');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toBe('image/webp');
});
