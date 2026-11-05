import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import sharp from 'sharp';
import { accessToken, randomDesignId } from './access-token';
import { dragAcross } from './drag';

const CHAIR = 'painted-wooden-chair-01';
const SNAPSHOT_LINK = /\/v\/([A-Za-z0-9_-]{22})$/;
const PNG_SIGNATURE = '89504e470d0a1a0a';

const roomDocument = (id: string, name = 'Living room') => ({
  schemaVersion: 1,
  id,
  name,
  updatedAt: '2026-11-05T12:00:00.000Z',
  room: {
    wallHeight: 2.5,
    walls: [
      { id: 'n', start: [-2, -2.5], end: [2, -2.5], thickness: 0.1 },
      { id: 'e', start: [2, -2.5], end: [2, 2.5], thickness: 0.1 },
      { id: 's', start: [2, 2.5], end: [-2, 2.5], thickness: 0.1 },
      { id: 'w', start: [-2, 2.5], end: [-2, -2.5], thickness: 0.1 },
    ],
    openings: [],
  },
  items: [{ id: 'chair', assetId: CHAIR, position: [0, 0, 0], rotationY: 0, size: [0.5, 0.9, 0.5], mount: 'floor' }],
  cameras: [],
});

const owner = async () => ({ 'Cf-Access-Jwt-Assertion': await accessToken() });

/** A design in storage, as the editor would have left it. */
async function storeDesign(request: APIRequestContext, name?: string): Promise<string> {
  const id = randomDesignId();
  const response = await request.put(`/api/designs/${id}`, { data: JSON.stringify(roomDocument(id, name)), headers: { 'Content-Type': 'application/json', ...(await owner()) } });
  expect(response.status()).toBe(204);
  return id;
}

/** A snapshot in storage, so the viewer tests need no editor and no sign-in in their browser. */
async function storeSnapshot(request: APIRequestContext, name?: string): Promise<string> {
  const id = randomDesignId();
  const response = await request.put(`/api/snapshots/${id}`, { data: JSON.stringify(roomDocument(id, name)), headers: { 'Content-Type': 'application/json', ...(await owner()) } });
  expect(response.status()).toBe(201);
  return id;
}

/** Waits until the canvas stops changing: the scene and its assets have arrived. */
async function settled(canvas: Locator): Promise<Buffer> {
  let image: Buffer = Buffer.alloc(0);
  await expect(async () => {
    const before = await canvas.screenshot();
    await canvas.page().waitForTimeout(400);
    image = await canvas.screenshot();
    expect(Buffer.compare(before, image)).toBe(0);
  }).toPass({ timeout: 30_000 });
  return image;
}

async function openViewer(page: Page, id: string) {
  await page.goto(`/v/${id}`);
  await expect(page.getByTestId('snapshot-viewer')).toHaveAttribute('data-catalog', 'ready');
  return page.locator('canvas');
}

async function downloadedBytes(page: Page, click: () => Promise<void>) {
  const download = page.waitForEvent('download');
  await click();
  const file = await download;
  return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) };
}

/** Whether an image has real content, rather than one flat color. */
async function hasContent(image: Buffer) {
  const stats = await sharp(image).stats();
  return stats.channels.slice(0, 3).some((channel) => channel.stdev > 4);
}

