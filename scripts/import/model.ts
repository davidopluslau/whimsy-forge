// Normalizes a glTF document to meters with its pivot at bottom center, then compresses it.
import { Document, getBounds, Logger, NodeIO, type Scene, type vec3 } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

export type Axis = 'width' | 'height' | 'depth';

export type ModelOptions = {
  /** Multiplies the source's units to reach meters, such as 0.01 for a model in centimeters. */
  scale?: number;
  /** Scales uniformly so that this axis measures this many meters. Overrides `scale`. */
  fit?: { axis: Axis; meters: number };
  /** Turns the model about the vertical axis, in degrees, so that its front faces +z. */
  rotateY?: number;
  maxTriangles?: number;
  maxTextureSize?: number;
};

export const DEFAULT_MAX_TRIANGLES = 60_000;
export const DEFAULT_MAX_TEXTURE_SIZE = 1024;

/** Outside this range a model almost certainly isn't in meters, so the import asks for its size. */
const PLAUSIBLE_LARGEST_SIDE = { min: 0.02, max: 8 };

const AXIS_INDEX: Record<Axis, number> = { width: 0, height: 1, depth: 2 };

export async function createIO(): Promise<NodeIO> {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
}

function mainScene(document: Document): Scene {
  const root = document.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) throw new Error('The file has no scene.');
  return scene;
}

function measuredSize(scene: Scene): { min: vec3; max: vec3; size: vec3 } {
  const { min, max } = getBounds(scene);
  const size: vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  if (!size.every((side) => Number.isFinite(side)) || Math.max(...size) === 0) throw new Error('The file has no visible geometry.');
  return { min, max, size };
}

/** Scales the scene's content to meters under one root. `recenter` sets the pivot once it is final. */
export function normalize(document: Document, options: Pick<ModelOptions, 'scale' | 'fit' | 'rotateY'>): void {
  const root = document.getRoot();
  const scene = mainScene(document);

  // A furniture item is one still object: other scenes and any animation only add bytes.
  for (const other of root.listScenes()) if (other !== scene) other.dispose();
  for (const animation of root.listAnimations()) animation.dispose();

  const wrapper = wrapContent(document, scene);
  const halfTurn = ((options.rotateY ?? 0) * Math.PI) / 360;
  wrapper.setRotation([0, Math.sin(halfTurn), 0, Math.cos(halfTurn)]);

  const { size } = measuredSize(scene);
  const scale = options.fit ? options.fit.meters / size[AXIS_INDEX[options.fit.axis]]! : (options.scale ?? 1);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('The scale must be a positive number.');

  const largest = Math.max(...size) * scale;
  if (!options.fit && options.scale === undefined && (largest < PLAUSIBLE_LARGEST_SIDE.min || largest > PLAUSIBLE_LARGEST_SIDE.max)) {
    throw new Error(`The largest side would be ${largest.toFixed(3)} m, so the file is probably not in meters. Pass --scale, or the real size with --width, --height or --depth.`);
  }

  wrapper.setScale([scale, scale, scale]);
}

function wrapContent(document: Document, scene: Scene) {
  const wrapper = document.createNode('normalized');
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    wrapper.addChild(child);
  }
  scene.addChild(wrapper);
  return wrapper;
}

/** Moves the finished model so its pivot is exactly at bottom center. */
function recenter(document: Document): void {
  const scene = mainScene(document);
  const { min, max } = measuredSize(scene);
  wrapContent(document, scene).setTranslation([-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2]);
}

function triangleCount(document: Document): number {
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const vertices = primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')?.getCount() ?? 0;
      triangles += vertices / 3;
    }
  }
  return triangles;
}

/** Compresses with meshopt and WebP: both decode in the browser with no third-party or wasm fetch. */
export async function compress(document: Document, options: Pick<ModelOptions, 'maxTriangles' | 'maxTextureSize'>): Promise<void> {
  const maxTriangles = options.maxTriangles ?? DEFAULT_MAX_TRIANGLES;
  const maxTextureSize = options.maxTextureSize ?? DEFAULT_MAX_TEXTURE_SIZE;

  await document.transform(dedup(), flatten(), join(), weld());
  const triangles = triangleCount(document);
  if (triangles > maxTriangles) {
    await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio: maxTriangles / triangles, error: 0.002 }));
  }
  await document.transform(
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [maxTextureSize, maxTextureSize], quality: 82 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
}

const roundToMillimeter = (meters: number) => Math.round(meters * 1000) / 1000;

/** Width, height and depth in meters, and how far the pivot is from bottom center. */
export function measure(document: Document): { dimensions: [number, number, number]; pivotOffset: [number, number, number] } {
  const { min, max, size } = measuredSize(mainScene(document));
  return {
    dimensions: [roundToMillimeter(size[0]), roundToMillimeter(size[1]), roundToMillimeter(size[2])],
    pivotOffset: [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2],
  };
}

export type ProcessedModel = {
  glb: Uint8Array;
  dimensions: [number, number, number];
  triangles: number;
};

/** The whole model pipeline: reads a .glb or .gltf file and returns the finished GLB. */
export async function processModel(input: string | Document, options: ModelOptions = {}): Promise<ProcessedModel> {
  const io = await createIO();
  const document = typeof input === 'string' ? await io.read(input) : input;
  document.setLogger(new Logger(Logger.Verbosity.WARN));
  normalize(document, options);
  await compress(document, options);
  // Simplification can move the extremes, so the pivot and size are final only now.
  recenter(document);
  const { dimensions } = measure(document);

  return { glb: await io.writeBinary(document), dimensions, triangles: Math.round(triangleCount(document)) };
}
