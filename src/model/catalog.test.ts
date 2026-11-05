import { describe, expect, it } from 'vitest';
import { type CatalogAsset, categoriesIn, filterCatalog, isCatalogAsset, parseCatalog } from './catalog';

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
