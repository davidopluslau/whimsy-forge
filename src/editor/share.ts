import { putSnapshotJson, putSnapshotPreview } from '../api/snapshots';
import { type Design, snapshotOf } from '../model/design';
import { generateId } from '../model/ids';
import { linkPreviewImage, type SceneCapture } from '../scene/capture';

/**
 * Freezes the design as it now stands, including edits not saved yet, and returns its link. The
 * preview goes first, so a link is complete from the moment it exists. A preview is only an extra:
 * without one, the link still works and just posts without a picture.
 */
export async function shareDesign(design: Design, capture: SceneCapture | null): Promise<string> {
  const id = generateId();
  if (capture) {
    try {
      await putSnapshotPreview(id, await linkPreviewImage(capture));
    } catch (error) {
      console.warn('Sharing without a link preview', error);
    }
  }
  await putSnapshotJson(id, JSON.stringify(snapshotOf(design, id, capture?.currentView() ?? null)));
  return `${window.location.origin}/v/${id}`;
}
