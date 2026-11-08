// Normalizes a glTF document to meters with its pivot at bottom center, then compresses it.
import { Document, getBounds, Logger, type mat4, type Mesh, type Node, NodeIO, type Scene, type vec3 } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, meshopt, prune, simplify, textureCompress, transformMesh, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

export type Axis = 'width' | 'height' | 'depth';
export const AXES: readonly Axis[] = ['width', 'height', 'depth'];

/** Real-world sizes in meters, after any turn: width is x, height is y and depth is z. */
export type FitTarget = Partial<Record<Axis, number>>;

export type ModelOptions = {
  /** Multiplies the source's units to reach meters, such as 0.01 for a model in centimeters. */
  scale?: number;
  /**
   * The real size to fit, which overrides `scale`. With one axis the model scales uniformly. With two
   * or three, each given axis is fitted exactly and an axis left out takes their average scale.
   */
  fit?: FitTarget;
  /**
   * How far a fit to two or three axes may change the model's proportions, as a fraction: the largest
   * axis scale may be at most this much more than the smallest. Default `DEFAULT_MAX_STRETCH`.
   */
  maxStretch?: number;
  /** Turns the model about the vertical axis, in degrees, so that its front faces +z. */
  rotateY?: number;
  maxTriangles?: number;
  maxTextureSize?: number;
};

export const DEFAULT_MAX_TRIANGLES = 60_000;
export const DEFAULT_MAX_TEXTURE_SIZE = 1024;
/**
 * A listing's W x H x D may differ a little from a generated model's proportions. More than this
 * means the model is wrong rather than the listing, so it should be retried rather than squashed.
 */
export const DEFAULT_MAX_STRETCH = 0.15;

/** Outside this range a model almost certainly isn't in meters, so the import asks for its size. */
const PLAUSIBLE_LARGEST_SIDE = { min: 0.02, max: 8 };

const IDENTITY: mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

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

/** How a fit scaled the model, and how far it changed the model's proportions. */
export type FitReport = {
  /** The sizes asked for, in meters. */
  target: FitTarget;
  /** The scale applied along width, height and depth. */
  scales: [number, number, number];
  /**
   * How far each axis was stretched (positive) or squashed (negative) against a uniform scale, as a
   * fraction: 0.05 means 5 % longer than the model's own proportions.
   */
  stretch: [number, number, number];
  /** The largest axis scale over the smallest, minus one: 0 for a uniform fit. */
  distortion: number;
  /**
   * How far each given axis of the finished model is from its target, in meters, or `null` for an
   * axis that wasn't given. Simplification can move the extremes, so this is measured at the end.
   */
  error: [number | null, number | null, number | null];
};

export type FitPlan = Omit<FitReport, 'error'>;

export function describeTarget(target: FitTarget): string {
  return AXES.filter((axis) => target[axis] !== undefined)
    .map((axis) => `${axis} ${target[axis]} m`)
    .join(', ');
}

const signedPercent = (fraction: number) => `${fraction >= 0 ? '+' : '-'}${Math.abs(fraction * 100).toFixed(1)} %`;

/** One line per axis, for the import's output: "width +2.0 %, height -1.0 %, depth -1.0 %". */
export function describeStretch(stretch: readonly number[]): string {
  return AXES.map((axis, index) => `${axis} ${signedPercent(stretch[index]!)}`).join(', ');
}

/**
 * The scale along each axis that fits a model measuring `size` (meters, after any turn) to `target`.
 * An axis left out of the target takes the geometric mean of the given axes' scales, the uniform
 * scale they stretch away from evenly. Throws when the stretch is over `maxStretch`.
 */
export function planFit(size: readonly number[], target: FitTarget, maxStretch = DEFAULT_MAX_STRETCH): FitPlan {
  const given = AXES.filter((axis) => target[axis] !== undefined);
  if (given.length === 0) throw new Error('A fit needs at least one of width, height and depth.');
  if (!(maxStretch >= 0)) throw new Error('The stretch limit must be zero or more.');

  const axisScales = AXES.map((axis, index) => {
    const meters = target[axis];
    if (meters === undefined) return undefined;
    if (!(meters > 0) || !Number.isFinite(meters)) throw new Error(`The ${axis} to fit must be a positive number of meters.`);
    const side = size[index]!;
    if (!(side > 0)) throw new Error(`The model is flat along its ${axis}, so it can't be fitted to one. Leave that size out.`);
    return meters / side;
  });

  const known = axisScales.filter((scale): scale is number => scale !== undefined);
  const uniform = Math.exp(known.reduce((sum, scale) => sum + Math.log(scale), 0) / known.length);
  const scales = axisScales.map((scale) => scale ?? uniform) as [number, number, number];
  const stretch = scales.map((scale) => scale / uniform - 1) as [number, number, number];
  const distortion = Math.max(...scales) / Math.min(...scales) - 1;

  // A tiny allowance so that a stretch of exactly the limit passes despite rounding.
  if (distortion > maxStretch + 1e-9) {
    throw new Error(
      `Fitting ${describeTarget(target)} would change the model's proportions by ${(distortion * 100).toFixed(1)} % ` +
        `(${describeStretch(stretch)}), more than the ${(maxStretch * 100).toFixed(0)} % limit. The model's shape is probably wrong: ` +
        'retry it, check that each size is on the right axis and that --rotate-y faces it forward, or pass --max-stretch to allow more.',
    );
  }

  return { target: { ...target }, scales, stretch, distortion };
}

