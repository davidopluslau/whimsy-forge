export const snapshotKey = (id: string) => `snapshots/${id}.json`;

/** Under the asset prefix, so the public asset route serves it and a link-preview crawler can fetch it. */
export const previewKey = (id: string) => `assets/snapshots/${id}.jpg`;
export const previewPath = (id: string) => `/api/assets/snapshots/${id}.jpg`;

const PREVIEW_WIDTH = 1200;
const PREVIEW_HEIGHT = 630;
const DESCRIPTION = 'A 3D interior design. Open the link to look around.';

const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export type ShareTags = {
  name: string;
  /** The absolute address of the share link. */
  url: string;
  /** The absolute address of the preview image, if it has one. */
  imageUrl: string | null;
};

/**
 * The app's page with a snapshot's title and link-preview tags, because crawlers don't run JavaScript.
 * The name comes from the document, so everything is escaped.
 */
export function withShareTags(html: string, { name, url, imageUrl }: ShareTags): string {
  const title = escapeHtml(name.trim() || 'Untitled design');
  const tag = (attribute: 'name' | 'property', key: string, content: string) => `<meta ${attribute}="${key}" content="${escapeHtml(content)}" />`;
  const tags = [
    tag('name', 'robots', 'noindex'),
    tag('name', 'description', DESCRIPTION),
    tag('property', 'og:type', 'website'),
    tag('property', 'og:site_name', 'Whimsy Forge'),
    `<meta property="og:title" content="${title}" />`,
    tag('property', 'og:description', DESCRIPTION),
    tag('property', 'og:url', url),
    ...(imageUrl
      ? [
          tag('property', 'og:image', imageUrl),
          tag('property', 'og:image:type', 'image/jpeg'),
          tag('property', 'og:image:width', String(PREVIEW_WIDTH)),
          tag('property', 'og:image:height', String(PREVIEW_HEIGHT)),
          `<meta property="og:image:alt" content="${title}" />`,
        ]
      : []),
    tag('name', 'twitter:card', imageUrl ? 'summary_large_image' : 'summary'),
  ].join('\n    ');
  // Replacer functions, because a name may contain `$&` and the like.
  return html
    .replace(/<title>.*?<\/title>/s, () => `<title>${title} · Whimsy Forge</title>`)
    .replace(/\s*<meta name="description"[^>]*>/, () => '')
    .replace('</head>', () => `  ${tags}\n  </head>`);
}
