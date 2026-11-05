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

/** A catalog path must stay under `assets/`, which is all the asset route serves. */
const isAssetPath = (value: unknown) => isNonEmptyString(value) && value.startsWith('assets/') && !value.split('/').includes('..');

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

export function isCatalogAsset(value: unknown): value is CatalogAsset {
  if (typeof value !== 'object' || value === null) return false;
  const asset = value as Partial<Record<keyof CatalogAsset, unknown>>;
  return (
    isNonEmptyString(asset.id) &&
    isNonEmptyString(asset.name) &&
    includes(ASSET_KINDS, asset.kind) &&
    includes(CATEGORIES, asset.category) &&
    Array.isArray(asset.tags) &&
    asset.tags.every(isNonEmptyString) &&
    includes(MOUNTS, asset.mount) &&
    isAssetPath(asset.url) &&
    isAssetPath(asset.thumbnailUrl) &&
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
 * one bad entry, or one without a license and source, must not take the whole panel down.
 */
export function parseCatalog(document: unknown): CatalogAsset[] {
  return Array.isArray(document) ? document.filter(isCatalogAsset) : [];
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
    const haystack = [asset.name, asset.category, CATEGORY_LABELS[asset.category], ...asset.tags].join(' ').toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export const assetHref = (path: string) => `/api/${path}`;
