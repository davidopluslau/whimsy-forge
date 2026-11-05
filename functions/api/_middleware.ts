import { isAuthorized } from '../_lib/access';
import { jsonError, type Env } from '../_lib/env';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Reads are public; every other method on /api/* needs a valid Access token. */
export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  if (READ_METHODS.has(request.method)) return next();

  if (!(await isAuthorized(request, env))) return jsonError(401, 'Unauthorized');

  // The token can arrive as a cookie, so refuse writes started by other sites.
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return jsonError(403, 'Cross-origin write refused');

  return next();
};
