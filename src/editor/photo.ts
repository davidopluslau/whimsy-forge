/** The longest side a photo keeps. Enough for a picture on a wall, and well under the upload limit. */
export const MAX_PHOTO_SIDE = 1600;
const WEBP_QUALITY = 0.9;

/** A photo that is ready to place: its upload id, what it becomes, its typed width, and its shape. */
export type PhotoUpload = { uploadId: string; kind: 'picture' | 'rug'; width: number; aspect: number };

/**
 * Shrinks a photo to fit `MAX_PHOTO_SIDE` and re-encodes it as WebP, which is the only format the server
 * keeps. Returns the image and its width-to-height ratio, which sets the height from the typed width.
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; aspect: number }> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not prepare the photo.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY));
  if (!blob || blob.type !== 'image/webp') throw new Error('This browser could not convert the photo to WebP.');
  return { blob, aspect: width / height };
}
