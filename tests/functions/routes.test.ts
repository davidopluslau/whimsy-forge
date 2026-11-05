import { describe, expect, it } from 'vitest';
import { onRequestGet as getAsset } from '../../functions/api/assets/[[path]]';
import { onRequestGet as getCatalog } from '../../functions/api/catalog';
import { onRequestDelete as deleteDesign, onRequestGet as getDesign, onRequestPut as putDesign } from '../../functions/api/designs/[id]';
import { onRequestGet as listDesigns } from '../../functions/api/designs/index';
import { call, createEnv, createTestKeys } from './helpers';

const ID = 'AbCdEfGhIjKlMnOpQrSt_-';
const url = (id = ID) => `http://localhost/api/designs/${id}`;

function put(body: BodyInit, id = ID, headers: HeadersInit = {}) {
  return new Request(url(id), { method: 'PUT', body, headers });
}

describe('PUT then GET /api/designs/:id', () => {
  it('round-trips the exact bytes, including formatting, key order and unicode', async () => {
    const { env, bucket } = createEnv();
    const body = `{ "z": 1,\n  "schemaVersion": 1, "id": "${ID}",   "name": "Café 🪑", "a": 1.50 }\n`;

    const saved = await call(putDesign as never, put(body), env, { id: ID });
    expect(saved.status).toBe(204);
    expect(bucket.objects.has(`designs/${ID}.json`)).toBe(true);

    const loaded = await call(getDesign as never, new Request(url()), env, { id: ID });
    expect(loaded.status).toBe(200);
    expect(loaded.headers.get('Content-Type')).toBe('application/json');
    expect(loaded.headers.get('Cache-Control')).toBe('no-store');
    expect(await loaded.text()).toBe(body);
  });

  it('overwrites the previous version', async () => {
    const { env } = createEnv();
    const doc = (name: string) => JSON.stringify({ schemaVersion: 1, id: ID, name });
    await call(putDesign as never, put(doc('first')), env, { id: ID });
    await call(putDesign as never, put(doc('second')), env, { id: ID });
    const loaded = await call(getDesign as never, new Request(url()), env, { id: ID });
    expect(await loaded.text()).toBe(doc('second'));
  });
});

describe('conditional saves', () => {
  const doc = (name: string) => JSON.stringify({ schemaVersion: 1, id: ID, name });

  async function saved(env: ReturnType<typeof createEnv>['env']) {
    const response = await call(putDesign as never, put(doc('first')), env, { id: ID });
    return response.headers.get('ETag')!;
  }

  it('saves when If-Match is the current tag, and returns the next tag', async () => {
    const { env } = createEnv();
    const etag = await saved(env);
    const response = await call(putDesign as never, put(doc('second'), ID, { 'If-Match': etag }), env, { id: ID });
    expect(response.status).toBe(204);
    expect(response.headers.get('ETag')).not.toBe(etag);
  });

  it('accepts the weak form of the tag, as the edge returns on a compressed response', async () => {
    const { env } = createEnv();
    const etag = await saved(env);
    const response = await call(putDesign as never, put(doc('second'), ID, { 'If-Match': `W/${etag}` }), env, { id: ID });
    expect(response.status).toBe(204);
  });

  it('answers 412 and changes nothing when the tag is stale', async () => {
    const { env } = createEnv();
    const stale = await saved(env);
    await call(putDesign as never, put(doc('second')), env, { id: ID });
    const response = await call(putDesign as never, put(doc('third'), ID, { 'If-Match': stale }), env, { id: ID });
    expect(response.status).toBe(412);
    const loaded = await call(getDesign as never, new Request(url()), env, { id: ID });
    expect(await loaded.text()).toBe(doc('second'));
  });

  it('answers 412 when the design has been deleted since', async () => {
    const { env } = createEnv();
    const etag = await saved(env);
    await call(deleteDesign as never, new Request(url(), { method: 'DELETE' }), env, { id: ID });
    const response = await call(putDesign as never, put(doc('back'), ID, { 'If-Match': etag }), env, { id: ID });
    expect(response.status).toBe(412);
  });

  it('returns the ETag on a load', async () => {
    const { env } = createEnv();
    const etag = await saved(env);
    const loaded = await call(getDesign as never, new Request(url()), env, { id: ID });
    expect(loaded.headers.get('ETag')).toBe(etag);
  });
});

