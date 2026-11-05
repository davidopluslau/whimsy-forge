import { ApiError } from './designs';

/** Stores a resized WebP photo under an id the browser chose. The server refuses an id already in use. */
export async function uploadPhoto(id: string, image: Blob): Promise<void> {
  const response = await fetch(`/api/uploads/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/webp' },
    body: image,
  });
  if (!response.ok) throw new ApiError(response.status, `Upload failed (${response.status})`);
}
