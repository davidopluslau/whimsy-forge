import { DoubleSide, type Material, type Object3D, type Texture } from 'three';

/** Uncompressed RGBA, plus a third again for mipmaps: what a texture really takes on the GPU. */
const BYTES_PER_PIXEL = (4 * 4) / 3;

const GLASS_OPACITY = 0.3;

const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const;

type Sized = { width: number; height: number };

/** The size to draw an image at to fit under `limit`, keeping its shape. It never grows one. */
export function fittedSize(width: number, height: number, limit: number): Sized {
  const longest = Math.max(width, height);
  if (longest <= limit) return { width, height };
  const scale = limit / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** What a set of images takes on the GPU, in megabytes. Each counts once, however many materials share it. */
export function gpuMegabytes(images: Iterable<Sized>): number {
  let pixels = 0;
  for (const { width, height } of images) pixels += width * height;
  return (pixels * BYTES_PER_PIXEL) / (1024 * 1024);
}

function texturesOf(material: Material): Texture[] {
  const slots = material as unknown as Partial<Record<(typeof TEXTURE_SLOTS)[number], Texture | null>>;
  return TEXTURE_SLOTS.flatMap((slot) => slots[slot] ?? []);
}

function materialsOf(object: Object3D): Material[] {
  const { material } = object as unknown as { material?: Material | Material[] };
  return material === undefined ? [] : Array.isArray(material) ? material : [material];
}

function shrink(texture: Texture, limit: number) {
  const image = texture.image as (CanvasImageSource & Sized) | null | undefined;
  if (!image?.width || !image.height) return;
  const { width, height } = fittedSize(image.width, image.height, limit);
  if (width === image.width && height === image.height) return;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(image, 0, 0, width, height);
  texture.image = canvas;
  texture.needsUpdate = true;
}

/**
 * Prepares a loaded model for the scene's budget. Textures over `limit` are drawn smaller: uncompressed, a
 * phone's memory runs out long before its frame rate does, and on its small screen the difference is hard to
 * see. Double-sided transparent materials are drawn in one pass instead of two. Glass that lets light through
 * becomes plain see-through glass: three.js draws the whole scene a second time, every frame, for any
 * transmissive material in view, so one small pane in a wall lamp would double the cost of the room.
 * Materials and textures are shared with every copy of the model, so all this is safe to repeat.
 */
export function fitModelToBudget(model: Object3D, limit: number) {
  model.traverse((object) => {
    for (const material of materialsOf(object)) {
      const glass = material as Material & { transmission?: number };
      if (glass.transmission) {
        glass.transmission = 0;
        glass.transparent = true;
        glass.opacity = Math.min(glass.opacity, GLASS_OPACITY);
        glass.needsUpdate = true;
      }
      if (material.transparent && material.side === DoubleSide) material.forceSinglePass = true;
      for (const texture of texturesOf(material)) shrink(texture, limit);
    }
  });
}

/** What the scene's textures take on the GPU, in megabytes. */
export function sceneTextureMegabytes(scene: Object3D): number {
  const images = new Set<Sized>();
  scene.traverse((object) => {
    for (const material of materialsOf(object)) {
      for (const texture of texturesOf(material)) {
        const image = texture.image as Sized | null | undefined;
        if (image?.width && image.height) images.add(image);
      }
    }
  });
  return gpuMegabytes(images);
}
