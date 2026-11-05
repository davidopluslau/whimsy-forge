import { describe, expect, it } from 'vitest';
import { onRequestPut as putUpload } from '../../functions/api/uploads/[id]';
import { call, createEnv } from './helpers';

const ID = 'AbCdEfGhIjKlMnOpQrSt_-';
const url = (id = ID) => `http://localhost/api/uploads/${id}`;

/** The smallest bytes that pass the WebP check: a RIFF header with the WEBP form type. */
function webp(size = 16) {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WEBP'), 8);
  return bytes;
}

function put(body: BodyInit, { id = ID, type = 'image/webp' }: { id?: string; type?: string } = {}) {
  return new Request(url(id), { method: 'PUT', body, headers: { 'Content-Type': type } });
}

describe('PUT /api/uploads/:id', () => {
  it('stores a WebP photo under the asset prefix, where the asset route serves it', async () => {
    const { env, bucket } = createEnv();
    const bytes = webp(64);
    const response = await call(putUpload as never, put(bytes), env, { id: ID });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ path: `assets/uploads/${ID}.webp` });

    const stored = bucket.objects.get(`assets/uploads/${ID}.webp`);
    expect(stored?.contentType).toBe('image/webp');
    expect(stored?.bytes).toEqual(bytes);
  });

  it('never replaces an existing upload', async () => {
    const { env, bucket } = createEnv();
    await call(putUpload as never, put(webp()), env, { id: ID });
    const before = bucket.objects.get(`assets/uploads/${ID}.webp`)!.etag;

    const again = await call(putUpload as never, put(webp(32)), env, { id: ID });
    expect(again.status).toBe(409);
    expect(bucket.objects.get(`assets/uploads/${ID}.webp`)!.etag).toBe(before);
  });

  it('refuses a malformed id before touching storage', async () => {
    const { env, bucket } = createEnv();
    const response = await call(putUpload as never, put(webp(), { id: 'short' }), env, { id: 'short' });
    expect(response.status).toBe(400);
    expect(bucket.objects.size).toBe(0);
  });

  it('refuses anything that is not declared as WebP', async () => {
    const { env, bucket } = createEnv();
    const response = await call(putUpload as never, put(webp(), { type: 'image/png' }), env, { id: ID });
    expect(response.status).toBe(415);
    expect(bucket.objects.size).toBe(0);
  });

  it('refuses bytes that are not a WebP file even when declared as one', async () => {
    const { env, bucket } = createEnv();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const response = await call(putUpload as never, put(png), env, { id: ID });
    expect(response.status).toBe(415);
    expect(bucket.objects.size).toBe(0);
  });

  it('refuses uploads above 2 MiB, by declared and by actual size', async () => {
    const { env, bucket } = createEnv();
    const oversized = new Request(url(), {
      method: 'PUT',
      body: webp(2 * 1024 * 1024 + 1),
      headers: { 'Content-Type': 'image/webp', 'Content-Length': String(2 * 1024 * 1024 + 1) },
    });
    expect((await call(putUpload as never, oversized, env, { id: ID })).status).toBe(413);

    const lying = new Request(url(), { method: 'PUT', body: webp(2 * 1024 * 1024 + 1), headers: { 'Content-Type': 'image/webp' } });
    expect((await call(putUpload as never, lying, env, { id: ID })).status).toBe(413);
    expect(bucket.objects.size).toBe(0);
  });
});
