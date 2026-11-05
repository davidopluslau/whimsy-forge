import { isDesignId } from '../../../src/model/ids';
import { designKey, summaryMetadata } from '../../_lib/designs';
import { jsonError, type Env } from '../../_lib/env';

const MAX_DESIGN_BYTES = 1024 * 1024;

type Envelope = { name?: unknown; updatedAt?: unknown };

function validate(text: string, id: string): { problem: string } | { doc: Envelope } {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { problem: 'Body is not valid JSON' };
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return { problem: 'Body must be a JSON object' };
  const { id: docId, schemaVersion } = doc as Record<string, unknown>;
  if (docId !== id) return { problem: 'Body id does not match the URL' };
  if (typeof schemaVersion !== 'number') return { problem: 'Body is missing schemaVersion' };
  return { doc };
}

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

  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_DESIGN_BYTES) {
    return jsonError(413, 'Design is too large');
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_DESIGN_BYTES) return jsonError(413, 'Design is too large');

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return jsonError(400, 'Body is not valid UTF-8');
  }
  const result = validate(text, id);
  if ('problem' in result) return jsonError(400, result.problem);

  const ifMatch = request.headers.get('If-Match');
  // Store the received bytes, not a re-serialization, so a load returns exactly what was saved.
  const saved = await env.BUCKET.put(designKey(id), bytes, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: summaryMetadata(result.doc),
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
