import { describe, expect, it } from 'vitest';
import { onRequestGet as getSnapshot, onRequestPut as putSnapshot } from '../../functions/api/snapshots/[id]';
import { onRequestPut as putPreview } from '../../functions/api/snapshots/[id]/preview';
import { withShareTags } from '../../functions/_lib/snapshots';
import { onRequestGet as getSharePage } from '../../functions/v/[id]';
import { APP_PAGE, call, createEnv } from './helpers';

const ID = 'AbCdEfGhIjKlMnOpQrSt_-';
const OTHER_ID = 'ZyXwVuTsRqPoNmLkJiHg12';
const ORIGIN = 'https://whimsy.test';

const body = (overrides: object = {}) => JSON.stringify({ schemaVersion: 1, id: ID, name: 'Living room', updatedAt: '2026-11-05T00:00:00.000Z', ...overrides });
const put = (text: string, id = ID) => new Request(`${ORIGIN}/api/snapshots/${id}`, { method: 'PUT', body: text });
const jpeg = (size = 16) => {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff]);
  return bytes;
};
const putImage = (bytes: Uint8Array, type = 'image/jpeg') => new Request(`${ORIGIN}/api/snapshots/${ID}/preview`, { method: 'PUT', body: bytes, headers: { 'Content-Type': type } });
const sharePage = (id = ID) => new Request(`${ORIGIN}/v/${id}`);

describe('PUT /api/snapshots/:id', () => {
  it('stores the bytes it received, under a key of its own', async () => {
    const { env, bucket } = createEnv();
    const text = body();
    const response = await call(putSnapshot as never, put(text), env, { id: ID });
    expect(response.status).toBe(201);
    expect(new TextDecoder().decode(bucket.objects.get(`snapshots/${ID}.json`)!.bytes)).toBe(text);
    expect([...bucket.objects.keys()].some((key) => key.startsWith('designs/'))).toBe(false);
  });

  it('never replaces a snapshot, so a shared link stays frozen', async () => {
    const { env, bucket } = createEnv();
    await call(putSnapshot as never, put(body()), env, { id: ID });
    const before = bucket.objects.get(`snapshots/${ID}.json`)!.etag;

    const again = await call(putSnapshot as never, put(body({ name: 'Changed' })), env, { id: ID });
    expect(again.status).toBe(409);
    expect(bucket.objects.get(`snapshots/${ID}.json`)!.etag).toBe(before);
  });

  it("refuses a body that carries another id, such as the live design's", async () => {
    const { env, bucket } = createEnv();
    const response = await call(putSnapshot as never, put(body({ id: OTHER_ID })), env, { id: ID });
    expect(response.status).toBe(400);
    expect(bucket.objects.size).toBe(0);
  });

  it('refuses a malformed id, invalid JSON and an oversized body', async () => {
    const { env, bucket } = createEnv();
    expect((await call(putSnapshot as never, put(body(), 'short'), env, { id: 'short' })).status).toBe(400);
    expect((await call(putSnapshot as never, put('{nope'), env, { id: ID })).status).toBe(400);
    expect((await call(putSnapshot as never, put(body({ name: 'x'.repeat(1024 * 1024) })), env, { id: ID })).status).toBe(413);
    expect(bucket.objects.size).toBe(0);
  });
});

describe('GET /api/snapshots/:id', () => {
  it('returns the stored bytes, cacheable because they never change', async () => {
    const { env } = createEnv();
    const text = body();
    await call(putSnapshot as never, put(text), env, { id: ID });
    const response = await call(getSnapshot as never, new Request(`${ORIGIN}/api/snapshots/${ID}`), env, { id: ID });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(text);
    expect(response.headers.get('Cache-Control')).toContain('max-age');
    expect(response.headers.get('Content-Type')).toBe('application/json');
  });

  it('answers 404 when absent and 400 for a malformed id', async () => {
    const { env } = createEnv();
    expect((await call(getSnapshot as never, new Request(`${ORIGIN}/api/snapshots/${ID}`), env, { id: ID })).status).toBe(404);
    expect((await call(getSnapshot as never, new Request(`${ORIGIN}/api/snapshots/short`), env, { id: 'short' })).status).toBe(400);
  });

  it('does not read a live design through the snapshot route', async () => {
    const { env, bucket } = createEnv();
    await bucket.put(`designs/${ID}.json`, new ArrayBuffer(1));
    expect((await call(getSnapshot as never, new Request(`${ORIGIN}/api/snapshots/${ID}`), env, { id: ID })).status).toBe(404);
  });
});

