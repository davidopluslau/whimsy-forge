import { expect, test } from '@playwright/test';
import { accessToken } from './access-token';

test('the editor route is closed without a token', async ({ request }) => {
  expect((await request.get('/editor')).status()).toBe(401);
  expect((await request.get('/editor/anything')).status()).toBe(401);
});

test('a signed-in owner reaches the editor and can save and load with only the cookie', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'CF_Authorization', value: await accessToken(), url: baseURL! }]);

  await page.goto('/editor');
  await expect(page.getByRole('heading', { name: 'Editor' })).toBeVisible();

  await page.getByText('API check').click();
  await page.getByRole('button', { name: 'Run save and load check' }).click();
  const result = page.getByTestId('check-result');
  await expect(result).toHaveAttribute('data-ok', 'true');
  await expect(result).toContainText('Round trip OK');
});

test('the public page does not require a token', async ({ request }) => {
  expect((await request.get('/')).status()).toBe(200);
});
