import { PRIVATE_ASSET_ROOT, PRIVATE_CATALOG_KEY } from '../../src/model/catalog';
import { canOpenEditor } from './access';
import { jsonError, type Env } from './env';

export { PRIVATE_ASSET_ROOT, PRIVATE_CATALOG_KEY };

/**
 * A private asset id anywhere in a document, as an import makes one. The check is on the raw text, so it
 * also catches a field that a later change might add, and it costs no parse of the items.
 */
const PRIVATE_ID_IN_JSON = /"private-[A-Za-z0-9_-]{22}"/;

export const mentionsPrivateAsset = (json: string) => PRIVATE_ID_IN_JSON.test(json);

/**
 * Answers a read of the personal catalog or one of its files. Like the design list, it needs a token
 * even though it's a GET, which `api/_middleware.ts` would pass. A preview's token is enough: previews
 * show the owner the editor, and can still never write.
 */
export async function readPrivateObject(request: Request, env: Env, key: string, cacheControl: string): Promise<Response> {
  if (!(await canOpenEditor(request, env))) return jsonError(401, 'Unauthorized');

  const object = await env.BUCKET.get(key, { onlyIf: request.headers });
  if (!object) return jsonError(404, 'Not found');

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  // `private` keeps the response out of any shared cache: only the owner's browser may keep it.
  headers.set('Cache-Control', cacheControl);
  headers.set('X-Content-Type-Options', 'nosniff');

  // R2 returns an object without a body when the onlyIf precondition (If-None-Match) fails.
  if (!('body' in object)) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
}
