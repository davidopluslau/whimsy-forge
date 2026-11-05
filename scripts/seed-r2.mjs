// Uploads everything in seed/ to the R2 bucket, keeping relative paths as object keys.
// Usage: node scripts/seed-r2.mjs --local|--remote [--persist-to <dir>]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUCKET = 'whimsy-forge';
const CONTENT_TYPES = { '.glb': 'model/gltf-binary', '.hdr': 'image/vnd.radiance', '.json': 'application/json', '.webp': 'image/webp' };

const root = fileURLToPath(new URL('..', import.meta.url));
const seedDir = join(root, 'seed');
const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const args = process.argv.slice(2);
if (!args.includes('--local') && !args.includes('--remote')) {
  console.error('Pass --local or --remote.');
  process.exit(1);
}
if (!existsSync(wrangler)) {
  console.error(`Wrangler is not installed in ${root}. Run "npm ci" there, then try again.`);
  process.exit(1);
}

const files = readdirSync(seedDir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name));

// One bulk upload per content type, as a bulk upload sets a single content type for all its files.
const byContentType = Map.groupBy(files, (file) => CONTENT_TYPES[extname(file)] ?? 'application/octet-stream');

const listDir = mkdtempSync(join(tmpdir(), 'whimsy-forge-seed-'));
let status = 0;
for (const [contentType, group] of byContentType) {
  const list = join(listDir, 'files.json');
  writeFileSync(list, JSON.stringify(group.map((file) => ({ key: relative(seedDir, file).split(sep).join('/'), file }))));
  const result = spawnSync(
    process.execPath,
    [wrangler, 'r2', 'bulk', 'put', BUCKET, '--filename', list, '--content-type', contentType, '--force', ...args],
    { cwd: root, stdio: 'inherit' },
  );
  status = result.status ?? 1;
  if (status !== 0) break;
}
rmSync(listDir, { recursive: true, force: true });
process.exit(status);