describe('DELETE /api/designs/:id', () => {
  it('removes the design, and is fine with one already gone', async () => {
    const { env, bucket } = createEnv();
    await call(putDesign as never, put(JSON.stringify({ schemaVersion: 1, id: ID })), env, { id: ID });
    const request = () => new Request(url(), { method: 'DELETE' });
    expect((await call(deleteDesign as never, request(), env, { id: ID })).status).toBe(204);
    expect(bucket.objects.size).toBe(0);
    expect((await call(deleteDesign as never, request(), env, { id: ID })).status).toBe(204);
  });

  it('answers 400 for a malformed id without touching storage', async () => {
    const { env, bucket } = createEnv();
    await bucket.put('catalog.json', new ArrayBuffer(1));
    const response = await call(deleteDesign as never, new Request(url('nope'), { method: 'DELETE' }), env, { id: '../catalog' });
    expect(response.status).toBe(400);
    expect(bucket.objects.has('catalog.json')).toBe(true);
  });
});

describe('GET /api/designs', () => {
  const OTHER = 'ZyXwVuTsRqPoNmLkJiHg_-';
  const request = (token?: string) => new Request('http://localhost/api/designs', { headers: token ? { Cookie: `CF_Authorization=${token}` } : {} });

  async function signedIn() {
    const keys = await createTestKeys();
    const created = createEnv({ ACCESS_TEST_JWKS: keys.jwks, ACCESS_PREVIEW_AUD: 'preview-aud' });
    return { ...created, keys };
  }

  const save = (env: never, id: string, doc: object) => call(putDesign as never, put(JSON.stringify({ schemaVersion: 1, id, ...doc }), id), env, { id });

  it('refuses a request with no token, because IDs are read capabilities', async () => {
    const { env, bucket } = await signedIn();
    await bucket.put(`designs/${ID}.json`, new ArrayBuffer(1));
    const response = await call(listDesigns as never, request(), env);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain(ID);
  });

  it('refuses a token for another application', async () => {
    const { env, keys } = await signedIn();
    const response = await call(listDesigns as never, request(await keys.sign({ audience: 'another-app' })), env);
    expect(response.status).toBe(401);
  });

  it('accepts the owner, and a preview token, which can read but not write', async () => {
    const { env, keys } = await signedIn();
    expect((await call(listDesigns as never, request(await keys.sign()), env)).status).toBe(200);
    expect((await call(listDesigns as never, request(await keys.sign({ audience: 'preview-aud' })), env)).status).toBe(200);
  });

  it('lists names and times, newest first, and is never cached', async () => {
    const { env, keys } = await signedIn();
    await save(env as never, ID, { name: 'Older', updatedAt: '2026-01-01T00:00:00.000Z' });
    await save(env as never, OTHER, { name: 'Café 🪑 "newer"', updatedAt: '2026-02-01T00:00:00.000Z' });
    const response = await call(listDesigns as never, request(await keys.sign()), env);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual([
      { id: OTHER, name: 'Café 🪑 "newer"', updatedAt: '2026-02-01T00:00:00.000Z' },
      { id: ID, name: 'Older', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
  });

  it('follows every page of a long listing', async () => {
    const { env, keys, bucket } = await signedIn();
    bucket.pageSize = 1;
    await save(env as never, ID, { name: 'One' });
    await save(env as never, OTHER, { name: 'Two' });
    const response = await call(listDesigns as never, request(await keys.sign()), env);
    expect(await response.json()).toHaveLength(2);
  });

  it('shows an object saved before names were recorded, using its upload time', async () => {
    const { env, keys, bucket } = await signedIn();
    await bucket.put(`designs/${ID}.json`, new ArrayBuffer(1));
    const [summary] = (await (await call(listDesigns as never, request(await keys.sign()), env)).json()) as { name: string; updatedAt: string }[];
    expect(summary).toEqual({ id: ID, name: '', updatedAt: bucket.objects.get(`designs/${ID}.json`)!.uploaded.toISOString() });
  });

  it('leaves out anything that is not a design', async () => {
    const { env, keys, bucket } = await signedIn();
    await bucket.put(`designs/${ID}/snapshots/1.json`, new ArrayBuffer(1));
    await bucket.put('designs/nope.json', new ArrayBuffer(1));
    expect(await (await call(listDesigns as never, request(await keys.sign()), env)).json()).toEqual([]);
  });

  it('keeps metadata within R2\'s limit however long the name, and stores the full document', async () => {
    const { env, bucket } = await signedIn();
    const name = '🪑'.repeat(5000);
    expect((await save(env as never, ID, { name })).status).toBe(204);
    const stored = bucket.objects.get(`designs/${ID}.json`)!;
    expect(JSON.stringify(stored.customMetadata).length).toBeLessThan(2048);
    expect(new TextDecoder().decode(stored.bytes)).toContain(name);
  });

  it('survives a name that cannot be percent-encoded', async () => {
    const { env, keys } = await signedIn();
    const body = `{"schemaVersion":1,"id":"${ID}","name":"\\ud83d"}`;
    expect((await call(putDesign as never, put(body), env, { id: ID })).status).toBe(204);
    const [summary] = (await (await call(listDesigns as never, request(await keys.sign()), env)).json()) as { name: string }[];
    expect(summary!.name).toBe('');
  });
});

describe('GET /api/designs/:id', () => {
  it('answers 404 for an unknown design', async () => {
    const response = await call(getDesign as never, new Request(url()), createEnv().env, { id: ID });
    expect(response.status).toBe(404);
  });

  it('answers 400 for a malformed id without touching storage', async () => {
    const { env, bucket } = createEnv();
    await bucket.put('designs/../secret.json', new ArrayBuffer(1));
    const response = await call(getDesign as never, new Request(url('nope')), env, { id: '../secret' });
    expect(response.status).toBe(400);
  });
});

describe('PUT /api/designs/:id validation', () => {
  it.each([
    ['invalid JSON', '{nope'],
    ['a non-object', '[1]'],
    ['null', 'null'],
    ['a mismatched id', JSON.stringify({ schemaVersion: 1, id: 'other' })],
    ['a missing schemaVersion', JSON.stringify({ id: ID })],
  ])('answers 400 for %s', async (_name, body) => {
    const { env, bucket } = createEnv();
    const response = await call(putDesign as never, put(body), env, { id: ID });
    expect(response.status).toBe(400);
    expect(bucket.objects.size).toBe(0);
  });

  it('answers 400 for a malformed id', async () => {
    const response = await call(putDesign as never, put('{}', 'bad'), createEnv().env, { id: 'bad' });
    expect(response.status).toBe(400);
  });

  it('answers 400 for invalid UTF-8', async () => {
    const response = await call(putDesign as never, put(new Uint8Array([0xff, 0xfe])), createEnv().env, { id: ID });
    expect(response.status).toBe(400);
  });

  it('answers 413 above 1 MiB, by declared and by actual size', async () => {
    const { env } = createEnv();
    const big = JSON.stringify({ schemaVersion: 1, id: ID, name: 'x'.repeat(1024 * 1024) });
    expect((await call(putDesign as never, put(big), env, { id: ID })).status).toBe(413);
    const declared = put('{}', ID, { 'Content-Length': String(2 * 1024 * 1024) });
    expect((await call(putDesign as never, declared, env, { id: ID })).status).toBe(413);
  });
});

describe('GET /api/catalog', () => {
  const request = (headers: HeadersInit = {}) => new Request('http://localhost/api/catalog', { headers });

  it('serves the stored catalog as JSON and always revalidates', async () => {
    const { env, bucket } = createEnv();
    await bucket.put('catalog.json', new TextEncoder().encode('[{"id":"chair"}]').buffer as ArrayBuffer);
    const response = await call(getCatalog as never, request(), env, {});
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(await response.text()).toBe('[{"id":"chair"}]');
  });

  it('answers 304 when the catalog has not changed', async () => {
    const { env, bucket } = createEnv();
    const { httpEtag } = (await bucket.put('catalog.json', new ArrayBuffer(2)))!;
    const response = await call(getCatalog as never, request({ 'If-None-Match': httpEtag }), env, {});
    expect(response.status).toBe(304);
  });

  it('answers 404 before the bucket is seeded', async () => {
    const response = await call(getCatalog as never, request(), createEnv().env, {});
    expect(response.status).toBe(404);
  });
});

describe('GET /api/assets/*', () => {
  const request = (headers: HeadersInit = {}) =>
    new Request('http://localhost/api/assets/chair/model.glb', { headers });

  async function seeded() {
    const created = createEnv();
    await created.bucket.put('assets/chair/model.glb', new Uint8Array([1, 2, 3]).buffer, {
      httpMetadata: { contentType: 'model/gltf-binary' },
    });
    await created.bucket.put('designs/private.json', new ArrayBuffer(1));
    return created;
  }

  it('serves a stored object with its content type', async () => {
    const { env } = await seeded();
    const response = await call(getAsset as never, request(), env, { path: ['chair', 'model.glb'] });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('model/gltf-binary');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('answers 304 when the ETag matches', async () => {
    const { env } = await seeded();
    const first = await call(getAsset as never, request(), env, { path: ['chair', 'model.glb'] });
    const etag = first.headers.get('ETag')!;
    const second = await call(getAsset as never, request({ 'If-None-Match': etag }), env, {
      path: ['chair', 'model.glb'],
    });
    expect(second.status).toBe(304);
  });

  it('only reads under the assets/ prefix', async () => {
    const { env } = await seeded();
    const response = await call(getAsset as never, request(), env, { path: ['..', 'designs', 'private.json'] });
    expect(response.status).toBe(404);
    expect((await call(getAsset as never, request(), env, { path: [] })).status).toBe(404);
  });
});
