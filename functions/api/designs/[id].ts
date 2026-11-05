import { isDesignId } from '../../../src/model/ids';
import { jsonError, type Env } from '../../_lib/env';

const MAX_DESIGN_BYTES = 1024 * 1024;

const designKey = (id: string) => `designs/${id}.json`;

function validate(text: string, id: string): string | undefined {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return 'Body is not valid JSON';
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return 'Body must be a JSON object';
  const { id: docId, schemaVersion } = doc as Record<string, unknown>;
  if (docId !== id) return 'Body id does not match the URL';
  if (typeof schemaVersion !== 'number') return 'Body is missing schemaVersion';
  return undefined;
}

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
  const problem = validate(text, id);
  if (problem) return jsonError(400, problem);

  // Store the received bytes, not a re-serialization, so a load returns exactly what was saved.
  const saved = await env.BUCKET.put(designKey(id), bytes, {
    httpMetadata: { contentType: 'application/json' },
  });
  return new Response(null, { status: 204, headers: { ETag: saved.httpEtag } });
};
