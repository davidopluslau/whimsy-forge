import { isDesignId } from '../../../src/model/ids';
import { designKey, readDesignBody, summaryMetadata } from '../../_lib/designs';
import { jsonError, type Env } from '../../_lib/env';

/**
 * R2 wants the bare tag. The client echoes the ETag it was given, which Cloudflare's edge marks weak
 * (`W/"…"`) when it compresses a response.
 */
const bareEtag = (header: string) => header.replace(/^W\//, '').replaceAll('"', '');

export const onRequestGet: PagesFunction<Env, 'id'> = async ({ params, env }) => {
  const id = String(params.id);
  if (!isDesignId(id)) return jsonError(400, 'Invalid design id');

  const object = await env.BUCKET.get(designKey(id));
  if (!object) return jsonError(404, 'Design not found');

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ETag: object.httpEtag,
    },
  });
};

export const onRequestPut: PagesFunction<Env, 'id'> = async ({ params, request, env }) => {
  const id = String(params.id);
  if (!isDesignId(id)) return jsonError(400, 'Invalid design id');

  const body = await readDesignBody(request, id);
  if (body instanceof Response) return body;

  const ifMatch = request.headers.get('If-Match');
  const saved = await env.BUCKET.put(designKey(id), body.bytes, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: summaryMetadata(body.doc),
    ...(ifMatch ? { onlyIf: { etagMatches: bareEtag(ifMatch) } } : {}),
  });
  // R2 answers null when the condition fails, including when the design has since been deleted.
  if (!saved) return jsonError(412, 'Design has changed since it was loaded');
  return new Response(null, { status: 204, headers: { ETag: saved.httpEtag } });
};

/** Removes the design. Idempotent: deleting one that's already gone is not an error. */
export const onRequestDelete: PagesFunction<Env, 'id'> = async ({ params, env }) => {
  const id = String(params.id);
  if (!isDesignId(id)) return jsonError(400, 'Invalid design id');
  await env.BUCKET.delete(designKey(id));
  return new Response(null, { status: 204 });
};
