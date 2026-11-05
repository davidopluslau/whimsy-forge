// Turns one source file into finished files under seed/assets and an entry in seed/catalog.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import sharp from 'sharp';
import { type CatalogAsset, type Category, isCatalogAsset, isHttpUrl, type LampLight, type Mount } from '../../src/model/catalog.ts';
import { type ModelOptions, processModel } from './model.ts';
import { THUMBNAIL_SIZE, type ThumbnailRenderer } from './thumbnail.ts';

export const MODEL_EXTENSIONS = ['.glb', '.gltf'];
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

const MAX_IMAGE_SIZE = 2048;
const PICTURE_FRAME_DEPTH = 0.03;
const RUG_THICKNESS = 0.01;

export type ImportRequest = {
  file: string;
  id?: string;
  name?: string;
  category: Category;
  tags?: string[];
  mount?: Mount;
  license: string;
  sourceUrl: string;
  /** Whether an asset with this id may be overwritten. */
  replace?: boolean;
  /** For a model. */
  model?: ModelOptions;
  /** For an image: required real-world width in meters. */
  imageWidth?: number;
  /** For a model that gives light. */
  light?: LampLight;
};

export type ImportResult = {
  asset: CatalogAsset;
  /** Absolute paths mapped to their R2 keys, in upload order. */
  files: { path: string; key: string }[];
};

export function slugify(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const titleFromFile = (slug: string) => slug.replaceAll('-', ' ').replace(/^./, (first) => first.toUpperCase());

export function readCatalog(seedDir: string): unknown[] {
  return JSON.parse(readFileSync(join(seedDir, 'catalog.json'), 'utf8')) as unknown[];
}

/** Two-space JSON, with each number array on one line so entries stay readable in a diff. */
export function formatCatalog(catalog: readonly unknown[]): string {
  return `${JSON.stringify(catalog, null, 2).replace(/\[\s+((?:-?[\d.]+,?\s*)+?)\s*\]/g, (_, numbers: string) => `[${numbers.trim().replace(/\s+/g, ' ')}]`)}\n`;
}

/** Adds the entry, or replaces the one with the same id where it stands. */
export function upsertCatalog(catalog: readonly unknown[], asset: CatalogAsset): unknown[] {
  const index = catalog.findIndex((entry) => (entry as { id?: unknown }).id === asset.id);
  if (index === -1) return [...catalog, asset];
  return catalog.map((entry, position) => (position === index ? asset : entry));
}

async function processImage(file: string, kind: 'picture' | 'rug', width: number | undefined) {
  if (!width || width <= 0) throw new Error('An image needs its real-world width: pass --width <meters>.');
  const pipeline = sharp(file).rotate();
  const { data, info } = await pipeline
    .clone()
    .resize({ width: MAX_IMAGE_SIZE, height: MAX_IMAGE_SIZE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  const thumbnail = await pipeline
    .clone()
    .resize({ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 80 })
    .toBuffer();

  const other = Math.round((width * info.height * 1000) / info.width) / 1000;
  const dimensions: [number, number, number] = kind === 'picture' ? [width, other, PICTURE_FRAME_DEPTH] : [width, RUG_THICKNESS, other];
  return { data: new Uint8Array(data), thumbnail, dimensions };
}

/** Everything an import does except uploading. Writes nothing until all the processing has worked. */
export async function importAsset(request: ImportRequest, seedDir: string, thumbnails: Pick<ThumbnailRenderer, 'render'> | null): Promise<ImportResult> {
  if (!request.license.trim()) throw new Error('Every asset needs a license: pass --license.');
  if (!isHttpUrl(request.sourceUrl)) throw new Error('Every asset needs the URL it came from: pass --source <url>.');

  const extension = extname(request.file).toLowerCase();
  const isModel = MODEL_EXTENSIONS.includes(extension);
  if (!isModel && !IMAGE_EXTENSIONS.includes(extension)) {
    throw new Error(`Can't import ${extension || 'that file'}: expected ${[...MODEL_EXTENSIONS, ...IMAGE_EXTENSIONS].join(', ')}.`);
  }

  const fileSlug = slugify(request.file.split(/[\\/]/).pop()!.slice(0, -extension.length));
  const id = request.id ?? (request.name ? slugify(request.name) : fileSlug);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`"${id}" can't be an asset id: use lowercase letters, digits and dashes.`);

  const catalog = readCatalog(seedDir);
  if (!request.replace && catalog.some((entry) => (entry as { id?: unknown }).id === id)) {
    throw new Error(`The catalog already has "${id}". Pass --replace to overwrite it, or --id to choose another id.`);
  }

  let kind: CatalogAsset['kind'];
  let mainFile: string;
  let main: Uint8Array;
  let thumbnail: Uint8Array;
  let dimensions: [number, number, number];

  if (isModel) {
    if (!thumbnails) throw new Error('Importing a model needs a thumbnail renderer.');
    const model = await processModel(request.file, request.model);
    kind = 'model';
    mainFile = 'model.glb';
    main = model.glb;
    dimensions = model.dimensions;
    thumbnail = await thumbnails.render(model.glb);
  } else {
    kind = request.category === 'rug' ? 'rug' : 'picture';
    mainFile = 'image.webp';
    ({ data: main, thumbnail, dimensions } = await processImage(request.file, kind, request.imageWidth));
  }

  const asset: CatalogAsset = {
    id,
    name: request.name ?? titleFromFile(fileSlug),
    kind,
    category: request.category,
    tags: request.tags ?? [],
    mount: request.mount ?? (kind === 'picture' ? 'wall' : 'floor'),
    url: `assets/${id}/${mainFile}`,
    thumbnailUrl: `assets/${id}/thumbnail.webp`,
    dimensions,
    license: request.license,
    sourceUrl: request.sourceUrl,
    ...(request.light ? { light: request.light } : {}),
  };
  if (!isCatalogAsset(asset)) throw new Error(`The entry for "${id}" isn't valid: ${JSON.stringify(asset)}`);

  const outputs = [
    { key: asset.url, bytes: main },
    { key: asset.thumbnailUrl, bytes: thumbnail },
  ];
  const files = outputs.map(({ key, bytes }) => {
    const path = join(seedDir, key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    return { path, key };
  });

  const catalogPath = join(seedDir, 'catalog.json');
  writeFileSync(catalogPath, formatCatalog(upsertCatalog(catalog, asset)));
  // Last, so a failed upload never leaves the live catalog pointing at missing objects.
  files.push({ path: catalogPath, key: 'catalog.json' });

  return { asset, files };
}
