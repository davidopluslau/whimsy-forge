import { describe, expect, it } from 'vitest';
import { onRequestGet as getAsset } from '../../functions/api/assets/[[path]]';
import { onRequestGet as getDesign, onRequestPut as putDesign } from '../../functions/api/designs/[id]';
import { call, createEnv } from './helpers';

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
