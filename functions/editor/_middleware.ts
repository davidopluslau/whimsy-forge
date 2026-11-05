import { canOpenEditor } from '../_lib/access';
import type { Env } from '../_lib/env';

/** Access guards /editor at the edge; this keeps it closed if that policy is ever missing. */
export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  if (await canOpenEditor(request, env)) return next();
  return new Response('Unauthorized', { status: 401, headers: { 'Cache-Control': 'no-store' } });
};
