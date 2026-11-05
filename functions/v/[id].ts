import { isDesignId } from '../../src/model/ids';
import { decodedName } from '../_lib/designs';
import type { Env } from '../_lib/env';
import { previewKey, previewPath, snapshotKey, withShareTags } from '../_lib/snapshots';

const htmlResponse = (html: string, status: number, cacheControl: string) =>
  new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cacheControl, 'X-Robots-Tag': 'noindex' },
  });

/**
 * The share link's page: the normal app, plus tags for link-preview crawlers. It reads only R2
 * metadata, never the document, to stay well inside the Functions CPU limit. The tags are an extra:
 * if storage can't be asked, the app still loads and reports what it finds.
 */
export const onRequestGet: PagesFunction<Env, 'id'> = async ({ params, request, env }) => {
  const id = String(params.id);
  const { origin } = new URL(request.url);

  // `/` and not `/index.html`, which Pages answers with a redirect.
  const page = await env.ASSETS.fetch(new URL('/', origin));
  if (!page.ok) return page;
  const html = await page.text();

  if (!isDesignId(id)) return htmlResponse(html, 404, 'no-store');
  try {
    const [snapshot, preview] = await Promise.all([env.BUCKET.head(snapshotKey(id)), env.BUCKET.head(previewKey(id))]);
    if (!snapshot) return htmlResponse(html, 404, 'no-store');
    return htmlResponse(
      withShareTags(html, {
        name: decodedName(snapshot.customMetadata?.name),
        url: `${origin}/v/${id}`,
        imageUrl: preview ? `${origin}${previewPath(id)}` : null,
      }),
      200,
      'no-cache',
    );
  } catch (error) {
    console.warn('Could not read a snapshot for its link preview', error);
    return htmlResponse(html, 200, 'no-store');
  }
};
