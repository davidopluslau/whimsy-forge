// Rebuilds the seed furniture: downloads each CC0 model from Poly Haven, checks it against the md5
// and real-world size Poly Haven publishes, and runs it through the same pipeline as any import.
// Writes to seed/ only; "npm run seed:remote" uploads it.
// Usage: node scripts/seed-models.ts [poly-haven-id ...]
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Category, LampLight, Mount } from '../src/model/catalog.ts';
import { importAsset, slugify } from './import/pipeline.ts';
import { createThumbnailRenderer } from './import/thumbnail.ts';

type SeedModel = {
  source: string;
  name: string;
  category: Category;
  tags: string[];
  mount?: Mount;
  /** Degrees, so that the front faces +z. */
  rotateY?: number;
  /** Real height in meters, for a model whose published size is implausible. */
  height?: number;
  /** For a lamp: where its bulb is, and what it gives. */
  light?: LampLight;
};

const DESK_LAMP_LIGHT: LampLight = { position: [0.013, 0.76, -0.187], color: '#ffc98f', intensity: 0.8, distance: 4 };
const CEILING_LAMP_LIGHT: LampLight = { position: [0, 0.03, 0], color: '#ffd9ae', intensity: 2.5, distance: 7 };
const WALL_LAMP_LIGHT: LampLight = { position: [0, 0.215, 0.065], color: '#ffcf9c', intensity: 1, distance: 5 };

const SEED_MODELS: SeedModel[] = [
  { source: 'painted_wooden_chair_01', name: 'Painted wooden chair', category: 'chair', tags: ['dining', 'kitchen'] },
  { source: 'dining_chair_02', name: 'Dining chair', category: 'chair', tags: ['dining', 'kitchen'] },
  { source: 'ArmChair_01', name: 'Armchair', category: 'chair', tags: ['lounge', 'living room'] },
  { source: 'mid_century_lounge_chair', name: 'Mid-century lounge chair', category: 'chair', tags: ['armchair', 'living room'] },
  { source: 'sofa_02', name: 'Two-seat sofa', category: 'sofa', tags: ['couch', 'settee', 'living room'] },
  { source: 'sofa_03', name: 'Large sofa', category: 'sofa', tags: ['couch', 'living room'] },
  { source: 'round_wooden_table_02', name: 'Round wooden table', category: 'table', tags: ['dining', 'kitchen'] },
  // Published at 0.877 m high, which is counter height: too high for a dining table.
  { source: 'dining_table', name: 'Dining table', category: 'table', tags: ['kitchen'], height: 0.76 },
  { source: 'coffee_table_round_01', name: 'Round coffee table', category: 'table', tags: ['living room'] },
  { source: 'side_table_01', name: 'Side table', category: 'table', tags: ['end table', 'nightstand'] },
  { source: 'GothicBed_01', name: 'Gothic bed', category: 'bed', tags: ['bedroom', 'double', 'four poster'] },
  { source: 'old_bed_frame', name: 'Old bed frame', category: 'bed', tags: ['bedroom', 'single', 'metal'] },
  { source: 'wooden_display_shelves_01', name: 'Wooden display shelves', category: 'shelf', tags: ['bookcase', 'storage'], rotateY: -90 },
  { source: 'steel_frame_shelves_02', name: 'Steel-frame shelves', category: 'shelf', tags: ['bookcase', 'storage', 'industrial'] },
  { source: 'desk_lamp_arm_01', name: 'Desk lamp', category: 'lamp', tags: ['light', 'table lamp', 'task'], light: DESK_LAMP_LIGHT },
  { source: 'modern_ceiling_lamp_01', name: 'Modern ceiling lamp', category: 'lamp', tags: ['light', 'pendant'], mount: 'ceiling', light: CEILING_LAMP_LIGHT },
  { source: 'industrial_wall_lamp', name: 'Industrial wall lamp', category: 'lamp', tags: ['light', 'sconce'], mount: 'wall', light: WALL_LAMP_LIGHT },
  { source: 'potted_plant_01', name: 'Tall potted plant', category: 'plant', tags: ['green', 'houseplant', 'floor plant'] },
  { source: 'potted_plant_02', name: 'Potted plant', category: 'plant', tags: ['green', 'houseplant'] },
  { source: 'potted_plant_04', name: 'Potted succulent', category: 'plant', tags: ['green', 'houseplant', 'small'] },
];

const API = 'https://api.polyhaven.com';
const USER_AGENT = 'whimsy-forge-seed-models';
/** How far a finished model's height may be from the size Poly Haven publishes. */
const SIZE_TOLERANCE = 0.03;

const root = fileURLToPath(new URL('..', import.meta.url));
const seedDir = join(root, 'seed');
const cacheDir = join(root, '.cache', 'polyhaven');

async function get(url: string): Promise<Response> {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response;
}

type RemoteFile = { url: string; md5: string };

/** Downloads a file into a model's folder, refusing a relative path that would leave it. */
async function download(directory: string, relativePath: string, { url, md5 }: RemoteFile): Promise<string> {
  const path = resolve(directory, relativePath);
  if (!path.startsWith(directory + sep)) throw new Error(`${relativePath} escapes the download folder.`);
  const bytes = Buffer.from(await (await get(url)).arrayBuffer());
  const actual = createHash('md5').update(bytes).digest('hex');
  if (actual !== md5) throw new Error(`${url}: md5 ${actual}, expected ${md5}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return path;
}

async function downloadModel(source: string): Promise<string> {
  const files = (await (await get(`${API}/files/${source}`)).json()) as {
    gltf: { '1k': { gltf: RemoteFile & { include: Record<string, RemoteFile> } } };
  };
  const { url, md5, include } = files.gltf['1k'].gltf;
  const directory = resolve(cacheDir, source);
  await Promise.all(Object.entries(include).map(([relativePath, file]) => download(directory, relativePath, file)));
  return download(directory, `${source}.gltf`, { url, md5 });
}

const wanted = process.argv.slice(2);
const models = wanted.length ? SEED_MODELS.filter((model) => wanted.includes(model.source)) : SEED_MODELS;
if (wanted.length && models.length !== wanted.length) throw new Error(`Unknown model in: ${wanted.join(', ')}`);

const info = (await (await get(`${API}/assets?t=models`)).json()) as Record<string, { dimensions: [number, number, number] }>;
const thumbnails = await createThumbnailRenderer();

try {
  for (const model of models) {
    const { asset, files } = await importAsset(
      {
        file: await downloadModel(model.source),
        id: slugify(model.source),
        name: model.name,
        category: model.category,
        tags: model.tags,
        mount: model.mount,
        license: 'CC0 1.0',
        sourceUrl: `https://polyhaven.com/a/${model.source}`,
        replace: true,
        light: model.light,
        model: { rotateY: model.rotateY, fit: model.height ? { axis: 'height', meters: model.height } : undefined },
      },
      seedDir,
      thumbnails,
    );

    // Poly Haven lists millimeters as width, depth, height.
    const publishedHeight = model.height ?? info[model.source]!.dimensions[2] / 1000;
    const height = asset.dimensions[1];
    if (Math.abs(height - publishedHeight) > publishedHeight * SIZE_TOLERANCE) {
      throw new Error(`${asset.id} is ${height} m high, but Poly Haven lists ${publishedHeight} m.`);
    }
    console.log(`${asset.id}: ${asset.dimensions.join(' x ')} m (expected height ${publishedHeight} m), ${files[0]!.key}`);
  }
} finally {
  await thumbnails.close();
}
