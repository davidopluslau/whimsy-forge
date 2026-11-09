import { jsonError, type Env } from '../../../_lib/env';
import { PRIVATE_ASSET_ROOT, readPrivateObject } from '../../../_lib/private';

/**
 * Files of private assets, under `private/assets/` in R2. Owner only. Nothing here is reachable through the
 * public asset route, which serves only the `assets/` prefix.
 */
export const onRequestGet: PagesFunction<Env, 'path'> = async ({ params, request, env }) => {
  const path = Array.isArray(params.path) ? params.path.join('/') : String(params.path ?? '');
  if (!path || path.split('/').includes('..')) return jsonError(404, 'Not found');
  return readPrivateObject(request, env, `${PRIVATE_ASSET_ROOT}${path}`, 'private, max-age=86400');
};
