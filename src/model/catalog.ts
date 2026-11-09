/**
 * The furniture catalog: what the catalog panel lists and items will be placed from. Materials share
 * catalog.json but are applied to surfaces rather than placed, so they live in `materials.ts`.
 *
 * `scripts/import-asset.ts` imports this file directly under Node, so it must stay free of runtime
 * imports and of TypeScript that Node can't strip (enums, parameter properties).
 */

export const CATEGORIES = ['sofa', 'chair', 'table', 'bed', 'shelf', 'lamp', 'plant', 'picture', 'rug', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  sofa: 'Sofas',
  chair: 'Chairs',
  table: 'Tables',
  bed: 'Beds',
  shelf: 'Shelves',
  lamp: 'Lamps',
  plant: 'Plants',
  picture: 'Pictures',
  rug: 'Rugs',
  other: 'Other',
};

export const ASSET_KINDS = ['model', 'picture', 'rug'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const MOUNTS = ['floor', 'wall', 'ceiling'] as const;
export type Mount = (typeof MOUNTS)[number];

/** The light a lamp gives. It has no shadow, so that any number of frames stay cheap on a phone. */
export type LampLight = {
  /** Where the bulb is in meters, from the model's pivot, with its front toward +z. */
  position: [number, number, number];
  color: string;
  /** Candela, as three.js point lights take it. */
  intensity: number;
  /** The light fades to nothing this many meters away. */
  distance: number;
};

export type CatalogAsset = {
  id: string;
  name: string;
  kind: AssetKind;
  category: Category;
  /** Extra search words, such as "couch" for a sofa. */
  tags: string[];
  /** Where an item goes when it is first placed. */
  mount: Mount;
  /** GLB for a model, image for a picture or rug. Relative to the API root, like every catalog path. */
  url: string;
  thumbnailUrl: string;
  /** Meters along x, y (up) and z. A model's pivot is at the bottom center of this box. */
  dimensions: [number, number, number];
  license: string;
  sourceUrl: string;
  /** Present on a model that gives light. */
  light?: LampLight;
};

/**
 * A private asset lives in the personal catalog, which only the owner can read, and never in `seed/` or
 * the public catalog. Its id is this prefix and 128 random bits, so it can't be guessed, and anything that
 * sees only an id, such as a share, can tell that it's private without loading a catalog.
 */
export const PRIVATE_ASSET_PREFIX = 'private-';
/** The form an import gives a private id: the prefix and 22 base64url characters. */
export const PRIVATE_ASSET_ID = /^private-[A-Za-z0-9_-]{22}$/;

/** Whether an asset id names a private asset. Errs toward yes: anything with the prefix counts. */
export const isPrivateAssetId = (id: string): boolean => id.startsWith(PRIVATE_ASSET_PREFIX);

/**
 * What a share puts in place of a private asset's id. It names no asset, so the viewer draws a box of the
 * item's size, as it does for any asset it can't find. It lacks the prefix's dash, so it isn't private itself.
 */
export const PRIVATE_STAND_IN = 'private';

/** Where private assets' files live: under the owner-only route, not the public `assets/`. */
export const PRIVATE_ASSET_ROOT = 'private/assets/';
/** The personal catalog's key in the bucket. */
export const PRIVATE_CATALOG_KEY = 'private/catalog.json';

/** Which catalog an entry belongs to: the public one from `seed/`, or the owner's personal one in R2. */
export type CatalogScope = 'public' | 'private';

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

const includes = <T extends string>(values: readonly T[], value: unknown): value is T => values.includes(value as T);

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * A public catalog path must stay under `assets/`, which is all the public asset route serves. A private
 * one must stay inside its own asset's folder under `private/assets/`, which only the owner can read.
 */
function isAssetPath(value: unknown, id: string, scope: CatalogScope): boolean {
  if (!isNonEmptyString(value) || value.split('/').includes('..')) return false;
  return scope === 'private' ? value.startsWith(`${PRIVATE_ASSET_ROOT}${id}/`) : value.startsWith('assets/');
}

/** A public entry may not have a private id, and a private one must have a well-formed one. */
const isIdFor = (id: string, scope: CatalogScope) => (scope === 'private' ? PRIVATE_ASSET_ID.test(id) : !isPrivateAssetId(id));

const isPositiveNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0;

function isLampLight(value: unknown): value is LampLight {
  if (typeof value !== 'object' || value === null) return false;
  const light = value as Partial<Record<keyof LampLight, unknown>>;
  return (
    Array.isArray(light.position) &&
    light.position.length === 3 &&
    light.position.every((part) => typeof part === 'number' && Number.isFinite(part)) &&
    typeof light.color === 'string' &&
    /^#[0-9a-f]{6}$/i.test(light.color) &&
    isPositiveNumber(light.intensity) &&
    isPositiveNumber(light.distance)
  );
}

export function isCatalogAsset(value: unknown, scope: CatalogScope = 'public'): value is CatalogAsset {
  if (typeof value !== 'object' || value === null) return false;
  const asset = value as Partial<Record<keyof CatalogAsset, unknown>>;
  return (
    isNonEmptyString(asset.id) &&
    isIdFor(asset.id, scope) &&
    isNonEmptyString(asset.name) &&
    includes(ASSET_KINDS, asset.kind) &&
    includes(CATEGORIES, asset.category) &&
    Array.isArray(asset.tags) &&
    asset.tags.every(isNonEmptyString) &&
    includes(MOUNTS, asset.mount) &&
    isAssetPath(asset.url, asset.id, scope) &&
    isAssetPath(asset.thumbnailUrl, asset.id, scope) &&
    Array.isArray(asset.dimensions) &&
    asset.dimensions.length === 3 &&
    asset.dimensions.every((size) => typeof size === 'number' && Number.isFinite(size) && size >= 0) &&
    isNonEmptyString(asset.license) &&
    isHttpUrl(asset.sourceUrl) &&
    (asset.light === undefined || isLampLight(asset.light))
  );
}

/**
 * The placeable assets in a catalog document. Materials are skipped, and so is anything malformed:
 * one bad entry, or one without a license and source, must not take the whole panel down. An entry that
 * belongs to the other scope counts as malformed, so a private asset can never be listed as public.
 */
export function parseCatalog(document: unknown, scope: CatalogScope = 'public'): CatalogAsset[] {
  return Array.isArray(document) ? document.filter((entry) => isCatalogAsset(entry, scope)) : [];
}

/** Categories that have at least one asset, in the catalog's display order. */
export function categoriesIn(assets: readonly CatalogAsset[]): Category[] {
  return CATEGORIES.filter((category) => assets.some((asset) => asset.category === category));
}

export type CatalogFilter = {
  query: string;
  /** `null` means every category. */
  category: Category | null;
};

/** Assets in the category that match every word of the query, in name, tags or category. */
export function filterCatalog(assets: readonly CatalogAsset[], { query, category }: CatalogFilter): CatalogAsset[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return assets.filter((asset) => {
    if (category !== null && asset.category !== category) return false;
    const haystack = [asset.name, asset.category, CATEGORY_LABELS[asset.category], ...asset.tags, ...(isPrivateAssetId(asset.id) ? ['private'] : [])].join(' ').toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export const assetHref = (path: string) => `/api/${path}`;
