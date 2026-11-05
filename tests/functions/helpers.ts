import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Env } from '../../functions/_lib/env';

export const TEAM_DOMAIN = 'test-team.cloudflareaccess.com';
export const AUD = 'test-aud';

/** Minimal in-memory stand-in for the parts of R2Bucket the Functions use. */
export function createFakeBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string; etag: string; customMetadata?: Record<string, string>; uploaded: Date }>();
  let version = 0;

  const bucket = {
    objects,
    /** How many objects one list call returns, so paging can be tested. */
    pageSize: 1000,
    async put(key: string, value: ArrayBuffer, options?: R2PutOptions) {
      const onlyIf = options?.onlyIf as R2Conditional | undefined;
      if (onlyIf?.etagMatches !== undefined && objects.get(key)?.etag !== onlyIf.etagMatches) return null;
      const httpMetadata = options?.httpMetadata as R2HTTPMetadata | undefined;
      const etag = `etag-${++version}`;
      objects.set(key, {
        bytes: new Uint8Array(value),
        contentType: httpMetadata?.contentType,
        etag,
        customMetadata: options?.customMetadata,
        uploaded: new Date(Date.UTC(2026, 0, 1, 0, 0, version)),
      });
      return { httpEtag: `"${etag}"` };
    },
    async delete(key: string) {
      objects.delete(key);
    },
    async list(options: { prefix?: string; cursor?: string; include?: string[] } = {}) {
      const keys = [...objects.keys()].filter((key) => key.startsWith(options.prefix ?? '')).sort();
      const start = Number(options.cursor ?? 0);
      const end = start + bucket.pageSize;
      return {
        objects: keys.slice(start, end).map((key) => {
          const { uploaded, customMetadata } = objects.get(key)!;
          // Real R2 leaves out custom metadata unless asked for it.
          return { key, uploaded, ...(options.include?.includes('customMetadata') ? { customMetadata } : {}) };
        }),
        truncated: end < keys.length,
        ...(end < keys.length ? { cursor: String(end) } : {}),
      };
    },
    async head(key: string) {
      const stored = objects.get(key);
      return stored ? { httpEtag: `"${stored.etag}"`, customMetadata: stored.customMetadata } : null;
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

/** A built page, reduced to the parts the `/v/:id` Function touches. */
export const APP_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta name="description" content="Build 3D interior designs and share them as read-only links." />
    <title>Whimsy Forge</title>
  </head>
  <body><div id="root"></div></body>
</html>
`;

/** Stands in for the site's static files, which answer `/index.html` with a redirect as Pages does. */
const fakeAssets = {
  async fetch(input: URL | string) {
    return new URL(input).pathname === '/' ? new Response(APP_PAGE, { headers: { 'Content-Type': 'text/html' } }) : new Response(null, { status: 308, headers: { Location: '/' } });
  },
} as unknown as Fetcher;

export function createEnv(overrides: Partial<Env> = {}) {
  const bucket = createFakeBucket();
  const env = {
    BUCKET: bucket as unknown as R2Bucket,
    ASSETS: fakeAssets,
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
