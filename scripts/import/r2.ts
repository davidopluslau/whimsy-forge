// Uploads finished files to the R2 bucket with Wrangler, using its login.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUCKET = 'whimsy-forge';
const CONTENT_TYPES: Record<string, string> = { '.glb': 'model/gltf-binary', '.json': 'application/json', '.webp': 'image/webp' };

const root = fileURLToPath(new URL('../..', import.meta.url));
const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

export type UploadTarget = 'remote' | 'local';

export function upload(files: readonly { path: string; key: string }[], target: UploadTarget): void {
  if (!existsSync(wrangler)) throw new Error(`Wrangler is not installed in ${root}. Run "npm ci" there, then try again.`);
  for (const { path, key } of files) {
    const contentType = CONTENT_TYPES[extname(path)] ?? 'application/octet-stream';
    const result = spawnSync(process.execPath, [wrangler, 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', path, '--content-type', contentType, `--${target}`], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    if (result.status !== 0) throw new Error(`Uploading ${key} failed. The files are in seed/, so "npm run seed:${target}" can finish the job.`);
  }
}
