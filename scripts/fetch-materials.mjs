// Downloads the CC0 PBR materials from Poly Haven into seed/assets, checks each file against the
// md5 Poly Haven publishes, and re-encodes it as WebP. The catalog entries are maintained by hand;
// this script prints each material's real-world size, which is what `tileSize` should be.
// Usage: node scripts/fetch-materials.mjs
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const MATERIALS = ['laminate_floor_02', 'herringbone_parquet', 'floor_tiles_06', 'white_plaster_02', 'painted_plaster_wall', 'red_brick'];

/** Poly Haven's map name, the file it becomes here, and the WebP quality it can afford. */
const MAPS = [
  { source: 'Diffuse', file: 'color.webp', quality: 80 },
  { source: 'nor_gl', file: 'normal.webp', quality: 85 },
  { source: 'Rough', file: 'roughness.webp', quality: 70 },
];

const RESOLUTION = '1k';
const USER_AGENT = 'whimsy-forge-fetch-materials';

const seedAssets = fileURLToPath(new URL('../seed/assets', import.meta.url));

async function get(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response;
}

const info = await (await get('https://api.polyhaven.com/assets?t=textures')).json();

for (const id of MATERIALS) {
  const directory = join(seedAssets, id.replaceAll('_', '-'));
  mkdirSync(directory, { recursive: true });
  const files = await (await get(`https://api.polyhaven.com/files/${id}`)).json();

  for (const { source, file, quality } of MAPS) {
    const { url, md5 } = files[source][RESOLUTION].jpg;
    const bytes = Buffer.from(await (await get(url)).arrayBuffer());
    const actual = createHash('md5').update(bytes).digest('hex');
    if (actual !== md5) throw new Error(`${url}: md5 ${actual}, expected ${md5}`);
    const { size } = await sharp(bytes).webp({ quality }).toFile(join(directory, file));
    console.log(`${id}/${file}: ${bytes.length} -> ${size} bytes`);
  }

  const [width] = info[id].dimensions;
  console.log(`${id}: "${info[id].name}", tileSize ${(width / 1000).toFixed(2)} m, https://polyhaven.com/a/${id}`);
}
