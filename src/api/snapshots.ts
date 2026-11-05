import { ApiError } from './designs';

const snapshotUrl = (id: string) => `/api/snapshots/${encodeURIComponent(id)}`;

/** Freezes a design. The server refuses an id already in use, so this can't change an existing link. */
export async function putSnapshotJson(id: string, json: string): Promise<void> {
  const response = await fetch(snapshotUrl(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: json });
  if (!response.ok) throw new ApiError(response.status, `Could not create the snapshot (${response.status})`);
}

export async function putSnapshotPreview(id: string, image: Blob): Promise<void> {
  const response = await fetch(`${snapshotUrl(id)}/preview`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: image });
  if (!response.ok) throw new ApiError(response.status, `Could not store the preview (${response.status})`);
}

/** Returns the stored text; pass it through `parseDesign` to get a migrated Design. */
export async function getSnapshotJson(id: string): Promise<string> {
  const response = await fetch(snapshotUrl(id));
  if (!response.ok) throw new ApiError(response.status, `Load failed (${response.status})`);
  return response.text();
}
