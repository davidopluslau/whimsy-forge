import { randomBytes } from 'node:crypto';
import { importJWK, SignJWT } from 'jose';

/** Signs a token the way Cloudflare Access would, using this run's throwaway key. */
export async function accessToken(overrides: { audience?: string } = {}): Promise<string> {
  const key = await importJWK(JSON.parse(process.env.E2E_ACCESS_PRIVATE_JWK!), 'RS256');
  return new SignJWT({ email: 'owner@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'e2e' })
    .setIssuer(`https://${process.env.E2E_ACCESS_TEAM_DOMAIN}`)
    .setAudience(overrides.audience ?? process.env.E2E_ACCESS_AUD!)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(key);
}

export function randomDesignId(): string {
  return randomBytes(16).toString('base64url');
}
