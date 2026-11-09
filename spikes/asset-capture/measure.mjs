// Spike 0 (#16): measure generated GLBs against a listing's W x H x D.
// Usage: node measure.mjs <glb> [width height depth]   (meters)
//        node measure.mjs --all       (every out/<gen>/<item>.glb against its capture.json)
// Stretch uses PR #20's rule: max(axis scale) / min(axis scale) - 1, limit 15 %.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const req = createRequire('C:/Users/david/code/whimsy-forge/package.json');
const load = (m) => import(pathToFileURL(req.resolve(m)).href);
const { NodeIO, getBounds } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions');
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOP = join(ROOT, '..', 'shop-set');
const LIMIT = 0.15;
const { MeshoptDecoder } = await load('meshoptimizer');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

async function measure(file, listed) {
  const doc = await io.read(file);
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const { min, max } = getBounds(scene);
  const size = [0, 1, 2].map((i) => max[i] - min[i]); // x = width, y = height, z = depth (glTF Y-up)
  let triangles = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const p of mesh.listPrimitives()) {
      const n = p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount();
      if (p.getMode() === 4) triangles += n / 3;
    }
  const textures = doc.getRoot().listTextures().map((t) => t.getSize()?.join('x') ?? '?');
  const out = { file: basename(file), bytes: statSync(file).size, triangles, textures, size: size.map((v) => +v.toFixed(4)) };
  if (listed) {
    // Front is unknown, so try the model as-is and turned 90 degrees (width <-> depth).
    const facings = { asIs: [size[0], size[1], size[2]], turned90: [size[2], size[1], size[0]] };
    const results = Object.entries(facings).map(([facing, s]) => {
      const scales = listed.map((l, i) => l / s[i]);
      const stretch = Math.max(...scales) / Math.min(...scales) - 1;
      // Uniform fit by geometric mean: how far off each axis would be without stretching.
      const g = Math.cbrt(scales[0] * scales[1] * scales[2]);
      const uniformErrorCm = s.map((v, i) => +((v * g - listed[i]) * 100).toFixed(1));
      return { facing, stretchPct: +(stretch * 100).toFixed(1), withinLimit: stretch <= LIMIT, uniformErrorCm };
    });
    results.sort((a, b) => a.stretchPct - b.stretchPct);
    Object.assign(out, { listed, best: results[0], other: results[1] });
  }
  return out;
}

const args = process.argv.slice(2);
if (args[0] === '--all') {
  const outDir = join(ROOT, 'out');
  for (const gen of readdirSync(outDir).filter((d) => statSync(join(outDir, d)).isDirectory())) {
    for (const f of readdirSync(join(outDir, gen)).filter((f) => f.endsWith('.glb'))) {
      const item = f.replace(/\.glb$/, '');
      const cap = join(SHOP, item, 'capture.json');
      const d = existsSync(cap) ? JSON.parse(readFileSync(cap, 'utf8')).dimensions : null;
      const r = await measure(join(outDir, gen, f), d && [d.width, d.height, d.depth]);
      console.log(JSON.stringify({ generator: gen, item, ...r }));
    }
  }
} else {
  const listed = args.length >= 4 ? args.slice(1, 4).map(Number) : null;
  console.log(JSON.stringify(await measure(args[0], listed), null, 1));
}
