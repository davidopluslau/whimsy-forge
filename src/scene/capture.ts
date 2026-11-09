import { PerspectiveCamera, Vector2, Vector3, type Camera, type Object3D, type Scene, type WebGLRenderer } from 'three';
import type { CameraView } from './cameraViews';

/** A saved image is at least this wide or tall, however small the pane it came from. */
const EXPORT_LONG_SIDE = 1920;
/** Past this, phones and small GPUs may refuse the canvas. */
const MAX_EXPORT_SIDE = 4096;
/** The shape to save when the 3D pane is hidden and has no shape of its own. */
const HIDDEN_PANE_ASPECT = 16 / 9;

const LINK_PREVIEW = { width: 1200, height: 630, type: 'image/jpeg', quality: 0.82 } as const;

/** Set this in `userData` on what must not appear in a saved image, such as gizmos. */
export const CAPTURE_HIDDEN = { captureHidden: true };

/**
 * Set this in `userData` on what shows a private asset: its model and its lamp's light. A picture for anyone
 * else, such as a share's link preview, leaves it out and shows what's marked `PRIVATE_STAND_IN_MARK`.
 */
export const PRIVATE_CONTENT = { privateContent: true };
/** Set this in `userData` on a hidden box that takes a private asset's place in a picture for someone else. */
export const PRIVATE_STAND_IN_MARK = { privateStandIn: true };

export type CaptureOptions = {
  width: number;
  height: number;
  view: CameraView;
  /** Draw private assets as the viewer of a share link sees them: as boxes, with no light or shadow of their own. */
  redactPrivate?: boolean;
};

/**
 * Hides what a saved picture leaves out and, with `redactPrivate`, swaps each private asset for its stand-in.
 * `restore` puts every object back as it was. `redacted` says whether anything private was changed.
 */
export function prepareForCapture(scene: Object3D, redactPrivate: boolean): { restore: () => void; redacted: boolean } {
  const changed: { object: Object3D; visible: boolean }[] = [];
  let redacted = false;
  const show = (object: Object3D, visible: boolean, isPrivate: boolean) => {
    if (object.visible === visible) return;
    changed.push({ object, visible: object.visible });
    object.visible = visible;
    redacted ||= isPrivate;
  };
  scene.traverse((object) => {
    if (object.userData.captureHidden) show(object, false, false);
    if (redactPrivate && object.userData.privateContent) show(object, false, true);
    if (redactPrivate && object.userData.privateStandIn) show(object, true, true);
  });
  return {
    redacted,
    restore: () => {
      for (const { object, visible } of changed) object.visible = visible;
    },
  };
}

/**
 * Draws the scene once into a new 2D canvas, at any size, without changing what's on screen. All of it
 * runs in one task: the browser shows nothing until the task ends, and the WebGL buffer can't be cleared
 * between the render and the copy. That's why the renderer doesn't need `preserveDrawingBuffer`, which
 * would slow every frame on a phone. It also works while the pane is hidden, since the buffer is resized.
 */
export function renderToCanvas(gl: WebGLRenderer, scene: Scene, camera: Camera, { width, height, view, redactPrivate = false }: CaptureOptions): HTMLCanvasElement {
  const shot = new PerspectiveCamera((camera as PerspectiveCamera).fov, width / height, (camera as PerspectiveCamera).near, (camera as PerspectiveCamera).far);
  shot.position.set(...view.position);
  shot.lookAt(new Vector3(...view.target));
  shot.updateMatrixWorld();

  const { restore, redacted } = prepareForCapture(scene, redactPrivate);
  // The shadow map is drawn only when something changes, so a hidden model would still cast its shadow.
  const redrawShadows = redacted;

  const size = gl.getSize(new Vector2());
  const pixelRatio = gl.getPixelRatio();
  try {
    gl.setPixelRatio(1);
    gl.setSize(width, height, false);
    if (redrawShadows) gl.shadowMap.needsUpdate = true;
    gl.render(scene, shot);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(gl.domElement, 0, 0);
    return canvas;
  } finally {
    restore();
    if (redrawShadows) gl.shadowMap.needsUpdate = true;
    gl.setPixelRatio(pixelRatio);
    gl.setSize(size.x, size.y, false);
    // `setSize` rounds a fractional pane width but the scene's normal viewport is rounded down, which
    // would leave the picture a pixel too wide. This puts back the normal one.
    gl.setRenderTarget(null);
    // Resizing cleared the buffer, so what was on screen must be drawn again before the task ends.
    if (size.x > 0 && size.y > 0) gl.render(scene, camera);
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode the image'))), type, quality);
  });
}

/** What the page around a scene can ask of it, once the scene exists. */
export type SceneCapture = {
  /** Where the camera is looking, or null while the 3D pane is hidden and it can't be seen. */
  currentView: () => CameraView | null;
  /** The shape of the 3D pane and its size in buffer pixels, or null while it is hidden. */
  paneSize: () => { width: number; height: number } | null;
  /** Renders the current view, or a framed one if the pane is hidden. */
  render: (width: number, height: number, options?: Pick<CaptureOptions, 'redactPrivate'>) => HTMLCanvasElement;
};

/** A PNG of what the 3D pane shows. A hidden pane gives a framed view of the room. */
export function viewImage(capture: SceneCapture): Promise<Blob> {
  const pane = capture.paneSize();
  const aspect = pane ? pane.width / pane.height : HIDDEN_PANE_ASPECT;
  const paneLongSide = pane ? Math.max(pane.width, pane.height) : 0;
  const longSide = Math.min(Math.max(paneLongSide, EXPORT_LONG_SIDE), MAX_EXPORT_SIDE);
  const width = Math.round(aspect >= 1 ? longSide : longSide * aspect);
  const height = Math.round(aspect >= 1 ? longSide / aspect : longSide);
  return canvasBlob(capture.render(width, height), 'image/png');
}

/**
 * The image shown when a share link is posted in a messaging app. Anyone can fetch it, so private assets are
 * drawn as the link's viewer sees them.
 */
export function linkPreviewImage(capture: SceneCapture): Promise<Blob> {
  return canvasBlob(capture.render(LINK_PREVIEW.width, LINK_PREVIEW.height, { redactPrivate: true }), LINK_PREVIEW.type, LINK_PREVIEW.quality);
}

/** A file name from a design's name, safe on every system. */
export function imageFileName(designName: string): string {
  const base = designName
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '');
  return `${base || 'design'}.png`;
}

/** Hands the browser a file to save. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Not at once: some browsers start the download only after this task.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
