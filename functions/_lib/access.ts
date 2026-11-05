import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Env } from './env';

const TEAM_DOMAIN = /^[a-z0-9-]+\.cloudflareaccess\.com$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

const remoteKeySets = new Map<string, JWTVerifyGetKey>();

function keySetFor(request: Request, env: Env, teamDomain: string): JWTVerifyGetKey {
  if (env.ACCESS_TEST_JWKS && LOCAL_HOSTS.has(new URL(request.url).hostname)) {
    return createLocalJWKSet(JSON.parse(env.ACCESS_TEST_JWKS));
  }
  let keySet = remoteKeySets.get(teamDomain);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    remoteKeySets.set(teamDomain, keySet);
  }
  return keySet;
}

function tokenFrom(request: Request): string | undefined {
  const header = request.headers.get('Cf-Access-Jwt-Assertion');
  if (header) return header;
  // Access only adds the header on paths it covers. /api/* stays outside Access, so
  // requests there authenticate with the cookie set when the owner signs in at /editor.
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === 'CF_Authorization' && value) return value;
  }
  return undefined;
}

/** True only for a validly signed Access token for this application. Fails closed. */
export async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const token = tokenFrom(request);
  if (!token) return false;

  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim() ?? '';
  const audience = (env.ACCESS_AUD ?? '').split(',').map((aud) => aud.trim()).filter(Boolean);
  if (!TEAM_DOMAIN.test(teamDomain) || audience.length === 0) {
    console.error('ACCESS_TEAM_DOMAIN or ACCESS_AUD is missing or malformed; denying request.');
    return false;
  }

  try {
    await jwtVerify(token, keySetFor(request, env, teamDomain), {
      issuer: `https://${teamDomain}`,
      audience,
      algorithms: ['RS256'],
    });
    return true;
  } catch {
    return false;
  }
}
