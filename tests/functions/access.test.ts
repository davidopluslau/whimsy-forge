import { exportJWK, generateKeyPair, SignJWT, UnsecuredJWT } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { isAuthorized } from '../../functions/_lib/access';
import { onRequest as apiMiddleware } from '../../functions/api/_middleware';
import { onRequest as editorMiddleware } from '../../functions/editor/_middleware';
import { AUD, call, createEnv, createTestKeys, TEAM_DOMAIN } from './helpers';

const LOCAL_URL = 'http://localhost/api/designs/x';
const LOCAL_EDITOR_URL = 'http://localhost/editor';
const PREVIEW_AUD = 'test-preview-aud';

let keys: Awaited<ReturnType<typeof createTestKeys>>;
beforeAll(async () => {
  keys = await createTestKeys();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const envWithKeys = () => createEnv({ ACCESS_TEST_JWKS: keys.jwks }).env;
const envWithPreview = () => createEnv({ ACCESS_TEST_JWKS: keys.jwks, ACCESS_PREVIEW_AUD: PREVIEW_AUD }).env;
const withHeader = (token: string, url = LOCAL_URL) =>
  new Request(url, { headers: { 'Cf-Access-Jwt-Assertion': token } });

describe('isAuthorized', () => {
  it('accepts a valid token from the header', async () => {
    expect(await isAuthorized(withHeader(await keys.sign()), envWithKeys())).toBe(true);
  });

  it('accepts a valid token from the CF_Authorization cookie', async () => {
    const request = new Request(LOCAL_URL, {
      headers: { Cookie: `other=1; CF_Authorization=${await keys.sign()}; another=2` },
    });
    expect(await isAuthorized(request, envWithKeys())).toBe(true);
  });

  it('accepts any of several comma-separated audiences', async () => {
    const env = createEnv({ ACCESS_TEST_JWKS: keys.jwks, ACCESS_AUD: `other, ${AUD}` }).env;
    expect(await isAuthorized(withHeader(await keys.sign()), env)).toBe(true);
  });

  it('rejects a missing token', async () => {
    expect(await isAuthorized(new Request(LOCAL_URL), envWithKeys())).toBe(false);
  });

  it('rejects a wrong audience, issuer or expired token', async () => {
    const env = envWithKeys();
    const tokens = await Promise.all([
      keys.sign({ audience: 'someone-else' }),
      keys.sign({ issuer: 'https://evil.cloudflareaccess.com' }),
      keys.sign({ expiresIn: '-1m' }),
    ]);
    for (const token of tokens) expect(await isAuthorized(withHeader(token), env)).toBe(false);
  });

  it('rejects a token signed by a different key', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(`https://${TEAM_DOMAIN}`)
      .setAudience(AUD)
      .setExpirationTime('1h')
      .sign(privateKey);
    expect(await isAuthorized(withHeader(token), envWithKeys())).toBe(false);
  });

  it('rejects an unsigned token', async () => {
    const token = new UnsecuredJWT({}).setIssuer(`https://${TEAM_DOMAIN}`).setAudience(AUD).encode();
    expect(await isAuthorized(withHeader(token), envWithKeys())).toBe(false);
  });

  it('rejects HS256 tokens that use the public key as a secret', async () => {
    const { publicKey } = await generateKeyPair('RS256', { extractable: true });
    const secret = new TextEncoder().encode(JSON.stringify(await exportJWK(publicKey)));
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', kid: 'test' })
      .setIssuer(`https://${TEAM_DOMAIN}`)
      .setAudience(AUD)
      .setExpirationTime('1h')
      .sign(secret);
    expect(await isAuthorized(withHeader(token), envWithKeys())).toBe(false);
  });

  it.each([
    ['empty team domain', { ACCESS_TEAM_DOMAIN: '' }],
    ['non-Access team domain', { ACCESS_TEAM_DOMAIN: 'evil.example.com' }],
    ['empty audience', { ACCESS_AUD: '' }],
  ])('fails closed with %s', async (_name, overrides) => {
    const env = createEnv({ ACCESS_TEST_JWKS: keys.jwks, ...overrides }).env;
    expect(await isAuthorized(withHeader(await keys.sign()), env)).toBe(false);
  });

  it('ignores test keys when the request is not to localhost', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ keys: [] }));
    try {
      const request = withHeader(await keys.sign(), 'https://whimsy-forge.pages.dev/api/designs/x');
      expect(await isAuthorized(request, envWithKeys())).toBe(false);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('/api middleware', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('lets %s through without a token', async (method) => {
    const response = await call(apiMiddleware as never, new Request(LOCAL_URL, { method }), envWithKeys());
    expect(response.status).toBe(299);
  });

  it.each(['PUT', 'POST', 'PATCH', 'DELETE'])('answers an unauthenticated %s with 401', async (method) => {
    const response = await call(apiMiddleware as never, new Request(LOCAL_URL, { method }), envWithKeys());
    expect(response.status).toBe(401);
  });

  it('lets an authenticated write through', async () => {
    const request = new Request(LOCAL_URL, {
      method: 'PUT',
      headers: { 'Cf-Access-Jwt-Assertion': await keys.sign(), Origin: 'http://localhost' },
    });
    expect((await call(apiMiddleware as never, request, envWithKeys())).status).toBe(299);
  });

  it('refuses a cross-origin write even with a valid cookie', async () => {
    const request = new Request(LOCAL_URL, {
      method: 'POST',
      headers: { Cookie: `CF_Authorization=${await keys.sign()}`, Origin: 'https://evil.example' },
    });
    expect((await call(apiMiddleware as never, request, envWithKeys())).status).toBe(403);
  });
});

describe('/editor middleware', () => {
  const url = 'http://localhost/editor';

  it('answers 401 without a token', async () => {
    expect((await call(editorMiddleware as never, new Request(url), envWithKeys())).status).toBe(401);
  });

  it('continues with a valid token', async () => {
    const response = await call(editorMiddleware as never, withHeader(await keys.sign(), url), envWithKeys());
    expect(response.status).toBe(299);
  });

  it('answers 401 for a token from another application', async () => {
    const token = await keys.sign({ audience: 'someone-else' });
    expect((await call(editorMiddleware as never, withHeader(token, url), envWithPreview())).status).toBe(401);
  });
});

describe('preview deployments', () => {
  it('opens the editor with a token from the preview Access application', async () => {
    const token = await keys.sign({ audience: PREVIEW_AUD });
    const response = await call(editorMiddleware as never, withHeader(token, LOCAL_EDITOR_URL), envWithPreview());
    expect(response.status).toBe(299);
  });

  it('does not open the editor with that token when no preview AUD is configured', async () => {
    const token = await keys.sign({ audience: PREVIEW_AUD });
    expect((await call(editorMiddleware as never, withHeader(token, LOCAL_EDITOR_URL), envWithKeys())).status).toBe(401);
  });

  it.each(['PUT', 'POST', 'PATCH', 'DELETE'])('refuses a %s with that token, from header or cookie', async (method) => {
    const token = await keys.sign({ audience: PREVIEW_AUD });
    const viaHeader = new Request(LOCAL_URL, { method, headers: { 'Cf-Access-Jwt-Assertion': token } });
    const viaCookie = new Request(LOCAL_URL, { method, headers: { Cookie: `CF_Authorization=${token}` } });
    expect((await call(apiMiddleware as never, viaHeader, envWithPreview())).status).toBe(401);
    expect((await call(apiMiddleware as never, viaCookie, envWithPreview())).status).toBe(401);
  });

  it('still requires a real signature on a preview-audience token', async () => {
    const token = new UnsecuredJWT({}).setIssuer(`https://${TEAM_DOMAIN}`).setAudience(PREVIEW_AUD).encode();
    expect((await call(editorMiddleware as never, withHeader(token, LOCAL_EDITOR_URL), envWithPreview())).status).toBe(401);
  });
});