/** The share of pixels that visibly differ between two images of the same size. */
async function changedShare(a: Buffer, b: Buffer) {
  const [first, second] = await Promise.all([a, b].map((image) => sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
  let changed = 0;
  for (let i = 0; i < first!.data.length; i += 3) {
    if (Math.abs(first!.data[i]! - second!.data[i]!) + Math.abs(first!.data[i + 1]! - second!.data[i + 1]!) + Math.abs(first!.data[i + 2]! - second!.data[i + 2]!) > 30) changed++;
  }
  return changed / (first!.info.width * first!.info.height);
}

/** three.js draws the gizmo's move arrows in pure red and blue. */
async function hasGizmoColors(image: Buffer) {
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
    if ((r > 200 && g < 60 && b < 60) || (b > 200 && r < 60 && g < 60)) return true;
  }
  return false;
}

test.describe('sharing from the editor', () => {
  test.skip(({ isMobile }) => isMobile, 'The editor is for desktop');

  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: 'CF_Authorization', value: await accessToken(), url: baseURL! }]);
  });

  async function openEditor(page: Page, id: string) {
    await page.goto(`/editor/${id}`);
    await expect(page.getByTestId('catalog')).toHaveAttribute('data-status', 'ready');
    await expect(page.getByTestId('room-scene')).toHaveAttribute('data-item-count', '1');
    await settled(page.locator('section[aria-label="3D view"] canvas'));
  }

  async function share(page: Page): Promise<string> {
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(page.getByTestId('share-dialog')).toHaveAttribute('data-state', 'shared', { timeout: 20_000 });
    const url = await page.getByTestId('share-link').inputValue();
    expect(url).toMatch(SNAPSHOT_LINK);
    return url;
  }

  test('Share writes a snapshot, copies its link, and keeps the live design out of it', async ({ page, context, request, baseURL }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL! });
    const designId = await storeDesign(request);
    await openEditor(page, designId);
    const url = await share(page);

    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    const snapshotId = SNAPSHOT_LINK.exec(url)![1]!;
    expect(snapshotId).not.toBe(designId);

    const stored = await request.get(`/api/snapshots/${snapshotId}`);
    expect(stored.status()).toBe(200);
    const text = await stored.text();
    expect(text).not.toContain(designId);
    const snapshot = JSON.parse(text) as { id: string; name: string; cameras: { name: string }[] };
    expect(snapshot.id).toBe(snapshotId);
    expect(snapshot.name).toBe('Living room');
    expect(snapshot.cameras.map((camera) => camera.name)).toEqual(['Shared view']);

    // The link-preview image, as a messaging app's crawler would find it.
    const page_ = await request.get(`/v/${snapshotId}`);
    const imageUrl = /<meta property="og:image" content="([^"]+)"/.exec(await page_.text())![1]!;
    const image = await request.get(imageUrl);
    expect(image.status()).toBe(200);
    expect(image.headers()['content-type']).toBe('image/jpeg');
    const body = await image.body();
    const { width, height, format } = await sharp(body).metadata();
    expect({ width, height, format }).toEqual({ width: 1200, height: 630, format: 'jpeg' });
    expect(await hasContent(body)).toBe(true);
  });

  test('acceptance: later edits do not change a snapshot, and deleting the design does not break it', async ({ page, request }) => {
    const designId = await storeDesign(request);
    await openEditor(page, designId);
    const url = await share(page);
    const snapshotUrl = `/api/snapshots/${SNAPSHOT_LINK.exec(url)![1]}`;
    const before = await (await request.get(snapshotUrl)).text();

    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByLabel('Wall height').fill('3.1');
    await page.getByLabel('Wall height').press('Enter');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
    expect(((await (await request.get(`/api/designs/${designId}`)).json()) as { room: { wallHeight: number } }).room.wallHeight).toBe(3.1);

    expect(await (await request.get(snapshotUrl)).text()).toBe(before);
    expect((JSON.parse(before) as { room: { wallHeight: number } }).room.wallHeight).toBe(2.5);

    // Sharing again makes a second link, and leaves the first alone.
    const second = await share(page);
    expect(second).not.toBe(url);
    expect(await (await request.get(snapshotUrl)).text()).toBe(before);
    expect(((await (await request.get(`/api/snapshots/${SNAPSHOT_LINK.exec(second)![1]}`)).json()) as { room: { wallHeight: number } }).room.wallHeight).toBe(3.1);

    expect((await request.delete(`/api/designs/${designId}`, { headers: await owner() })).status()).toBe(204);
    expect((await request.get(snapshotUrl)).status()).toBe(200);
  });

  test('Export image saves a PNG without the gizmo, and leaves the screen as it was', async ({ page, request }) => {
    await openEditor(page, await storeDesign(request, 'A/B room'));
    const scene = page.locator('section[aria-label="3D view"] canvas');

    // Select the chair in the plan, so the gizmo is on screen.
    const plan = page.getByTestId('plan-canvas');
    const box = (await plan.boundingBox())!;
    await page.getByRole('button', { name: 'Select' }).click();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId('item-bar')).toBeVisible();
    const onScreen = await settled(scene);
    expect(await hasGizmoColors(onScreen)).toBe(true);

    const { name, bytes } = await downloadedBytes(page, () => page.getByRole('button', { name: 'Export image' }).click());
    expect(name).toBe('A B room.png');
    expect(bytes.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE);
    expect(await hasContent(bytes)).toBe(true);
    expect(await hasGizmoColors(bytes)).toBe(false);
    const paneBox = (await scene.boundingBox())!;
    const { width, height } = await sharp(bytes).metadata();
    expect(Math.max(width, height)).toBeGreaterThanOrEqual(1920);
    expect(width / height).toBeCloseTo(paneBox.width / paneBox.height, 1);

    expect(Buffer.compare(onScreen, await settled(scene))).toBe(0);
  });

  test('sharing and exporting work with the 3D pane hidden', async ({ page, request }) => {
    await openEditor(page, await storeDesign(request));
    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Plan' }).click();

    const { bytes } = await downloadedBytes(page, () => page.getByRole('button', { name: 'Export image' }).click());
    expect(await hasContent(bytes)).toBe(true);

    const url = await share(page);
    const snapshot = (await (await request.get(`/api/snapshots/${SNAPSHOT_LINK.exec(url)![1]}`)).json()) as { cameras: unknown[] };
    expect(snapshot.cameras).toEqual([]);
    const preview = await request.get(`/api/assets/snapshots/${SNAPSHOT_LINK.exec(url)![1]}.jpg`);
    expect(await hasContent(await preview.body())).toBe(true);
  });

  test('a signed-out Share says so and creates nothing', async ({ page, context, request }) => {
    await openEditor(page, await storeDesign(request));
    await context.clearCookies();
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(page.getByTestId('share-dialog')).toHaveAttribute('data-state', 'failed');
    await expect(page.getByTestId('share-dialog')).toContainText('signed out');
  });
});

