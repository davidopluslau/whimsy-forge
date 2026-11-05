// Uploads everything in seed/ to the R2 bucket, keeping relative paths as object keys.
// Usage: node scripts/seed-r2.mjs --local|--remote [--persist-to <dir>]
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUCKET = 'whimsy-forge';
const CONTENT_TYPES = { '.glb': 'model/gltf-binary', '.json': 'application/json', '.webp': 'image/webp' };

const root = fileURLToPath(new URL('..', import.meta.url));
const seedDir = join(root, 'seed');
const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const args = process.argv.slice(2);
if (!args.includes('--local') && !args.includes('--remote')) {
  console.error('Pass --local or --remote.');
  process.exit(1);
}

const files = readdirSync(seedDir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name));

for (const file of files) {
  const key = relative(seedDir, file).split(sep).join('/');
  const contentType = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
  const result = spawnSync(
    process.execPath,
    [wrangler, 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file, '--content-type', contentType, ...args],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
