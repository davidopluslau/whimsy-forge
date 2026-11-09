import { expect, test, type APIRequestContext } from '@playwright/test';
import catalog from '../seed/catalog.json' with { type: 'json' };
import privateCatalog from './fixtures/private-catalog.json' with { type: 'json' };
import { accessToken, randomDesignId } from './access-token';

// Seeded into local R2 by scripts/e2e-server.mjs, as `import-asset --private` would leave it.
const PRIVATE_ID = privateCatalog[0]!.id;
const SNAPSHOT_LINK = /\/v\/([A-Za-z0-9_-]{22})$/;
const publicModels = (catalog as { kind: string }[]).filter((asset) => asset.kind === 'model');

const owner = async () => ({ 'Cf-Access-Jwt-Assertion': await accessToken() });

/** An empty room in storage, ready to furnish. */
async function storeRoom(request: APIRequestContext): Promise<string> {
  const id = randomDesignId();
  const design = {
    schemaVersion: 1,
    id,
    name: 'Trying out a table',
    updatedAt: '2026-11-09T12:00:00.000Z',
    room: {
      wallHeight: 2.5,
      walls: [
        { id: 'n', start: [-2, -2], end: [2, -2], thickness: 0.1 },
        { id: 'e', start: [2, -2], end: [2, 2], thickness: 0.1 },
        { id: 's', start: [2, 2], end: [-2, 2], thickness: 0.1 },
        { id: 'w', start: [-2, 2], end: [-2, -2], thickness: 0.1 },
      ],
      openings: [],
    },
    items: [],
    cameras: [],
  };
  const response = await request.put(`/api/designs/${id}`, { data: JSON.stringify(design), headers: { 'Content-Type': 'application/json', ...(await owner()) } });
  expect(response.status()).toBe(204);
  return id;
}

test('the personal catalog and its files need the owner, and the public catalog never lists them', async ({ request }) => {
  const model = `/api/private/assets/${PRIVATE_ID}/model.glb`;
  expect((await request.get('/api/private/catalog')).status()).toBe(401);
  expect((await request.get(model)).status()).toBe(401);
  expect((await request.get('/api/private/catalog', { headers: { 'Cf-Access-Jwt-Assertion': await accessToken({ audience: 'another-app' }) } })).status()).toBe(401);

  const listed = await request.get('/api/private/catalog', { headers: await owner() });
  expect(listed.status()).toBe(200);
  expect(listed.headers()['cache-control']).toBe('private, no-cache');
  expect(((await listed.json()) as { id: string }[]).map((entry) => entry.id)).toEqual([PRIVATE_ID]);

  const file = await request.get(model, { headers: await owner() });
  expect(file.status()).toBe(200);
  expect(file.headers()['cache-control']).toBe('private, max-age=86400');

  expect(await (await request.get('/api/catalog')).text()).not.toContain(PRIVATE_ID);
});

test.describe('in the editor', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: 'CF_Authorization', value: await accessToken(), url: baseURL! }]);
  });

  test('acceptance: a private asset is placed like any other, and its share link shows a box in its place', async ({ page, request, browser, baseURL }) => {
    test.setTimeout(90_000);
    await page.goto(`/editor/${await storeRoom(request)}`);
    const panel = page.getByTestId('catalog');
    await expect(panel).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });

    const tile = panel.locator(`[data-asset-id="${PRIVATE_ID}"]`);
    await expect(tile).toContainText('My shop table');
    await expect(tile).toContainText('Private');
    await panel.getByRole('searchbox', { name: 'Search furniture' }).fill('private');
    await expect(panel.locator('.catalog__tile')).toHaveCount(1);

    const model = page.waitForResponse((response) => response.url().endsWith(`/api/private/assets/${PRIVATE_ID}/model.glb`));
    await tile.click();
    const preview = page.getByTestId('asset-preview');
    await expect(preview).toContainText('only you can see it');
    expect((await model).status()).toBe(200);
    await preview.getByRole('button', { name: 'Place in room' }).click();
    await expect(page.getByTestId('room-scene')).toHaveAttribute('data-item-count', '1');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });

    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const dialog = page.getByTestId('share-dialog');
    await expect(dialog).toHaveAttribute('data-state', 'shared', { timeout: 20_000 });
    await expect(page.getByTestId('share-private-note')).toContainText('One private item shows as a plain box');
    const snapshotId = SNAPSHOT_LINK.exec(await page.getByTestId('share-link').inputValue())![1]!;

    // What anyone with the link receives names no private asset, but keeps the item's place and size.
    const text = await (await request.get(`/api/snapshots/${snapshotId}`)).text();
    expect(text).not.toContain('private-');
    const [item] = (JSON.parse(text) as { items: { assetId: string; size: number[] }[] }).items;
    expect(item).toMatchObject({ assetId: 'private', size: privateCatalog[0]!.dimensions });
    const sharePage = await request.get(`/v/${snapshotId}`);
    expect(/<meta property="og:image" content="([^"]+)"/.test(await sharePage.text())).toBe(true);

    // A viewer with no sign-in sees a box and a note, and never asks for anything private.
    const stranger = await browser.newContext({ baseURL });
    try {
      const viewer = await stranger.newPage();
      const requested: string[] = [];
      viewer.on('request', (sent) => requested.push(sent.url()));
      await viewer.goto(`/v/${snapshotId}?quality=medium`);
      await expect(viewer.getByTestId('snapshot-viewer')).toHaveAttribute('data-catalog', 'ready');
      await expect(viewer.getByTestId('viewer-private-note')).toHaveText('One item is private and shows as a plain box.');
      await viewer.waitForLoadState('networkidle');
      expect(requested.filter((url) => url.includes('/api/private') || url.includes(PRIVATE_ID))).toEqual([]);
    } finally {
      await stranger.close();
    }
  });

  test('the public catalog still works when the personal one cannot be read', async ({ page }) => {
    await page.route('**/api/private/catalog', (route) => route.fulfill({ status: 500, body: '{}' }));
    await page.goto('/editor/new');
    const panel = page.getByTestId('catalog');
    await expect(panel).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
    await expect(page.getByTestId('private-catalog-failed')).toBeVisible();
    await expect(panel.locator('.catalog__tile')).toHaveCount(publicModels.length);
  });
});
