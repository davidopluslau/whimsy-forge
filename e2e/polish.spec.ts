import { expect, test, type Page, type Request } from '@playwright/test';
import sharp from 'sharp';
import { accessToken, randomDesignId } from './access-token';
import { storeFurnishedSnapshot } from './furnished-room';

/** What the phone budget allows for the furnished room. See "Phone budget" in docs/SYSTEM_DESIGN.md. */
const PHONE_BUDGET = { drawCalls: 80, triangles: 300_000, downloadMegabytes: 30, textureMegabytes: 150 };

const statsOf = async (page: Page) => {
  const panel = page.getByTestId('viewer-stats');
  await expect(panel).toHaveAttribute('data-fps', /\d+/, { timeout: 60_000 });
  const read = async (name: string) => Number(await panel.getAttribute(`data-${name}`));
  return { fps: await read('fps'), drawCalls: await read('draw-calls'), triangles: await read('triangles'), textureMegabytes: await read('texture-mb'), tier: await panel.getAttribute('data-tier') };
};

test.describe('the viewer on a phone', () => {
  test('a furnished room stays inside the phone budget', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'The budget is for a phone.');
    test.setTimeout(180_000);

    const assets: Request[] = [];
    page.on('requestfinished', (finished) => {
      if (finished.url().includes('/api/assets/')) assets.push(finished);
    });

    const id = await storeFurnishedSnapshot(request);
    // Pinned, so that a slow test machine can't lower the tier and flatter the numbers.
    await page.goto(`/v/${id}?stats&quality=medium`);
    await expect(page.getByTestId('snapshot-viewer')).toHaveAttribute('data-catalog', 'ready');
    await page.waitForLoadState('networkidle');

    // The frame that redraws the shadow map counts everything twice. Once the models have arrived, every
    // frame must settle under the budget: this fails if shadows ever go back to redrawing on each frame, or
    // if a material brings back a second pass over the scene.
    const ALL_MODELS_LOADED = 150_000;
    await expect(async () => {
      const { triangles, drawCalls } = await statsOf(page);
      expect(triangles).toBeGreaterThan(ALL_MODELS_LOADED);
      expect(triangles).toBeLessThanOrEqual(PHONE_BUDGET.triangles);
      expect(drawCalls).toBeLessThanOrEqual(PHONE_BUDGET.drawCalls);
    }).toPass({ timeout: 60_000 });
    expect((await statsOf(page)).textureMegabytes).toBeLessThanOrEqual(PHONE_BUDGET.textureMegabytes);

    const sizes = await Promise.all(assets.map(async (asset) => (await asset.sizes()).responseBodySize));
    const total = sizes.reduce((sum, size) => sum + size, 0);
    expect(total / 1024 / 1024).toBeLessThanOrEqual(PHONE_BUDGET.downloadMegabytes);
    // The HDRI, which everything on a phone pays for, is one of them.
    expect(assets.some((asset) => asset.url().endsWith('.hdr'))).toBe(true);
  });

  test('stats are shown only when asked for, and a phone starts below the top tier', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'The starting tier is for a phone.');
    const id = await storeFurnishedSnapshot(request);

    await page.goto(`/v/${id}`);
    await expect(page.getByTestId('snapshot-viewer')).toBeVisible();
    await expect(page.getByTestId('viewer-stats')).toHaveCount(0);

    await page.goto(`/v/${id}?stats`);
    await expect(page.getByTestId('viewer-stats')).toHaveAttribute('data-tier', /medium|low|minimal/);
  });
});

test('a viewer that can not keep up lowers its quality, down to the bottom tier', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'The adaptive tier is for a phone.');
  test.setTimeout(120_000);
  // Every frame takes at least 100 ms, on any machine: slower than the budget, and clearly not idle.
  await page.addInitScript(() => {
    window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 100);
  });
  const id = await storeFurnishedSnapshot(request);
  await page.goto(`/v/${id}?stats`);

  const panel = page.getByTestId('viewer-stats');
  await expect(panel).toHaveAttribute('data-tier', 'minimal', { timeout: 90_000 });
  // At the bottom tier a phone draws one pixel per CSS pixel. Pixel 7's screen is 412 wide.
  await expect(panel).toHaveAttribute('data-pixels', /^412x/, { timeout: 15_000 });
});

test('a pinned quality stays, however slow the frames', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'The adaptive tier is for a phone.');
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 100);
  });
  const id = await storeFurnishedSnapshot(request);
  await page.goto(`/v/${id}?stats&quality=medium`);

  const panel = page.getByTestId('viewer-stats');
  await expect(panel).toHaveAttribute('data-fps', /\d+/, { timeout: 30_000 });
  await page.waitForTimeout(8000);
  await expect(panel).toHaveAttribute('data-tier', 'medium');
});

