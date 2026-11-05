import { jsonError, type Env } from '../../_lib/env';

/**
 * Public read of objects under `assets/` in R2. Same-origin, so there is no CORS to manage and
 * no public bucket; the `assets/` prefix keeps the rest of the bucket out of reach.
 */
export const onRequestGet: PagesFunction<Env, 'path'> = async ({ params, request, env }) => {
  const path = Array.isArray(params.path) ? params.path.join('/') : String(params.path ?? '');
  if (!path) return jsonError(404, 'Asset not found');

  const object = await env.BUCKET.get(`assets/${path}`, { onlyIf: request.headers });
  if (!object) return jsonError(404, 'Asset not found');

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=86400');
  headers.set('X-Content-Type-Options', 'nosniff');

  // R2 returns an object without a body when the onlyIf precondition (If-None-Match) fails.
  if (!('body' in object)) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
};
