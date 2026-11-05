import { expect, test } from '@playwright/test';
import { accessToken, randomDesignId } from './access-token';

const designBody = (id: string) => `{ "schemaVersion": 1,  "id": "${id}", "name": "Café 🪑", "room": { "wallHeight": 2.50 } }\n`;

test.describe('/api/designs/:id', () => {
  test('a design round-trips unchanged through the Pages runtime and local R2', async ({ request }) => {
    const id = randomDesignId();
    const body = designBody(id);

    const saved = await request.put(`/api/designs/${id}`, {
      data: body,
      headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': await accessToken() },
    });
    expect(saved.status()).toBe(204);

    const loaded = await request.get(`/api/designs/${id}`);
    expect(loaded.status()).toBe(200);
    expect(await loaded.text()).toBe(body);
  });

  test('an unauthenticated write returns 401 and stores nothing', async ({ request }) => {
    const id = randomDesignId();
    const saved = await request.put(`/api/designs/${id}`, {
      data: designBody(id),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(saved.status()).toBe(401);
    expect((await request.get(`/api/designs/${id}`)).status()).toBe(404);
  });

  test('a token for another application returns 401', async ({ request }) => {
    const id = randomDesignId();
    const saved = await request.put(`/api/designs/${id}`, {
      data: designBody(id),
      headers: { 'Cf-Access-Jwt-Assertion': await accessToken({ audience: 'another-app' }) },
    });
    expect(saved.status()).toBe(401);
  });

  test('other write methods are also refused without a token', async ({ request }) => {
    const url = `/api/designs/${randomDesignId()}`;
    expect((await request.post(url)).status()).toBe(401);
    expect((await request.delete(url)).status()).toBe(401);
    expect((await request.post('/api/something-new')).status()).toBe(401);
  });

  test('reading is public; a missing design returns 404', async ({ request }) => {
    expect((await request.get(`/api/designs/${randomDesignId()}`)).status()).toBe(404);
  });
});

test.describe('/api/assets/*', () => {
  test('serves assets but not other bucket contents', async ({ request }) => {
    const asset = await request.get('/api/assets/painted-wooden-chair-01/model.glb');
    expect(asset.status()).toBe(200);
    expect((await asset.body()).subarray(0, 4).toString('latin1')).toBe('glTF');
    expect((await request.get('/api/assets/%2e%2e/catalog.json')).status()).toBe(404);
    expect((await request.get('/api/assets/..%2Fcatalog.json')).status()).toBe(404);
  });

  test('unknown API paths return a JSON 404, not the app page', async ({ request }) => {
    const response = await request.get('/api/nothing-here');
    expect(response.status()).toBe(404);
    expect(response.headers()['content-type']).toContain('application/json');
  });
});
