// Serves a fresh build on the real Pages runtime (workerd + local R2) for Playwright.
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const persist = ['--persist-to', join('.wrangler', 'e2e')];

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run([join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);
run([join(root, 'scripts', 'seed-r2.mjs'), '--local', ...persist]);

// A personal catalog with one asset, as `import-asset --private` would leave it. Its files are a copy of a
// seed model, so nothing private or binary needs checking in.
const PRIVATE_ID = 'private-E2eFixturePrivateTbl01';
for (const [key, file, contentType] of [
  [`private/assets/${PRIVATE_ID}/model.glb`, join(root, 'seed', 'assets', 'side-table-01', 'model.glb'), 'model/gltf-binary'],
  [`private/assets/${PRIVATE_ID}/thumbnail.webp`, join(root, 'seed', 'assets', 'side-table-01', 'thumbnail.webp'), 'image/webp'],
  ['private/catalog.json', join(root, 'e2e', 'fixtures', 'private-catalog.json'), 'application/json'],
]) {
  run([wrangler, 'r2', 'object', 'put', `whimsy-forge/${key}`, '--file', file, '--content-type', contentType, '--local', ...persist]);
}

const server = spawn(
  process.execPath,
  [
    wrangler, 'pages', 'dev', 'dist',
    '--port', process.env.E2E_PORT ?? '8788',
    ...persist,
    '--binding', `ACCESS_TEAM_DOMAIN=${process.env.E2E_ACCESS_TEAM_DOMAIN}`,
    '--binding', `ACCESS_AUD=${process.env.E2E_ACCESS_AUD}`,
    '--binding', `ACCESS_TEST_JWKS=${process.env.E2E_ACCESS_JWKS}`,
  ],
  { cwd: root, stdio: 'inherit' },
);
server.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