/**
 * Bakes every node's world transform into its mesh's vertices and clears the transforms. A scale that
 * differs by axis then applies along the room's axes: over a turned node it would shear, which a glTF
 * node's translation, rotation and scale can't express.
 */
function bakeTransforms(document: Document, scene: Scene): void {
  if (document.getRoot().listSkins().length > 0) {
    throw new Error("A skinned model can't be fitted to more than one size: pass only one of --width, --height and --depth.");
  }

  const nodes: Node[] = [];
  scene.traverse((node) => nodes.push(node));
  const meshNodes = nodes.filter((node) => node.getMesh());

  // Give each node its own copy of a shared mesh before baking any, since baking changes vertices in
  // place, and read every world matrix before clearing any.
  const claimed = new Set<Mesh>();
  for (const node of meshNodes) {
    const mesh = node.getMesh()!;
    if (claimed.has(mesh)) node.setMesh(mesh.clone());
    claimed.add(mesh);
  }
  const worlds = meshNodes.map((node) => node.getWorldMatrix());
  meshNodes.forEach((node, index) => transformMesh(node.getMesh()!, worlds[index]!));
  for (const node of nodes) node.setMatrix(IDENTITY);
}

/**
 * Scales the scene's content to meters under one root. `recenter` sets the pivot once it is final.
 * Returns how a fit scaled the model, or `undefined` when there was no fit.
 */
export function normalize(document: Document, options: Pick<ModelOptions, 'scale' | 'fit' | 'rotateY' | 'maxStretch'>): FitPlan | undefined {
  const root = document.getRoot();
  const scene = mainScene(document);

  // A furniture item is one still object: other scenes and any animation only add bytes.
  for (const other of root.listScenes()) if (other !== scene) other.dispose();
  for (const animation of root.listAnimations()) animation.dispose();

  const fitAxes = AXES.filter((axis) => options.fit?.[axis] !== undefined);
  const wrapper = wrapContent(document, scene);
  const halfTurn = ((options.rotateY ?? 0) * Math.PI) / 360;
  wrapper.setRotation([0, Math.sin(halfTurn), 0, Math.cos(halfTurn)]);
  if (fitAxes.length > 1) bakeTransforms(document, scene);

  const { size } = measuredSize(scene);

  if (options.fit && fitAxes.length > 0) {
    const plan = planFit(size, options.fit, options.maxStretch);
    // A new root above the turn, so each scale applies along the room's axis of that name.
    wrapContent(document, scene).setScale(plan.scales);
    return plan;
  }

  const scale = options.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('The scale must be a positive number.');

  const largest = Math.max(...size) * scale;
  if (options.scale === undefined && (largest < PLAUSIBLE_LARGEST_SIDE.min || largest > PLAUSIBLE_LARGEST_SIDE.max)) {
    throw new Error(`The largest side would be ${largest.toFixed(3)} m, so the file is probably not in meters. Pass --scale, or the real size with --width, --height or --depth.`);
  }

  wrapper.setScale([scale, scale, scale]);
  return undefined;
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
  /** Present when the model was fitted to a real size. */
  fit?: FitReport;
};

/** The whole model pipeline: reads a .glb or .gltf file and returns the finished GLB. */
export async function processModel(input: string | Document, options: ModelOptions = {}): Promise<ProcessedModel> {
  const io = await createIO();
  const document = typeof input === 'string' ? await io.read(input) : input;
  document.setLogger(new Logger(Logger.Verbosity.WARN));
  const plan = normalize(document, options);
  await compress(document, options);
  // Simplification can move the extremes, so the pivot and size are final only now.
  recenter(document);
  const { dimensions } = measure(document);
  const glb = await io.writeBinary(document);
  const triangles = Math.round(triangleCount(document));
  if (!plan) return { glb, dimensions, triangles };

  const error = AXES.map((axis, index) => {
    const meters = plan.target[axis];
    return meters === undefined ? null : roundToMillimeter(dimensions[index]! - meters);
  }) as FitReport['error'];
  return { glb, dimensions, triangles, fit: { ...plan, error } };
}
