import { canOpenEditor } from '../../_lib/access';
import { listDesignSummaries } from '../../_lib/designs';
import { jsonError, type Env } from '../../_lib/env';

/**
 * The design list. Unlike other reads it needs a token, because a live design's ID is a read
 * capability and this hands out all of them. The check is here and not in `api/_middleware.ts`, which
 * treats every GET as public. A preview's token is enough: it can read, and still can't write.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await canOpenEditor(request, env))) return jsonError(401, 'Unauthorized');
  return Response.json(await listDesignSummaries(env.BUCKET), { headers: { 'Cache-Control': 'no-store' } });
};
