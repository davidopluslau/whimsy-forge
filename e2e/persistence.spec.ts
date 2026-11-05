import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import fixture from '../src/model/fixtures/design-v1.json' with { type: 'json' };
import { accessToken, randomDesignId } from './access-token';

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'CF_Authorization', value: await accessToken(), url: baseURL! }]);
});

type Stored = { id: string; name: string; room: { walls: unknown[]; wallHeight: number }; items: unknown[] };

/** A new design, saved, ready to edit. Its id comes from the address the editor moves to. */
async function newDesign(page: Page): Promise<string> {
  await page.goto('/editor/new');
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  await expect(page).toHaveURL(/\/editor\/[A-Za-z0-9_-]{22}$/);
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  return new URL(page.url()).pathname.split('/').pop()!;
}

const stored = async (request: APIRequestContext, id: string) => (await (await request.get(`/api/designs/${id}`)).json()) as Stored;

const wallHeight = (page: Page) => page.getByLabel('Wall height');

async function setWallHeight(page: Page, meters: string) {
  await wallHeight(page).fill(meters);
  await wallHeight(page).press('Enter');
}

/** Puts a document in storage directly, as an older version of the app would have left it. */
async function storeDocument(request: APIRequestContext, doc: object) {
  const response = await request.put(`/api/designs/${(doc as { id: string }).id}`, {
    data: JSON.stringify(doc),
    headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': await accessToken() },
  });
  expect(response.status()).toBe(204);
}

test.describe('autosave', () => {
  test('saves about 2 seconds after the last change, and the design reopens with it', async ({ page, request }) => {
    const id = await newDesign(page);
    await setWallHeight(page, '3');

    const status = page.getByTestId('save-status');
    await expect(status).toHaveAttribute('data-state', 'saving');
    expect((await stored(request, id)).room.wallHeight).toBe(2.5);

    await expect(status).toHaveAttribute('data-state', 'saved', { timeout: 5000 });
    expect((await stored(request, id)).room.wallHeight).toBe(3);

    await page.reload();
    await expect(wallHeight(page)).toHaveValue('3.00 m');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  });

  test('a reload right after an edit keeps the edit, and sends it to the server', async ({ page, request }) => {
    const id = await newDesign(page);
    await setWallHeight(page, '3.1');
    await page.reload();
    await expect(wallHeight(page)).toHaveValue('3.10 m');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    expect((await stored(request, id)).room.wallHeight).toBe(3.1);
  });

  test('acceptance: killing the tab mid-edit loses at most the last 2 seconds', async ({ context, page, request }) => {
    const id = await newDesign(page);
    // Offline, and a crash runs no page-closing handlers, so only the draft written since the edit can keep this.
    await context.setOffline(true);
    await setWallHeight(page, '3.2');
    await page.waitForTimeout(1000);
    const crashed = page.waitForEvent('crash');
    const cdp = await context.newCDPSession(page);
    void cdp.send('Page.crash').catch(() => undefined);
    await crashed;
    await page.close();
    await context.setOffline(false);
    expect((await stored(request, id)).room.wallHeight).toBe(2.5);

    const reopened = await context.newPage();
    await reopened.goto(`/editor/${id}`);
    await expect(wallHeight(reopened)).toHaveValue('3.20 m');
    await expect(reopened.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    expect((await stored(request, id)).room.wallHeight).toBe(3.2);
  });

  test('closing the tab normally reaches the server by itself, without reopening', async ({ page, request }) => {
    const id = await newDesign(page);
    await setWallHeight(page, '3.3');
    await page.close({ runBeforeUnload: true });
    await expect.poll(async () => (await stored(request, id)).room.wallHeight, { timeout: 5000 }).toBe(3.3);
  });

  test('a failing server shows an error, keeps retrying, and recovers on its own', async ({ page, request }) => {
    test.setTimeout(90_000);
    const id = await newDesign(page);
    let failing = true;
    await page.route(`**/api/designs/${id}`, (route) => (failing && route.request().method() === 'PUT' ? route.fulfill({ status: 500, body: '{}' }) : route.continue()));

    await setWallHeight(page, '2.8');
    const status = page.getByTestId('save-status');
    await expect(status).toHaveAttribute('data-state', 'error', { timeout: 5000 });
    await expect(status).toHaveText('Not saved: retrying');

    failing = false;
    await expect(status).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
    expect((await stored(request, id)).room.wallHeight).toBe(2.8);
  });

  test('being signed out says so', async ({ page }) => {
    const id = await newDesign(page);
    await page.route(`**/api/designs/${id}`, (route) => (route.request().method() === 'PUT' ? route.fulfill({ status: 401, body: '{}' }) : route.continue()));
    await setWallHeight(page, '2.9');
    await expect(page.getByTestId('save-status')).toHaveText('Not saved: signed out', { timeout: 5000 });
  });

  test('undo is saved too', async ({ page, request }) => {
    const id = await newDesign(page);
    await setWallHeight(page, '3');
    const status = page.getByTestId('save-status');
    await expect(status).toHaveAttribute('data-state', 'saved', { timeout: 5000 });
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(status).toHaveAttribute('data-state', 'saving');
    await expect(status).toHaveAttribute('data-state', 'saved', { timeout: 5000 });
    expect((await stored(request, id)).room.wallHeight).toBe(2.5);
  });
});

test.describe('two tabs on one design', () => {
  test('a stale tab reports a conflict and overwrites nothing until told', async ({ page, request }) => {
    const id = await newDesign(page);
    const original = await stored(request, id);
    await storeDocument(request, { ...original, name: 'From another tab' });

    await setWallHeight(page, '3');
    const status = page.getByTestId('save-status');
    await expect(status).toHaveAttribute('data-state', 'conflict', { timeout: 5000 });
    expect((await stored(request, id)).name).toBe('From another tab');

    await page.getByRole('button', { name: 'Keep mine' }).click();
    await expect(status).toHaveAttribute('data-state', 'saved');
    const kept = await stored(request, id);
    expect(kept.name).toBe(original.name);
    expect(kept.room.wallHeight).toBe(3);
  });

  test('"Load latest" drops this tab\'s edits for the stored version', async ({ page, request }) => {
    const id = await newDesign(page);
    await storeDocument(request, { ...(await stored(request, id)), name: 'From another tab' });

    await setWallHeight(page, '3');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'conflict', { timeout: 5000 });
    await page.getByRole('button', { name: 'Load latest' }).click();

    await expect(page.getByLabel('Design name')).toHaveValue('From another tab');
    await expect(wallHeight(page)).toHaveValue('2.50 m');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    expect((await stored(request, id)).name).toBe('From another tab');
  });
});

