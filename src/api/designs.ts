import { copiedDesign, renamedDesign } from '../model/design';
import { generateId } from '../model/ids';
import { parseDesign } from '../model/migrate';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type StoredDesign = { json: string; etag: string | null };
export type DesignSummary = { id: string; name: string; updatedAt: string };

/** Browsers refuse a keepalive request over 64 KiB. Most designs fit, so a save survives its tab closing. */
const MAX_KEEPALIVE_BYTES = 60 * 1024;

const designUrl = (id: string) => `/api/designs/${encodeURIComponent(id)}`;

/**
 * Saves a design and returns its new ETag. With `etag`, the save happens only if the stored design
 * still has that tag; otherwise it throws an ApiError with status 412.
 */
export async function putDesignJson(id: string, json: string, etag: string | null = null): Promise<string | null> {
  const response = await fetch(designUrl(id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) },
    body: json,
    keepalive: new TextEncoder().encode(json).length <= MAX_KEEPALIVE_BYTES,
  });
  if (!response.ok) throw new ApiError(response.status, `Save failed (${response.status})`);
  return response.headers.get('ETag');
}

/** Returns the stored text; pass it through `parseDesign` to get a migrated Design. */
export async function getDesignJson(id: string): Promise<StoredDesign> {
  const response = await fetch(designUrl(id));
  if (!response.ok) throw new ApiError(response.status, `Load failed (${response.status})`);
  return { json: await response.text(), etag: response.headers.get('ETag') };
}

export async function listDesigns(): Promise<DesignSummary[]> {
  const response = await fetch('/api/designs');
  if (!response.ok) throw new ApiError(response.status, `Could not list designs (${response.status})`);
  return (await response.json()) as DesignSummary[];
}

export async function deleteDesign(id: string): Promise<void> {
  const response = await fetch(designUrl(id), { method: 'DELETE' });
  if (!response.ok) throw new ApiError(response.status, `Delete failed (${response.status})`);
}

/** Renames a stored design. Throws if it can't be read, including one from a newer schema. */
export async function renameStoredDesign(id: string, name: string): Promise<void> {
  const { json, etag } = await getDesignJson(id);
  const design = parseDesign(json);
  const renamed = renamedDesign(design, name);
  if (renamed === design) return;
  await putDesignJson(id, JSON.stringify({ ...renamed, updatedAt: new Date().toISOString() }), etag);
}

/** Saves a copy of a stored design under a new id, and returns that id. */
export async function duplicateStoredDesign(id: string): Promise<string> {
  const { json } = await getDesignJson(id);
  const copy = copiedDesign(parseDesign(json), generateId(), new Date().toISOString());
  await putDesignJson(copy.id, JSON.stringify(copy));
  return copy.id;
}