test.describe('lighting', () => {
  test('the scene falls back to built-in light if the HDRI is missing, and still draws', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Once is enough.');
    const id = await storeFurnishedSnapshot(request);
    await page.route('**/*.hdr', (route) => route.abort());
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(error.message));

    await page.goto(`/v/${id}`);
    await expect(page.getByTestId('snapshot-viewer')).toHaveAttribute('data-catalog', 'ready');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('snapshot-failed')).toHaveCount(0);
    // Lit, not black: built-in light is doing the work.
    const { channels } = await sharp(await page.locator('canvas').screenshot()).stats();
    expect(Math.max(...channels.slice(0, 3).map((channel) => channel.mean))).toBeGreaterThan(60);
    expect(channels.slice(0, 3).some((channel) => channel.stdev > 4)).toBe(true);
    expect(failures).toEqual([]);
  });

  test('a shared scene names itself for screen readers, and number keys choose camera views', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Keys are for a desktop.');
    const id = await storeFurnishedSnapshot(request);
    await page.goto(`/v/${id}`);
    await expect(page.getByRole('img', { name: /3D view of Furnished living room/ })).toBeVisible();

    await page.keyboard.press('2');
    await expect(page.getByRole('button', { name: 'Top' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('1');
    await expect(page.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('the editor from the keyboard', () => {
  const designWithItems = (id: string) => ({
    schemaVersion: 1,
    id,
    name: 'Keyboard room',
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
    items: [{ id: 'table', assetId: 'side-table-01', position: [0, 0, 0], rotationY: 0, size: [0.55, 0.551, 0.45], mount: 'floor' }],
    cameras: [],
  });

  test.beforeEach(async ({ page, context, baseURL, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The editor is for a desktop.');
    const token = await accessToken();
    await context.addCookies([{ name: 'CF_Authorization', value: token, url: baseURL! }]);
    const id = randomDesignId();
    const stored = await request.put(`/api/designs/${id}`, {
      data: JSON.stringify(designWithItems(id)),
      headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': token },
    });
    expect(stored.status()).toBe(204);
    await page.goto(`/editor/${id}`);
    await expect(page.getByTestId('catalog')).toHaveAttribute('data-status', 'ready');
    await expect(page.getByTestId('plan-canvas')).toBeVisible();
  });

  test('? lists the shortcuts in a dialog that traps focus and gives it back', async ({ page }) => {
    await page.keyboard.press('?');
    const dialog = page.getByTestId('shortcuts-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await expect(dialog).toContainText('Add a window');

    // Shortcuts rest while the dialog is up.
    await page.keyboard.press('2');
    await expect(page.locator('main.editor')).toHaveAttribute('data-view-mode', 'split');

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('keys choose views, tools and the catalog, and leave typing alone', async ({ page }) => {
    const editor = page.locator('main.editor');
    const plan = page.getByTestId('plan-editor');

    await page.keyboard.press('2');
    await expect(editor).toHaveAttribute('data-view-mode', 'plan');
    await page.keyboard.press('3');
    await expect(editor).toHaveAttribute('data-view-mode', '3d');
    await page.keyboard.press('1');
    await expect(editor).toHaveAttribute('data-view-mode', 'split');

    await page.keyboard.press('d');
    await expect(plan).toHaveAttribute('data-tool', 'door');
    await page.keyboard.press('n');
    await expect(plan).toHaveAttribute('data-tool', 'window');
    await page.keyboard.press('v');
    await expect(plan).toHaveAttribute('data-tool', 'select');
    await page.keyboard.press('w');
    await expect(plan).toHaveAttribute('data-tool', 'draw');
    await page.keyboard.press('v');

    await page.keyboard.press('c');
    await expect(editor).toHaveAttribute('data-catalog-open', 'false');
    await page.keyboard.press('/');
    await expect(editor).toHaveAttribute('data-catalog-open', 'true');
    const search = page.getByRole('searchbox', { name: 'Search furniture' });
    await expect(search).toBeFocused();

    // Typing goes to the box, not to the shortcuts: "d", "n" and "2" change nothing here.
    await page.keyboard.type('dn2');
    await expect(search).toHaveValue('dn2');
    await expect(plan).toHaveAttribute('data-tool', 'select');
    await expect(editor).toHaveAttribute('data-view-mode', 'split');
  });

  test('an item can be reached, selected, raised and deleted without a pointer', async ({ page }) => {
    const item = page.getByTestId('plan-item');
    await expect(item).toHaveAttribute('aria-label', 'Side table');
    await item.focus();
    await page.keyboard.press('Enter');

    const bar = page.getByTestId('item-bar');
    await expect(bar).toBeVisible();
    await expect(item).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('selection-status')).toContainText('Side table selected');

    const height = bar.getByLabel('Height');
    await expect(height).toHaveValue('0.00 m');
    await page.keyboard.press('PageUp');
    await expect(height).toHaveValue('0.05 m');
    await page.keyboard.press('Shift+PageUp');
    await expect(height).toHaveValue('0.30 m');
    await page.keyboard.press('Control+z');
    await expect(height).toHaveValue('0.05 m');

    await page.keyboard.press('g');
    await expect(bar.getByRole('button', { name: 'Rotate' })).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Delete');
    await expect(page.getByTestId('plan-item')).toHaveCount(0);
  });

  test('a wall can be selected from the keyboard, and Ctrl+S saves at once', async ({ page }) => {
    const wall = page.getByTestId('plan-wall').first();
    await expect(wall).toHaveAttribute('aria-label', /Wall 1, 4\.00 m/);
    await wall.focus();
    await page.keyboard.press('Enter');
    await expect(wall).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Wall length')).toBeVisible();

    await page.getByRole('button', { name: 'Keyboard shortcuts' }).focus();
    const saved = page.waitForRequest((sent) => sent.method() === 'PUT' && sent.url().includes('/api/designs/'));
    await page.getByLabel('Wall height').fill('2.6');
    await page.getByLabel('Wall height').press('Enter');
    await page.keyboard.press('Control+s');
    await saved;
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  });

  test('a catalog lamp can be placed from the keyboard, and a ceiling lamp has no height to set', async ({ page }) => {
    await page.locator('.catalog__tile[data-asset-id="modern-ceiling-lamp-01"]').focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Place in room' }).click();
    await expect(page.getByTestId('item-bar')).toContainText('Modern ceiling lamp');
    await expect(page.getByTestId('item-bar').getByLabel('Height')).toHaveCount(0);
    await expect(page.getByTestId('lamp-limit')).toHaveCount(0);
  });
});