test.describe('design list', () => {
  const row = (page: Page, id: string) => page.locator(`[data-testid="design-row"][data-design-id="${id}"]`);

  test('is closed without a token', async ({ request, playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL });
    expect((await anonymous.get('/api/designs')).status()).toBe(401);
    await anonymous.dispose();
    expect((await request.get('/api/designs', { headers: { 'Cf-Access-Jwt-Assertion': await accessToken() } })).status()).toBe(200);
  });

  test('create, rename in the editor, come back, rename, duplicate and delete', async ({ page, request }) => {
    await page.goto('/editor');
    await expect(page.getByRole('heading', { name: 'Designs' })).toBeVisible();
    await page.getByRole('link', { name: 'New design' }).click();
    await expect(page).toHaveURL(/\/editor\/[A-Za-z0-9_-]{22}$/);
    const id = new URL(page.url()).pathname.split('/').pop()!;

    // Reloading doesn't create another one, and going back returns to the list.
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/editor/${id}$`));

    const name = `Studio ${id}`;
    await page.getByLabel('Design name').fill(name);
    await page.getByLabel('Design name').press('Enter');
    // Leaving at once must still show the new name: the link waits for the save.
    await page.getByRole('link', { name: 'Designs' }).click();
    await expect(page.getByRole('heading', { name: 'Designs' })).toBeVisible();
    await expect(row(page, id).getByRole('link', { name })).toBeVisible();

    await row(page, id).getByRole('button', { name: 'Rename' }).click();
    const renamed = `Atelier ${id}`;
    await row(page, id).getByRole('textbox').fill(renamed);
    await row(page, id).getByRole('button', { name: 'Save' }).click();
    await expect(row(page, id).getByRole('link', { name: renamed })).toBeVisible();
    expect((await stored(request, id)).name).toBe(renamed);

    await row(page, id).getByRole('button', { name: 'Duplicate' }).click();
    const copyLink = page.getByRole('link', { name: `Copy of ${renamed}` });
    await expect(copyLink).toBeVisible();
    const copyId = (await copyLink.getAttribute('href'))!.split('/').pop()!;
    expect(copyId).not.toBe(id);
    expect((await stored(request, copyId)).id).toBe(copyId);

    await row(page, id).getByRole('button', { name: 'Delete' }).click();
    await row(page, id).getByRole('button', { name: 'Keep' }).click();
    await expect(row(page, id)).toBeVisible();
    await row(page, id).getByRole('button', { name: 'Delete' }).click();
    await row(page, id).getByRole('button', { name: 'Delete' }).click();
    await expect(row(page, id)).toHaveCount(0);
    expect((await request.get(`/api/designs/${id}`)).status()).toBe(404);
    await expect(row(page, copyId)).toBeVisible();

    await copyLink.click();
    await expect(page.getByLabel('Design name')).toHaveValue(`Copy of ${renamed}`);
  });

  test('a duplicate is independent of the original', async ({ page, request }) => {
    const id = await newDesign(page);
    await page.getByLabel('Design name').fill(id);
    await setWallHeight(page, '3');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved', { timeout: 5000 });

    await page.goto('/editor');
    await row(page, id).getByRole('button', { name: 'Duplicate' }).click();
    // Named after the original's id, because other tests' designs share this list.
    const copy = page.locator('[data-testid="design-row"]').filter({ has: page.getByRole('link', { name: `Copy of ${id}` }) });
    await expect(copy).toBeVisible();
    const copyId = (await copy.getAttribute('data-design-id'))!;
    await copy.getByRole('link').click();
    await expect(wallHeight(page)).toHaveValue('3.00 m');

    await setWallHeight(page, '2.7');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved', { timeout: 5000 });
    expect((await stored(request, copyId)).room.wallHeight).toBe(2.7);
    expect((await stored(request, id)).room.wallHeight).toBe(3);
  });

  test('a non-ASCII name survives the list metadata on the real runtime', async ({ page, request }) => {
    const id = randomDesignId();
    const name = 'Café 🪑 100%';
    await storeDocument(request, { ...fixture, id, name });
    await page.goto('/editor');
    await expect(row(page, id).getByRole('link', { name })).toBeVisible();
  });
});

test.describe('opening stored designs', () => {
  test('a v1 fixture opens with its room and items', async ({ page, request }) => {
    const id = randomDesignId();
    await storeDocument(request, { ...fixture, id });
    await page.goto(`/editor/${id}`);

    const scene = page.getByTestId('room-scene');
    await expect(scene).toHaveAttribute('data-wall-count', '4');
    await expect(scene).toHaveAttribute('data-opening-count', '2');
    await expect(scene).toHaveAttribute('data-item-count', '3');
    await expect(page.getByTestId('room-status')).toHaveText('Closed room · floor 20.00 m²');
    await expect(page.getByLabel('Design name')).toHaveValue(fixture.name);
    // Opening isn't an edit.
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    await expect(page.getByTestId('plan-editor')).toHaveAttribute('data-tool', 'select');
  });

  test('a saved room far from the origin is brought into view', async ({ page, request }) => {
    const id = randomDesignId();
    const shifted = fixture.room.walls.map((wall) => ({
      ...wall,
      start: [wall.start[0]! + 50, wall.start[1]! + 40],
      end: [wall.end[0]! + 50, wall.end[1]! + 40],
    }));
    await storeDocument(request, { ...fixture, id, room: { ...fixture.room, walls: shifted } });
    await page.goto(`/editor/${id}`);

    const canvas = page.getByTestId('plan-canvas');
    await expect(page.getByTestId('wall-dimension').first()).toBeVisible();
    const box = (await canvas.boundingBox())!;
    const label = (await page.getByTestId('wall-dimension').first().boundingBox())!;
    expect(label.x).toBeGreaterThan(box.x);
    expect(label.x).toBeLessThan(box.x + box.width);
    expect(label.y).toBeGreaterThan(box.y);
    expect(label.y).toBeLessThan(box.y + box.height);
  });

  test('a design from a newer schema is refused with a clear message, and left untouched', async ({ page, request }) => {
    const id = randomDesignId();
    const newer = { ...fixture, id, schemaVersion: 999 };
    await storeDocument(request, newer);
    await page.goto(`/editor/${id}`);

    const refusal = page.getByTestId('open-failed');
    await expect(refusal).toHaveAttribute('data-kind', 'refused');
    await expect(refusal).toContainText('newer version of Whimsy Forge');
    await expect(refusal).toContainText('schema 999');
    await expect(page.getByTestId('plan-canvas')).toHaveCount(0);
    expect(await stored(request, id)).toEqual(newer);
  });

  test('renaming a newer design from the list is refused too', async ({ page, request }) => {
    const id = randomDesignId();
    await storeDocument(request, { ...fixture, id, schemaVersion: 999 });
    await page.goto('/editor');
    const row = page.locator(`[data-testid="design-row"][data-design-id="${id}"]`);
    await row.getByRole('button', { name: 'Rename' }).click();
    await row.getByRole('textbox').fill('Nope');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('designs-error')).toContainText('newer version of Whimsy Forge');
    expect((await stored(request, id)).name).toBe(fixture.name);
  });

  test('a damaged design gets a message, not a blank page', async ({ page, request }) => {
    const id = randomDesignId();
    await storeDocument(request, { schemaVersion: 1, id, name: 'Damaged' });
    await page.goto(`/editor/${id}`);
    await expect(page.getByTestId('open-failed')).toContainText("can't be read");
  });

  test('an unknown or malformed address says it was not found', async ({ page }) => {
    await page.goto(`/editor/${randomDesignId()}`);
    await expect(page.getByTestId('open-failed')).toContainText('Design not found');
    await page.goto('/editor/not-a-design');
    await expect(page.getByTestId('open-failed')).toContainText('Design not found');
    await page.getByRole('link', { name: 'Back to designs' }).click();
    await expect(page.getByRole('heading', { name: 'Designs' })).toBeVisible();
  });

  test('a failed load can be retried', async ({ page, request }) => {
    const id = randomDesignId();
    await storeDocument(request, { ...fixture, id });
    let failing = true;
    await page.route(`**/api/designs/${id}`, (route) => (failing ? route.fulfill({ status: 500, body: '{}' }) : route.continue()));
    await page.goto(`/editor/${id}`);
    await expect(page.getByTestId('open-failed')).toHaveAttribute('data-kind', 'failed');
    failing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('room-scene')).toHaveAttribute('data-wall-count', '4');
  });
});
