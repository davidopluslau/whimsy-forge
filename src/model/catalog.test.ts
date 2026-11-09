import { describe, expect, it } from 'vitest';
import { type CatalogAsset, categoriesIn, filterCatalog, isCatalogAsset, isPrivateAssetId, parseCatalog, PRIVATE_STAND_IN } from './catalog';

function asset(overrides: Partial<CatalogAsset> = {}): CatalogAsset {
  return {
    id: 'sofa',
    name: 'Green sofa',
    kind: 'model',
    category: 'sofa',
    tags: ['couch'],
    mount: 'floor',
    url: 'assets/sofa/model.glb',
    thumbnailUrl: 'assets/sofa/thumbnail.webp',
    dimensions: [2, 0.8, 0.9],
    license: 'CC0 1.0',
    sourceUrl: 'https://example.com/sofa',
    ...overrides,
  };
}

describe('isCatalogAsset', () => {
  it('accepts a complete entry', () => {
    expect(isCatalogAsset(asset())).toBe(true);
  });

  it.each([
    ['no license', { license: '' }],
    ['no source', { sourceUrl: '' }],
    ['a source that is not a web URL', { sourceUrl: 'javascript:alert(1)' }],
    ['an unknown category', { category: 'spaceship' }],
    ['a path outside assets/', { url: 'designs/secret.json' }],
    ['a path that climbs out of assets/', { thumbnailUrl: 'assets/../catalog.json' }],
    ['a missing dimension', { dimensions: [1, 2] }],
    ['a negative dimension', { dimensions: [1, -2, 3] }],
  ])('rejects %s', (_, overrides) => {
    expect(isCatalogAsset(asset(overrides as Partial<CatalogAsset>))).toBe(false);
  });
});

describe('parseCatalog', () => {
  it('keeps furniture and leaves out materials and malformed entries', () => {
    const good = asset();
    const material = { ...asset({ id: 'oak' }), kind: 'material' };
    expect(parseCatalog([good, material, null, { id: 'partial' }])).toEqual([good]);
  });

  it('treats anything but a list as empty', () => {
    expect(parseCatalog({ assets: [] })).toEqual([]);
  });
});

describe('the personal catalog', () => {
  const ID = 'private-AbCdEfGhIjKlMnOpQrSt_-';
  const mine = asset({ id: ID, name: 'Shop sofa', url: `private/assets/${ID}/model.glb`, thumbnailUrl: `private/assets/${ID}/thumbnail.webp` });

  it('names a private asset by its prefix alone', () => {
    expect(isPrivateAssetId(ID)).toBe(true);
    expect(isPrivateAssetId('private-anything')).toBe(true);
    expect(isPrivateAssetId(PRIVATE_STAND_IN)).toBe(false);
    expect(isPrivateAssetId('sofa')).toBe(false);
  });

  it('accepts a private entry only in the private scope', () => {
    expect(isCatalogAsset(mine, 'private')).toBe(true);
    expect(isCatalogAsset(mine)).toBe(false);
    expect(parseCatalog([mine, asset()])).toEqual([asset()]);
    expect(parseCatalog([mine, asset()], 'private')).toEqual([mine]);
  });

  it.each([
    ['a public asset in the personal catalog', asset()],
    ['a guessable private id', { ...mine, id: 'private-sofa', url: 'private/assets/private-sofa/model.glb', thumbnailUrl: 'private/assets/private-sofa/thumbnail.webp' }],
    ['files under the public prefix', { ...mine, url: `assets/${ID}/model.glb` }],
    ["another asset's folder", { ...mine, thumbnailUrl: 'private/assets/private-ZZZZZZZZZZZZZZZZZZZZZZ/thumbnail.webp' }],
    ['a path that climbs out', { ...mine, url: `private/assets/${ID}/../../catalog.json` }],
  ])('rejects %s', (_, entry) => {
    expect(isCatalogAsset(entry, 'private')).toBe(false);
  });

  it('keeps a public entry with a private-looking id out of the public catalog', () => {
    expect(isCatalogAsset(asset({ id: 'private-desk' }))).toBe(false);
  });

  it('finds private assets by the word "private"', () => {
    expect(filterCatalog([mine, asset()], { query: 'private', category: null })).toEqual([mine]);
  });
});

describe('filterCatalog', () => {
  const sofa = asset();
  const chair = asset({ id: 'chair', name: 'Dining chair', category: 'chair', tags: ['kitchen'] });
  const lamp = asset({ id: 'lamp', name: 'Desk lamp', category: 'lamp', tags: [] });
  const all = [sofa, chair, lamp];

  it('returns everything for an empty search', () => {
    expect(filterCatalog(all, { query: '  ', category: null })).toEqual(all);
  });

  it('searches names, tags and categories, ignoring case', () => {
    expect(filterCatalog(all, { query: 'DESK', category: null })).toEqual([lamp]);
    expect(filterCatalog(all, { query: 'couch', category: null })).toEqual([sofa]);
    expect(filterCatalog(all, { query: 'chairs', category: null })).toEqual([chair]);
  });

  it('requires every word to match', () => {
    expect(filterCatalog(all, { query: 'dining kitchen', category: null })).toEqual([chair]);
    expect(filterCatalog(all, { query: 'dining sofa', category: null })).toEqual([]);
  });

  it('limits to the chosen category', () => {
    expect(filterCatalog(all, { query: '', category: 'lamp' })).toEqual([lamp]);
    expect(filterCatalog(all, { query: 'couch', category: 'lamp' })).toEqual([]);
  });
});

describe('categoriesIn', () => {
  it('lists only categories in use, in display order', () => {
    expect(categoriesIn([asset({ category: 'plant' }), asset({ category: 'sofa' }), asset({ category: 'plant' })])).toEqual(['sofa', 'plant']);
  });
});

describe('a lamp entry', () => {
  const entry = {
    id: 'lamp',
    name: 'Lamp',
    kind: 'model',
    category: 'lamp',
    tags: [],
    mount: 'floor',
    url: 'assets/lamp/model.glb',
    thumbnailUrl: 'assets/lamp/thumbnail.webp',
    dimensions: [1, 1, 1],
    license: 'CC0 1.0',
    sourceUrl: 'https://example.com/',
  };
  const light = { position: [0, 1, 0], color: '#ffeedd', intensity: 2, distance: 5 };

  it('may have a light, or none', () => {
    expect(isCatalogAsset(entry)).toBe(true);
    expect(isCatalogAsset({ ...entry, light })).toBe(true);
  });

  it.each([
    ['a position of the wrong length', { ...light, position: [0, 1] }],
    ['a color that is not hex', { ...light, color: 'warm' }],
    ['no intensity', { ...light, intensity: 0 }],
    ['a negative distance', { ...light, distance: -1 }],
  ])('is refused with %s', (_, bad) => {
    expect(isCatalogAsset({ ...entry, light: bad })).toBe(false);
  });
});

describe('the environment entry', () => {
  it('is not offered in the panel', () => {
    expect(parseCatalog([{ id: 'hdri', name: 'HDRI', kind: 'environment', url: 'assets/hdri/environment.hdr', license: 'CC0 1.0', sourceUrl: 'https://example.com/' }])).toEqual([]);
  });
});