test.describe('the read-only viewer', () => {
  test('acceptance: a link opens with no login, shows the design and has no editing UI', async ({ page, request, context }) => {
    expect(await context.cookies()).toEqual([]);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const id = await storeSnapshot(request);
    const canvas = await openViewer(page, id);

    await expect(canvas).toBeVisible();
    expect(await hasContent(await settled(canvas))).toBe(true);
    await expect(page.getByRole('heading', { name: 'Living room' })).toBeVisible();
    await expect(page).toHaveTitle('Living room · Whimsy Forge');

    for (const editing of ['plan-canvas', 'catalog', 'item-bar', 'save-status']) await expect(page.getByTestId(editing)).toHaveCount(0);
    for (const label of ['Undo', 'Share', 'Delete', 'Duplicate']) await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Wall height')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('loads the chair from the catalog, and fits the screen', async ({ page, request }) => {
    const model = page.waitForResponse((response) => response.url().endsWith(`/api/assets/${CHAIR}/model.glb`));
    await openViewer(page, await storeSnapshot(request));
    expect((await model).status()).toBe(200);

    const size = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth);
    expect(size.scrollHeight).toBeLessThanOrEqual(size.clientHeight);
    for (const button of await page.locator('.viewer__controls button').all()) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.clientWidth);
    }
  });

  test('orbits by touch or mouse, and camera presets move the view', async ({ page, request, isMobile }) => {
    const canvas = await openViewer(page, await storeSnapshot(request));
    const views = page.getByRole('group', { name: 'Camera views' });
    const overview = views.getByRole('button', { name: 'Overview' });
    await expect(overview).toHaveAttribute('aria-pressed', 'true');
    const start = await settled(canvas);

    await dragAcross(page, isMobile);
    const orbited = await settled(canvas);
    expect(Buffer.compare(start, orbited)).not.toBe(0);
    await expect(overview).toHaveAttribute('aria-pressed', 'false');

    await views.getByRole('button', { name: 'Top' }).click();
    await expect(views.getByRole('button', { name: 'Top' })).toHaveAttribute('aria-pressed', 'true');
    const top = await settled(canvas);
    expect(Buffer.compare(orbited, top)).not.toBe(0);

    await views.getByRole('button', { name: 'Eye level' }).click();
    const eyeLevel = await settled(canvas);
    expect(Buffer.compare(top, eyeLevel)).not.toBe(0);

    // Pressing a preset again after orbiting returns to it, all but the last trace of the orbit's easing.
    await overview.click();
    await settled(canvas);
    await dragAcross(page, isMobile);
    const moved = await settled(canvas);
    expect(await changedShare(start, moved)).toBeGreaterThan(0.01);
    await overview.click();
    expect(await changedShare(start, await settled(canvas))).toBeLessThan(0.01);
  });

  test('opens at the view it was shared from', async ({ page, request }) => {
    const id = randomDesignId();
    const doc = { ...roomDocument(id), cameras: [{ name: 'Shared view', position: [0, 12, 0.01], target: [0, 1, 0] }] };
    await request.put(`/api/snapshots/${id}`, { data: JSON.stringify(doc), headers: { 'Content-Type': 'application/json', ...(await owner()) } });

    const canvas = await openViewer(page, id);
    const views = page.getByRole('group', { name: 'Camera views' });
    await expect(views.getByRole('button', { name: 'Shared view' })).toHaveAttribute('aria-pressed', 'true');
    const shared = await settled(canvas);
    await views.getByRole('button', { name: 'Overview' }).click();
    expect(Buffer.compare(shared, await settled(canvas))).not.toBe(0);
  });

  test('Export image saves a PNG of the current view', async ({ page, request }) => {
    const canvas = await openViewer(page, await storeSnapshot(request));
    const onScreen = await settled(canvas);
    const { name, bytes } = await downloadedBytes(page, () => page.getByRole('button', { name: 'Export image' }).click());
    expect(name).toBe('Living room.png');
    expect(bytes.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE);
    expect(await hasContent(bytes)).toBe(true);
    expect(Buffer.compare(onScreen, await settled(canvas))).toBe(0);
  });

  test('a link that leads nowhere says so', async ({ page }) => {
    for (const id of [randomDesignId(), 'not-an-id']) {
      await page.goto(`/v/${id}`);
      await expect(page.getByTestId('snapshot-failed')).toContainText('Design not found');
    }
  });

  test('a snapshot from a newer version asks for a reload, not a crash', async ({ page, request }) => {
    const id = randomDesignId();
    await request.put(`/api/snapshots/${id}`, { data: JSON.stringify({ ...roomDocument(id), schemaVersion: 999 }), headers: await owner() });
    await page.goto(`/v/${id}`);
    await expect(page.getByTestId('snapshot-failed')).toContainText('Reload');
  });
});

