// Renders model thumbnails in headless Chromium with software WebGL, so no GPU is needed.
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { createServer } from 'vite';

export const THUMBNAIL_SIZE = 256;

export type ThumbnailRenderer = {
  render(glb: Uint8Array): Promise<Buffer>;
  close(): Promise<void>;
};

const root = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export async function createThumbnailRenderer(): Promise<ThumbnailRenderer> {
  const server = await createServer({
    configFile: false,
    root,
    appType: 'mpa',
    logLevel: 'error',
    cacheDir: `${repoRoot}node_modules/.vite-thumbnail`,
    server: { host: '127.0.0.1', port: 0, fs: { allow: [repoRoot] } },
  });
  await server.listen();
  const address = server.resolvedUrls?.local[0];
  if (!address) throw new Error('The thumbnail page server has no address.');

  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  }).catch((error: unknown) => {
    void server.close();
    throw new Error(`Could not start Chromium, which renders thumbnails. Run "npx playwright install chromium". (${String(error)})`);
  });

  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  let current: Uint8Array | undefined;
  await page.route('**/model.glb', (route) => route.fulfill({ body: Buffer.from(current!), contentType: 'model/gltf-binary' }));
  await page.goto(`${address}thumbnail.html`);
  await page.waitForFunction(() => 'renderThumbnail' in window, undefined, { timeout: 60_000 });

  return {
    async render(glb) {
      current = glb;
      const dataUrl = await page.evaluate(() => (window as unknown as { renderThumbnail(url: string): Promise<string> }).renderThumbnail('/model.glb'));
      if (pageErrors.length) throw new Error(`Thumbnail page error: ${pageErrors.join('; ')}`);
      const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
      return sharp(png).resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE).webp({ quality: 80, alphaQuality: 90 }).toBuffer();
    },
    async close() {
      await browser.close();
      await server.close();
    },
  };
}
