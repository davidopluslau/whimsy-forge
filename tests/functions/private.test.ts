import { describe, expect, it } from 'vitest';
import { onRequestGet as getAsset } from '../../functions/api/assets/[[path]]';
import { onRequestGet as getPrivateAsset } from '../../functions/api/private/assets/[[path]]';
import { onRequestGet as getPrivateCatalog } from '../../functions/api/private/catalog';
import { mentionsPrivateAsset } from '../../functions/_lib/private';
import { call, createEnv, createTestKeys } from './helpers';

const ID = 'private-AbCdEfGhIjKlMnOpQrSt_-';
const CATALOG = JSON.stringify([{ id: ID }]);

async function seeded() {
  const keys = await createTestKeys();
  const created = createEnv({ ACCESS_TEST_JWKS: keys.jwks, ACCESS_PREVIEW_AUD: 'preview-aud' });
  await created.env.BUCKET.put('private/catalog.json', new TextEncoder().encode(CATALOG).buffer as ArrayBuffer, { httpMetadata: { contentType: 'application/json' } });
  await created.env.BUCKET.put(`private/assets/${ID}/model.glb`, new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, { httpMetadata: { contentType: 'model/gltf-binary' } });
  return { ...created, keys };
}

const request = (path: string, token?: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost/api/${path}`, { headers: { ...headers, ...(token ? { Cookie: `CF_Authorization=${token}` } : {}) } });

describe('GET /api/private/catalog', () => {
  it('answers 401 without a token, or with one for another application', async () => {
    const { env, keys } = await seeded();
    expect((await call(getPrivateCatalog as never, request('private/catalog'), env)).status).toBe(401);
    expect((await call(getPrivateCatalog as never, request('private/catalog', await keys.sign({ audience: 'another-app' })), env)).status).toBe(401);
  });

  it("serves the owner, or a preview's token, and only to the owner's browser cache", async () => {
    const { env, keys } = await seeded();
    for (const audience of [undefined, 'preview-aud']) {
      const response = await call(getPrivateCatalog as never, request('private/catalog', await keys.sign({ audience })), env);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');
      expect(response.headers.get('Cache-Control')).toBe('private, no-cache');
      expect(await response.text()).toBe(CATALOG);
    }
  });

  it('answers 304 when the ETag matches, and 404 before anything is imported', async () => {
    const { env, keys } = await seeded();
    const token = await keys.sign();
    const first = await call(getPrivateCatalog as never, request('private/catalog', token), env);
    const again = await call(getPrivateCatalog as never, request('private/catalog', token, { 'If-None-Match': first.headers.get('ETag')! }), env);
    expect(again.status).toBe(304);

    const empty = createEnv({ ACCESS_TEST_JWKS: keys.jwks });
    expect((await call(getPrivateCatalog as never, request('private/catalog', token), empty.env)).status).toBe(404);
  });

  it('fails closed when Access is not configured', async () => {
    const { env, keys } = await seeded();
    const response = await call(getPrivateCatalog as never, request('private/catalog', await keys.sign()), { ...env, ACCESS_AUD: '', ACCESS_PREVIEW_AUD: '' });
    expect(response.status).toBe(401);
  });
});

describe('GET /api/private/assets/*', () => {
  const path = ['private-AbCdEfGhIjKlMnOpQrSt_-', 'model.glb'];

  it("serves a private asset's file to the owner only", async () => {
    const { env, keys } = await seeded();
    expect((await call(getPrivateAsset as never, request(`private/assets/${path.join('/')}`), env, { path })).status).toBe(401);

    const response = await call(getPrivateAsset as never, request(`private/assets/${path.join('/')}`, await keys.sign()), env, { path });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('model/gltf-binary');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=86400');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('stays inside private/assets/', async () => {
    const { env, keys } = await seeded();
    const token = await keys.sign();
    expect((await call(getPrivateAsset as never, request('private/assets/x', token), env, { path: ['..', 'catalog.json'] })).status).toBe(404);
    expect((await call(getPrivateAsset as never, request('private/assets/x', token), env, { path: ['missing.glb'] })).status).toBe(404);
  });

  it('is out of reach of the public asset route', async () => {
    const { env } = await seeded();
    for (const attempt of [['..', 'private', 'assets', ...path], ['private', 'assets', ...path], ['..', 'private', 'catalog.json']]) {
      expect((await call(getAsset as never, request(`assets/${attempt.join('/')}`), env, { path: attempt })).status).toBe(404);
    }
  });
});

describe('mentionsPrivateAsset', () => {
  it('finds a private id anywhere in a document, and nothing else', () => {
    expect(mentionsPrivateAsset(JSON.stringify({ items: [{ assetId: ID }] }))).toBe(true);
    expect(mentionsPrivateAsset(JSON.stringify({ materialOverrides: { seat: ID } }))).toBe(true);
    expect(mentionsPrivateAsset(JSON.stringify({ name: 'private-party', items: [{ assetId: 'private' }, { assetId: 'sofa' }] }))).toBe(false);
  });
});
