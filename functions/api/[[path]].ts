import { jsonError } from '../_lib/env';

/** Without this, unknown /api/* paths fall through to the SPA's index.html with a 200. */
export const onRequest: PagesFunction = async () => jsonError(404, 'Not found');
