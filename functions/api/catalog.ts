import { jsonError, type Env } from '../_lib/env';

/**
 * Public read of the catalog, always revalidated so that a new import shows up without a deploy.
 * The ETag keeps those checks cheap.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const object = await env.BUCKET.get('catalog.json', { onlyIf: request.headers });
  if (!object) return jsonError(404, 'Catalog not found');

  const headers = new Headers({
    'Content-Type': 'application/json',
    ETag: object.httpEtag,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });

  // R2 returns an object without a body when the onlyIf precondition (If-None-Match) fails.
  if (!('body' in object)) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
};
