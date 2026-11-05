import { isDesignId } from '../../../../src/model/ids';
import { jsonError, type Env } from '../../../_lib/env';
import { previewKey } from '../../../_lib/snapshots';

/** The browser makes these at a fixed size, so this is a ceiling, not a target. */
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

const isJpeg = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

/**
 * Stores a snapshot's link-preview image, once. JPEG because not every messaging app's crawler reads
 * WebP. The owner-only check is in `api/_middleware.ts`, and the asset route serves it.
 */
export const onRequestPut: PagesFunction<Env, 'id'> = async ({ params, request, env }) => {
  const id = String(params.id);
  if (!isDesignId(id)) return jsonError(400, 'Invalid snapshot id');

  if (request.headers.get('Content-Type') !== 'image/jpeg') return jsonError(415, 'Previews must be JPEG images');
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_PREVIEW_BYTES) return jsonError(413, 'Preview is too large');

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_PREVIEW_BYTES) return jsonError(413, 'Preview is too large');
  if (!isJpeg(bytes)) return jsonError(415, 'Preview is not a JPEG image');

  const key = previewKey(id);
  if (await env.BUCKET.head(key)) return jsonError(409, 'Preview already exists');

  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  return new Response(null, { status: 201, headers: { 'Cache-Control': 'no-store' } });
};
