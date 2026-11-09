import type { Env } from '../../_lib/env';
import { PRIVATE_CATALOG_KEY, readPrivateObject } from '../../_lib/private';

/** The owner's personal catalog. Owner only, and always revalidated so a new import shows up at once. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const response = await readPrivateObject(request, env, PRIVATE_CATALOG_KEY, 'private, no-cache');
  if (response.ok) response.headers.set('Content-Type', 'application/json');
  return response;
};