describe('PUT /api/snapshots/:id/preview', () => {
  it('stores a JPEG under the asset prefix, once', async () => {
    const { env, bucket } = createEnv();
    const response = await call(putPreview as never, putImage(jpeg(64)), env, { id: ID });
    expect(response.status).toBe(201);
    expect(bucket.objects.get(`assets/snapshots/${ID}.jpg`)?.contentType).toBe('image/jpeg');
    expect((await call(putPreview as never, putImage(jpeg(32)), env, { id: ID })).status).toBe(409);
    expect(bucket.objects.get(`assets/snapshots/${ID}.jpg`)?.bytes.byteLength).toBe(64);
  });

  it('refuses anything that is not a JPEG, or is too large', async () => {
    const { env, bucket } = createEnv();
    expect((await call(putPreview as never, putImage(jpeg(), 'image/png'), env, { id: ID })).status).toBe(415);
    expect((await call(putPreview as never, putImage(new Uint8Array(16)), env, { id: ID })).status).toBe(415);
    expect((await call(putPreview as never, putImage(jpeg(2 * 1024 * 1024 + 1)), env, { id: ID })).status).toBe(413);
    expect(bucket.objects.size).toBe(0);
  });
});

describe('GET /v/:id', () => {
  it('serves the app with the tags a link preview needs', async () => {
    const { env } = createEnv();
    await call(putSnapshot as never, put(body()), env, { id: ID });
    await call(putPreview as never, putImage(jpeg()), env, { id: ID });

    const response = await call(getSharePage as never, sharePage(), env, { id: ID });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<meta property="og:title" content="Living room" />');
    expect(html).toContain(`<meta property="og:url" content="${ORIGIN}/v/${ID}" />`);
    expect(html).toContain(`<meta property="og:image" content="${ORIGIN}/api/assets/snapshots/${ID}.jpg" />`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<title>Living room · Whimsy Forge</title>');
    expect(html.match(/<meta name="description"/g)).toHaveLength(1);
  });

  it('leaves out the image when the snapshot has none', async () => {
    const { env } = createEnv();
    await call(putSnapshot as never, put(body()), env, { id: ID });
    const html = await (await call(getSharePage as never, sharePage(), env, { id: ID })).text();
    expect(html).toContain('og:title');
    expect(html).not.toContain('og:image');
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
  });

  it('still serves the app, with status 404, for a link that leads nowhere', async () => {
    const { env } = createEnv();
    for (const id of [ID, 'short']) {
      const response = await call(getSharePage as never, sharePage(id), env, { id });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe(APP_PAGE);
    }
  });

  it('still serves the app when storage fails', async () => {
    const { env, bucket } = createEnv();
    bucket.head = async () => {
      throw new Error('R2 is down');
    };
    const response = await call(getSharePage as never, sharePage(), env, { id: ID });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(APP_PAGE);
  });
});

describe('withShareTags', () => {
  const tags = { url: `${ORIGIN}/v/${ID}`, imageUrl: null };

  it('escapes the name', () => {
    const html = withShareTags(APP_PAGE, { ...tags, name: '"><script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('keeps replacement patterns in a name literal', () => {
    const html = withShareTags(APP_PAGE, { ...tags, name: "$& $' $`" });
    expect(html).toContain("<title>$&amp; $' $` · Whimsy Forge</title>");
    expect(html.match(/<html/g)).toHaveLength(1);
  });

  it('falls back when the name is empty', () => {
    expect(withShareTags(APP_PAGE, { ...tags, name: ' ' })).toContain('content="Untitled design"');
  });
});
