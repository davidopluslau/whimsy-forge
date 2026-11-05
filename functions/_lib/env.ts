export interface Env {
  BUCKET: R2Bucket;
  /** The site's static files. Pages provides it; `/v/:id` reads the app's page through it. */
  ASSETS: Fetcher;
  /** Full Access team domain, e.g. `myteam.cloudflareaccess.com`. */
  ACCESS_TEAM_DOMAIN?: string;
  /** Access application AUD tag; comma-separate several. */
  ACCESS_AUD?: string;
  /** AUD tag of the Access application covering preview deployments. Opens /editor; never authorizes writes. */
  ACCESS_PREVIEW_AUD?: string;
  /** JWKS JSON for local e2e runs. Only honored when the request host is localhost. */
  ACCESS_TEST_JWKS?: string;
}

export function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}
