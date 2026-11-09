// Uploads finished files to the R2 bucket with Wrangler, using its login, and reads one back.
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUCKET = 'whimsy-forge';
const CONTENT_TYPES: Record<string, string> = { '.glb': 'model/gltf-binary', '.json': 'application/json', '.webp': 'image/webp' };
/** What Wrangler prints, locally and remotely, when `r2 object get` finds no object. */
const MISSING_OBJECT = 'The specified key does not exist.';

const root = fileURLToPath(new URL('../..', import.meta.url));
const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

export type UploadTarget = 'remote' | 'local';

function requireWrangler() {
  if (!existsSync(wrangler)) throw new Error(`Wrangler is not installed in ${root}. Run "npm ci" there, then try again.`);
}

/** `retry` says how to finish the job if an upload fails part way. */
export function upload(files: readonly { path: string; key: string }[], target: UploadTarget, retry = `The files are in seed/, so "npm run seed:${target}" can finish the job.`): void {
  requireWrangler();
  for (const { path, key } of files) {
    const contentType = CONTENT_TYPES[extname(path)] ?? 'application/octet-stream';
    const result = spawnSync(process.execPath, [wrangler, 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', path, '--content-type', contentType, `--${target}`], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    if (result.status !== 0) throw new Error(`Uploading ${key} failed. ${retry}`);
  }
}

/**
 * Saves one object to `path`, or returns false if the bucket has no such object. Any other failure throws,
 * because a caller that took it for "missing" could overwrite what's there.
 */
export function download(key: string, path: string, target: UploadTarget): boolean {
  requireWrangler();
  const result = spawnSync(process.execPath, [wrangler, 'r2', 'object', 'get', `${BUCKET}/${key}`, '--file', path, `--${target}`], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status === 0) return true;
  // Wrangler opens the file before it asks, so a missing object leaves an empty one behind.
  rmSync(path, { force: true });
  if (`${result.stdout}${result.stderr}`.includes(MISSING_OBJECT)) return false;
  throw new Error(`Reading ${key} from ${target === 'local' ? 'local' : 'the real'} R2 failed:\n${result.stderr || result.stdout}`);
}
