import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import catalog from '../seed/catalog.json' with { type: 'json' };
import { accessToken } from './access-token';

type Entry = { id: string; name: string; kind: string; dimensions: number[]; thumbnailUrl: string; license: string; sourceUrl: string };

const models = (catalog as Entry[]).filter((asset) => asset.kind === 'model');

async function openEditor(page: Page, context: BrowserContext, baseURL: string | undefined) {
  await context.addCookies([{ name: 'CF_Authorization', value: await accessToken(), url: baseURL! }]);
  await page.goto('/editor/new');
  const panel = page.getByTestId('catalog');
  await expect(panel).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
  return panel;
}

test('GET /api/catalog is public, revalidated and supports 304', async ({ request }) => {
  const response = await request.get('/api/catalog');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-cache');
  const entries = (await response.json()) as Entry[];
  expect(entries.map((entry) => entry.id)).toEqual((catalog as Entry[]).map((entry) => entry.id));

  const again = await request.get('/api/catalog', { headers: { 'If-None-Match': response.headers().etag! } });
  expect(again.status()).toBe(304);
});

test('the panel lists every seed model, with thumbnails, and filters by search and category', async ({ page, context, baseURL }) => {
  const panel = await openEditor(page, context, baseURL);
  const tiles = panel.locator('.catalog__tile');
  await expect(tiles).toHaveCount(models.length);

  for (const label of ['Sofas', 'Chairs', 'Tables', 'Beds', 'Shelves', 'Lamps', 'Plants']) {
    await expect(panel.getByRole('button', { name: label, exact: true })).toBeVisible();
  }

  // Thumbnails below the fold load lazily, so scroll to each one first.
  for (const tile of await tiles.all()) {
    await tile.scrollIntoViewIfNeeded();
    await expect.poll(() => tile.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(256);
  }

  const search = panel.getByRole('searchbox', { name: 'Search furniture' });
  await search.fill('couch');
  await expect(tiles).toHaveCount(2);
  await expect(panel.getByRole('button', { name: 'Two-seat sofa' })).toBeVisible();

  await search.fill('no such thing');
  await expect(tiles).toHaveCount(0);
  await expect(panel).toContainText('Nothing matches');

  await search.clear();
  await panel.getByRole('button', { name: 'Beds', exact: true }).click();
  await expect(tiles).toHaveCount(2);
  await search.fill('gothic');
  await expect(tiles).toHaveCount(1);
  await panel.getByRole('button', { name: 'All', exact: true }).click();
  await expect(tiles).toHaveCount(1);
});

test('the panel offers a retry when the catalog fails to load', async ({ page, context, baseURL }) => {
  let failing = true;
  await page.route('**/api/catalog', (route) => (failing ? route.fulfill({ status: 500, body: '{}' }) : route.continue()));
  await context.addCookies([{ name: 'CF_Authorization', value: await accessToken(), url: baseURL! }]);
  await page.goto('/editor/new');
  const panel = page.getByTestId('catalog');
  await expect(panel).toHaveAttribute('data-status', 'error');

  failing = false;
  await panel.getByRole('button', { name: 'Try again' }).click();
  await expect(panel).toHaveAttribute('data-status', 'ready');
  await expect(panel.locator('.catalog__tile')).toHaveCount(models.length);
});

test('the panel can be closed to give the plan its width back, keeping its search', async ({ page, context, baseURL }) => {
  const panel = await openEditor(page, context, baseURL);
  const toggle = page.getByRole('button', { name: 'Catalog', exact: true });
  const plan = page.getByRole('region', { name: 'Floor plan' });
  const search = panel.getByRole('searchbox', { name: 'Search furniture' });
  await search.fill('sofa');
  const narrow = (await plan.boundingBox())!.width;

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(panel).toBeHidden();
  expect((await plan.boundingBox())!.width).toBeGreaterThan(narrow);

  await toggle.click();
  await expect(search).toHaveValue('sofa');
});

test.describe('every seed model in the real renderer', () => {
  for (const model of models) {
    test(`${model.id} loads at its catalog size`, async ({ page, context, baseURL }) => {
      const failures: string[] = [];
      page.on('pageerror', (error) => failures.push(error.message));
      page.on('response', (response) => {
        if (!response.ok() && response.status() !== 304 && response.url().includes('/api/')) failures.push(`${response.status()} ${response.url()}`);
      });

      const panel = await openEditor(page, context, baseURL);
      await panel.locator(`[data-asset-id="${model.id}"]`).click();
      const preview = page.getByTestId('asset-preview');

      await expect(preview.getByRole('heading', { name: model.name })).toBeVisible();
      await expect(preview).toContainText(model.license);
      await expect(preview.getByRole('link', { name: 'Source' })).toHaveAttribute('href', model.sourceUrl);

      await expect(preview).toHaveAttribute('data-measured-size', /\S/, { timeout: 30_000 });
      const measured = (await preview.getAttribute('data-measured-size'))!.split(' ').map(Number);
      measured.forEach((side, axis) => expect(Math.abs(side - model.dimensions[axis]!), `axis ${axis}: ${measured.join(', ')}`).toBeLessThan(0.01));
      expect(failures).toEqual([]);

      await preview.getByRole('button', { name: 'Close' }).click();
      await expect(preview).toBeHidden();
    });
  }
});

test('one command imports a new model: normalized, with a rendered thumbnail, in the catalog', async () => {
  test.setTimeout(120_000);
  const seedDir = mkdtempSync(join(tmpdir(), 'whimsy-e2e-import-'));
  try {
    writeFileSync(join(seedDir, 'catalog.json'), '[]\n');
    const source = join(seedDir, 'source.glb');
    cpSync(join('seed', 'assets', 'side-table-01', 'model.glb'), source);

    const output = execFileSync(
      process.execPath,
      [
        join('scripts', 'import-asset.ts'), source,
        '--name', 'Tiny table', '--category', 'table', '--height', '0.5',
        '--license', 'CC0 1.0', '--source', 'https://polyhaven.com/a/side_table_01',
        '--no-upload', '--seed-dir', seedDir,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    );
    expect(output).toContain('Imported "Tiny table" as tiny-table');

    const [entry] = JSON.parse(readFileSync(join(seedDir, 'catalog.json'), 'utf8')) as Entry[];
    expect(entry!.dimensions[1]).toBeCloseTo(0.5, 2);
    expect(entry!.license).toBe('CC0 1.0');
    expect(entry!.sourceUrl).toBe('https://polyhaven.com/a/side_table_01');
    // A blank render would be tiny; a real one has detail worth several kilobytes.
    expect(readFileSync(join(seedDir, entry!.thumbnailUrl)).byteLength).toBeGreaterThan(2000);
  } finally {
    rmSync(seedDir, { recursive: true, force: true });
  }
});
