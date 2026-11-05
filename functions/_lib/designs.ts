import { isDesignId } from '../../src/model/ids';
import { jsonError } from './env';

const PREFIX = 'designs/';
const SUFFIX = '.json';
/** Comfortably under R2's 2 KiB custom metadata limit: at most 12 bytes per encoded code point. */
const MAX_NAME_CODE_POINTS = 100;
const MAX_DESIGN_BYTES = 1024 * 1024;

export const designKey = (id: string) => `${PREFIX}${id}${SUFFIX}`;

export type DesignEnvelope = { name?: unknown; updatedAt?: unknown };

function validate(text: string, id: string): { problem: string } | { doc: DesignEnvelope } {
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
 * Reads a design document from a request and checks its envelope, not its contents. Answers with the
 * error Response to send if it isn't acceptable. Store `bytes`, not a re-serialization, so a load
 * returns exactly what was saved.
 */
export async function readDesignBody(request: Request, id: string): Promise<Response | { bytes: ArrayBuffer; doc: DesignEnvelope }> {
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_DESIGN_BYTES) return jsonError(413, 'Design is too large');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_DESIGN_BYTES) return jsonError(413, 'Design is too large');

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return jsonError(400, 'Body is not valid UTF-8');
  }
  const result = validate(text, id);
  return 'problem' in result ? jsonError(400, result.problem) : { bytes, doc: result.doc };
}

/** One line of the design list. */
export type DesignSummary = { id: string; name: string; updatedAt: string };

/**
 * What the list shows, kept on the object so listing needs no read of each document. The name is
 * percent-encoded because R2's metadata is carried as HTTP headers in some paths.
 */
export function summaryMetadata(doc: { name?: unknown; updatedAt?: unknown }): Record<string, string> {
  const metadata: Record<string, string> = {};
  if (typeof doc.updatedAt === 'string') metadata.updatedAt = doc.updatedAt;
  if (typeof doc.name === 'string') {
    try {
      metadata.name = encodeURIComponent(Array.from(doc.name).slice(0, MAX_NAME_CODE_POINTS).join(''));
    } catch {
      // A lone surrogate can't be encoded. The list falls back to no name, and the document is unaffected.
    }
  }
  return metadata;
}

export function decodedName(encoded: string | undefined): string {
  try {
    return encoded ? decodeURIComponent(encoded) : '';
  } catch {
    return '';
  }
}

/** The summary of a listed object, or null if the key isn't a design. An older object has no metadata. */
export function summaryOf(object: Pick<R2Object, 'key' | 'uploaded' | 'customMetadata'>): DesignSummary | null {
  const id = object.key.slice(PREFIX.length, -SUFFIX.length);
  if (!object.key.startsWith(PREFIX) || !object.key.endsWith(SUFFIX) || !isDesignId(id)) return null;
  return {
    id,
    name: decodedName(object.customMetadata?.name),
    updatedAt: object.customMetadata?.updatedAt ?? object.uploaded.toISOString(),
  };
}

/** Lists every design, newest first, following R2's pages. */
export async function listDesignSummaries(bucket: R2Bucket): Promise<DesignSummary[]> {
  const summaries: DesignSummary[] = [];
  let cursor: string | undefined;
  do {
    // `include` must be explicit: without it, R2 leaves out custom metadata.
    const page = await bucket.list({ prefix: PREFIX, cursor, include: ['customMetadata'] });
    for (const object of page.objects) {
      const summary = summaryOf(object);
      if (summary) summaries.push(summary);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
