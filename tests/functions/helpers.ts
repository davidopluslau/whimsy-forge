import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Env } from '../../functions/_lib/env';

export const TEAM_DOMAIN = 'test-team.cloudflareaccess.com';
export const AUD = 'test-aud';

/** Minimal in-memory stand-in for the parts of R2Bucket the Functions use. */
export function createFakeBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string; etag: string }>();
  let version = 0;

  const bucket = {
    objects,
    async put(key: string, value: ArrayBuffer, options?: R2PutOptions) {
      const httpMetadata = options?.httpMetadata as R2HTTPMetadata | undefined;
      const etag = `etag-${++version}`;
      objects.set(key, { bytes: new Uint8Array(value), contentType: httpMetadata?.contentType, etag });
      return { httpEtag: `"${etag}"` };
    },
    async head(key: string) {
      const stored = objects.get(key);
      return stored ? { httpEtag: `"${stored.etag}"` } : null;
    },
    async get(key: string, options?: { onlyIf?: Headers }) {
      const stored = objects.get(key);
      if (!stored) return null;
      const meta = {
        httpEtag: `"${stored.etag}"`,
        writeHttpMetadata(headers: Headers) {
          if (stored.contentType) headers.set('Content-Type', stored.contentType);
        },
      };
      if (options?.onlyIf?.get('If-None-Match') === meta.httpEtag) return meta;
      return { ...meta, body: new Response(stored.bytes).body };
    },
  };
  return bucket;
}

export function createEnv(overrides: Partial<Env> = {}) {
  const bucket = createFakeBucket();
  const env = {
    BUCKET: bucket as unknown as R2Bucket,
    ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    ACCESS_AUD: AUD,
    ...overrides,
  } satisfies Env;
  return { env, bucket };
}

export async function createTestKeys() {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwks = JSON.stringify({ keys: [{ ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' }] });

  function sign(claims: { issuer?: string; audience?: string; expiresIn?: string } = {}) {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(claims.issuer ?? `https://${TEAM_DOMAIN}`)
      .setAudience(claims.audience ?? AUD)
      .setIssuedAt()
      .setExpirationTime(claims.expiresIn ?? '1h')
      .sign(privateKey);
  }
  return { jwks, sign };
}

type Handler = (context: never) => Response | Promise<Response>;

/** Calls a Pages Function with the context fields the handlers read. */
export function call(handler: Handler, request: Request, env: Env, params: Record<string, unknown> = {}) {
  const next = async () => new Response('next', { status: 299 });
  return handler({ request, env, params, next } as never);
}
