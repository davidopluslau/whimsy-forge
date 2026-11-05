import { expect, test } from '@playwright/test';
import { accessToken } from './access-token';

test('the editor route is closed without a token', async ({ request }) => {
  expect((await request.get('/editor')).status()).toBe(401);
  expect((await request.get('/editor/anything')).status()).toBe(401);
});

test('a signed-in owner reaches the design list and saves with only the cookie', async ({ page, context, baseURL, request }) => {
  await context.addCookies([{ name: 'CF_Authorization', value: await accessToken(), url: baseURL! }]);

  await page.goto('/editor');
  await expect(page.getByRole('heading', { name: 'Designs' })).toBeVisible();

  await page.getByRole('link', { name: 'New design' }).click();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  const id = new URL(page.url()).pathname.split('/').pop()!;
  expect((await request.get(`/api/designs/${id}`)).status()).toBe(200);
});

test('the public page does not require a token', async ({ request }) => {
  expect((await request.get('/')).status()).toBe(200);
});
