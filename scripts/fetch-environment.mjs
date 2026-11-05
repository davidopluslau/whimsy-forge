// Downloads the CC0 HDRI that lights every scene from Poly Haven into seed/assets, and checks it against
// the md5 Poly Haven publishes. Its catalog entry is maintained by hand.
// Usage: node scripts/fetch-environment.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = process.argv[2] ?? 'small_empty_room_3';
/** 1024 x 512 is plenty: only blurred reflections and ambient light are read from it, never a backdrop. */
const RESOLUTION = '1k';
const USER_AGENT = 'whimsy-forge-fetch-environment';

const response = await fetch(`https://api.polyhaven.com/files/${SOURCE}`, { headers: { 'User-Agent': USER_AGENT } });
if (!response.ok) throw new Error(`${SOURCE}: ${response.status}`);
const files = await response.json();
const { url, md5 } = files.hdri[RESOLUTION].hdr;

const download = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
if (!download.ok) throw new Error(`${url}: ${download.status}`);
const bytes = Buffer.from(await download.arrayBuffer());
const actual = createHash('md5').update(bytes).digest('hex');
if (actual !== md5) throw new Error(`${url}: md5 ${actual}, expected ${md5}`);

const directory = fileURLToPath(new URL(`../seed/assets/${SOURCE.replaceAll('_', '-')}`, import.meta.url));
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, 'environment.hdr'), bytes);
console.log(`${SOURCE}: ${bytes.length} bytes, https://polyhaven.com/a/${SOURCE}`);