test.describe('link previews', () => {
  test('a crawler, which runs no JavaScript, gets tags for the snapshot', async ({ request, baseURL }) => {
    const id = await storeSnapshot(request, 'Tom & Ana\'s "den" <1>');
    const jpeg = await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#a85' } }).jpeg().toBuffer();
    expect((await request.put(`/api/snapshots/${id}/preview`, { data: jpeg, headers: { 'Content-Type': 'image/jpeg', ...(await owner()) } })).status()).toBe(201);

    const response = await request.get(`/v/${id}`, { headers: { 'User-Agent': 'WhatsApp/2.23' } });
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(`<meta property="og:title" content="Tom &amp; Ana's &quot;den&quot; &lt;1&gt;" />`);
    expect(html).toContain(`<meta property="og:url" content="${baseURL}/v/${id}" />`);
    expect(html).toContain(`<meta property="og:image" content="${baseURL}/api/assets/snapshots/${id}.jpg" />`);
    expect(html).toContain('<meta name="robots" content="noindex" />');
    expect(html).toContain('<div id="root">');

    const image = await request.get(`/api/assets/snapshots/${id}.jpg`);
    expect(image.status()).toBe(200);
    expect(image.headers()['content-type']).toBe('image/jpeg');
  });

  test('the link for a missing snapshot is a 404 with no tags, though the page still loads', async ({ request }) => {
    const response = await request.get(`/v/${randomDesignId()}`);
    expect(response.status()).toBe(404);
    const html = await response.text();
    expect(html).not.toContain('og:title');
    expect(html).toContain('<div id="root">');
  });
});

test.describe('who may do what', () => {
  test('acceptance: viewer routes need no login; the editor and writes still do', async ({ request }) => {
    const id = await storeSnapshot(request);
    expect((await request.get(`/v/${id}`)).status()).toBe(200);
    expect((await request.get(`/api/snapshots/${id}`)).status()).toBe(200);

    expect((await request.get('/editor')).status()).toBe(401);
    expect((await request.get(`/editor/${id}`)).status()).toBe(401);
    expect((await request.get('/api/designs')).status()).toBe(401);

    const other = randomDesignId();
    expect((await request.put(`/api/snapshots/${other}`, { data: JSON.stringify(roomDocument(other)) })).status()).toBe(401);
    expect((await request.put(`/api/snapshots/${other}/preview`, { data: Buffer.from([0xff, 0xd8, 0xff]), headers: { 'Content-Type': 'image/jpeg' } })).status()).toBe(401);
    expect((await request.get(`/api/snapshots/${other}`)).status()).toBe(404);
  });

  test('nobody can overwrite a snapshot, not even the owner', async ({ request }) => {
    const id = await storeSnapshot(request);
    const before = await (await request.get(`/api/snapshots/${id}`)).text();
    const again = await request.put(`/api/snapshots/${id}`, { data: JSON.stringify(roomDocument(id, 'Changed')), headers: { 'Content-Type': 'application/json', ...(await owner()) } });
    expect(again.status()).toBe(409);
    expect(await (await request.get(`/api/snapshots/${id}`)).text()).toBe(before);
  });

  test("a snapshot's id can't read a design, nor the other way round", async ({ request }) => {
    const snapshot = await storeSnapshot(request);
    const design = await storeDesign(request);
    expect((await request.get(`/api/designs/${snapshot}`)).status()).toBe(404);
    expect((await request.get(`/api/snapshots/${design}`)).status()).toBe(404);
  });
});
