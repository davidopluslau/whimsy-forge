import { isDesignId } from '../../../src/model/ids';
import { readDesignBody, summaryMetadata } from '../../_lib/designs';
import { jsonError, type Env } from '../../_lib/env';
import { mentionsPrivateAsset } from '../../_lib/private';
import { snapshotKey } from '../../_lib/snapshots';

/** The public read behind a share link. A snapshot never changes, so browsers may keep it for a day. */
export const onRequestGet: PagesFunction<Env, 'id'> = async ({ params, request, env }) => {
  const id = String(params.id);
  if (!isDesignId(id)) return jsonError(400, 'Invalid snapshot id');

  const object = await env.BUCKET.get(snapshotKey(id), { onlyIf: request.headers });
  if (!object) return jsonError(404, 'Snapshot not found');

  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    ETag: object.httpEtag,
  });
  // R2 returns an object without a body when the onlyIf precondition (If-None-Match) fails.
  if (!('body' in object)) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
};

/**
 * Freezes one copy of a design. The owner-only check is in `api/_middleware.ts`. An id that is already
 * taken answers 409, so nothing can change a snapshot once its link exists. The body's id must be the
 * snapshot's: that keeps the live design's id, which can read the design, out of what viewers receive.
 */
export const onRequestPut: PagesFunction<Env, 'id'> = async ({ params, request, env }) => {
  const id = String(params.id);
  if (!isDesignId(id)) return jsonError(400, 'Invalid snapshot id');

  const body = await readDesignBody(request, id);
  if (body instanceof Response) return body;
  // The editor puts a stand-in in place of every private asset. This catches a client that doesn't.
  if (mentionsPrivateAsset(new TextDecoder().decode(body.bytes))) return jsonError(400, 'A snapshot may not name a private asset');

  const key = snapshotKey(id);
  if (await env.BUCKET.head(key)) return jsonError(409, 'Snapshot already exists');

  await env.BUCKET.put(key, body.bytes, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: summaryMetadata(body.doc),
  });
  return new Response(null, { status: 201, headers: { 'Cache-Control': 'no-store' } });
};
