// Imports one model or image into the catalog: normalizes it to meters with its pivot at bottom
// center, compresses it, renders a thumbnail, uploads it to R2 and appends it to seed/catalog.json.
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, type Category, type Mount, MOUNTS } from '../src/model/catalog.ts';
import type { ModelOptions } from './import/model.ts';
import { importAsset, MODEL_EXTENSIONS } from './import/pipeline.ts';
import { upload } from './import/r2.ts';
import { createThumbnailRenderer } from './import/thumbnail.ts';

const USAGE = `Usage: npm run import-asset -- <file> --category <category> --license <license> --source <url> [options]

  <file>              .glb or .gltf, or a .jpg, .png or .webp for a picture or rug
  --category          ${CATEGORIES.join(', ')}
  --license           for example "CC0 1.0"
  --source            the URL the asset came from

Options:
  --name <text>       display name (default: from the file name)
  --id <slug>         asset id (default: from the name)
  --tags <a,b>        extra search words
  --mount <where>     ${MOUNTS.join(', ')} (default: floor, or wall for a picture)
  --replace           overwrite an asset that has this id
  --local             upload to the local R2 used by "npm run dev:pages" instead of the real bucket
  --no-upload         only write to seed/

Models are assumed to be in meters, as glTF specifies. To correct one, pass either:
  --scale <factor>    for example 0.01 for centimeters
  --width | --height | --depth <meters>
                      the real size along that axis; the model scales uniformly to fit
  --rotate-y <deg>    turn the model so that its front faces +z
  --max-triangles <n> simplify above this count (default: 60000)
  --max-texture <px>  longest texture side (default: 1024)

Images:
  --width <meters>    required; the height comes from the image's aspect ratio
`;

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(1);
}

function positiveNumber(text: string | undefined, flag: string): number | undefined {
  if (text === undefined) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) fail(`--${flag} must be a positive number.`);
  return value;
}

const options = {
  category: { type: 'string' },
  license: { type: 'string' },
  source: { type: 'string' },
  name: { type: 'string' },
  id: { type: 'string' },
  tags: { type: 'string' },
  mount: { type: 'string' },
  replace: { type: 'boolean' },
  local: { type: 'boolean' },
  'no-upload': { type: 'boolean' },
  scale: { type: 'string' },
  'rotate-y': { type: 'string' },
  width: { type: 'string' },
  height: { type: 'string' },
  depth: { type: 'string' },
  'max-triangles': { type: 'string' },
  'max-texture': { type: 'string' },
  'seed-dir': { type: 'string' },
  help: { type: 'boolean' },
} as const;

function parse() {
  try {
    return parseArgs({ options, allowPositionals: true });
  } catch (error) {
    return fail((error as Error).message);
  }
}

const { values, positionals } = parse();
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const [file] = positionals;
if (!file || positionals.length > 1) fail('Pass exactly one file.');
if (!CATEGORIES.includes(values.category as Category)) fail(`--category must be one of: ${CATEGORIES.join(', ')}.`);
if (!values.license) fail('--license is required: every catalog entry records its license.');
if (!values.source) fail('--source is required: every catalog entry records where it came from.');
if (values.mount && !MOUNTS.includes(values.mount as Mount)) fail(`--mount must be one of: ${MOUNTS.join(', ')}.`);

const width = positiveNumber(values.width, 'width');
const height = positiveNumber(values.height, 'height');
const depth = positiveNumber(values.depth, 'depth');
const isModel = MODEL_EXTENSIONS.some((extension) => file.toLowerCase().endsWith(extension));
if (values['rotate-y'] !== undefined && !Number.isFinite(Number(values['rotate-y']))) fail('--rotate-y must be a number of degrees.');
if ([width, height, depth].filter((size) => size !== undefined).length > 1) fail('Pass only one of --width, --height and --depth.');

let fit: ModelOptions['fit'];
if (width) fit = { axis: 'width', meters: width };
if (height) fit = { axis: 'height', meters: height };
if (depth) fit = { axis: 'depth', meters: depth };

const seedDir = values['seed-dir'] ?? fileURLToPath(new URL('../seed', import.meta.url));
const thumbnails = isModel ? await createThumbnailRenderer() : null;

try {
  const { asset, files } = await importAsset(
    {
      file,
      id: values.id,
      name: values.name,
      category: values.category as Category,
      tags: values.tags?.split(',').map((tag) => tag.trim()).filter(Boolean),
      mount: values.mount as Mount | undefined,
      license: values.license,
      sourceUrl: values.source,
      replace: values.replace,
      imageWidth: width,
      model: {
        fit,
        scale: positiveNumber(values.scale, 'scale'),
        rotateY: values['rotate-y'] === undefined ? undefined : Number(values['rotate-y']),
        maxTriangles: positiveNumber(values['max-triangles'], 'max-triangles'),
        maxTextureSize: positiveNumber(values['max-texture'], 'max-texture'),
      },
    },
    seedDir,
    thumbnails,
  );

  const [x, y, z] = asset.dimensions;
  console.log(`Imported "${asset.name}" as ${asset.id}: ${x} x ${y} x ${z} m (width, height, depth).`);

  if (values['no-upload']) {
    console.log('Skipped the upload. Run "npm run seed:remote" to upload everything in seed/.');
  } else {
    upload(files, values.local ? 'local' : 'remote');
    console.log(`Uploaded to ${values.local ? 'local' : 'the real'} R2. It is in the catalog panel now.`);
  }
  console.log('Commit seed/ so the next import starts from this catalog.');
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await thumbnails?.close();
}
