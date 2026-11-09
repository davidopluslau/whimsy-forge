// Serves the private spike app (../app) on http://localhost:8788 with a throwaway Access key, the way
// the repo's e2e server does, so /editor works on localhost only. It never rebuilds or reseeds, so the
// generated models imported into local R2 stay. Prints the console line that signs the browser in.
import { createRequire } from 'node:module';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const req = createRequire(join(root, 'package.json'));
const { importJWK, SignJWT } = await import(pathToFileURL(req.resolve('jose')).href);

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const teamDomain = 'local.cloudflareaccess.com';
const aud = randomUUID();
const jwks = JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'local', alg: 'RS256', use: 'sig' }] });
const token = await new SignJWT({ email: 'owner@localhost' })
  .setProtectedHeader({ alg: 'RS256', kid: 'local' })
  .setIssuer(`https://${teamDomain}`)
  .setAudience(aud)
  .setIssuedAt()
  .setExpirationTime('12h')
  .sign(await importJWK(privateKey.export({ format: 'jwk' }), 'RS256'));

console.log(`
Open http://localhost:8788, press F12, and paste this into the Console (type "allow pasting" first if asked):

document.cookie = "CF_Authorization=${token}; path=/"

Then go to http://localhost:8788/editor. Generated models are in the catalog, named "<piece> (<generator>)".
This sign-in works only on this machine, for 12 hours or until this window closes.
`);

const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const server = spawn(process.execPath, [
  wrangler, 'pages', 'dev', 'dist', '--port', '8788',
  '--binding', `ACCESS_TEAM_DOMAIN=${teamDomain}`,
  '--binding', `ACCESS_AUD=${aud}`,
  '--binding', `ACCESS_TEST_JWKS=${jwks}`,
], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
server.on('exit', (code) => process.exit(code ?? 0));
