import { isDesignId } from '../../../src/model/ids';
import { jsonError, type Env } from '../../_lib/env';

/** The browser resizes photos before upload, so this is a ceiling, not a target. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Uploads live under the asset prefix, so GET /api/assets/uploads/<id>.webp serves them. */
const uploadKey = (id: string) => `assets/uploads/${id}.webp`;

/** A WebP file is a RIFF container whose form type is WEBP. Checking the bytes stops other files being stored as images. */
function isWebp(bytes: Uint8Array): boolean {
  const text = (start: number) => String.fromCharCode(...bytes.subarray(start, start + 4));
  return bytes.byteLength >= 12 && text(0) === 'RIFF' && text(8) === 'WEBP';
}

/**
 * Stores one photo for a picture or rug. The owner-only check is in `api/_middleware.ts`. An id that
 * is already taken answers 409, so an upload can never replace an existing asset.
 */
export const onRequestPut: PagesFunction<Env, 'id'> = async ({ params, request, env }) => {
  const id = String(params.id);
  if (!isDesignId(id)) return jsonError(400, 'Invalid upload id');

  if (request.headers.get('Content-Type') !== 'image/webp') return jsonError(415, 'Uploads must be WebP images');
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_UPLOAD_BYTES) return jsonError(413, 'Upload is too large');

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return jsonError(413, 'Upload is too large');
  if (!isWebp(bytes)) return jsonError(415, 'Upload is not a WebP image');

  const key = uploadKey(id);
  if (await env.BUCKET.head(key)) return jsonError(409, 'Upload already exists');

  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: 'image/webp' } });
  return Response.json({ path: key }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
};
