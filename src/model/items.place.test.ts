import { describe, expect, it } from 'vitest';
import type { CatalogAsset } from './catalog';
import type { Item, Room, Vec2 } from './design';
import * as items from './items';
import * as room from './room';

const EMPTY: Room = { wallHeight: 2.5, walls: [], openings: [] };

function rectangle(): Room {
  const corners: Vec2[] = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ];
  return corners.reduce((current, corner, index) => room.addWall(current, corner, corners[(index + 1) % 4]!, `w${index}`), EMPTY);
}

const draft = (mount: Item['mount'], size: Item['size']) => ({ id: 'new', assetId: 'chair-1', mount, size });

describe('pointInPolygon', () => {
  const square: Vec2[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];

  it('finds points inside, whichever way the corners wind', () => {
    expect(items.pointInPolygon([0.5, 0.5], square)).toBe(true);
    expect(items.pointInPolygon([0.5, 0.5], [...square].reverse())).toBe(true);
  });

  it('rejects points outside', () => {
    expect(items.pointInPolygon([1.5, 0.5], square)).toBe(false);
    expect(items.pointInPolygon([-0.1, 0.5], square)).toBe(false);
  });
});

describe('itemImage', () => {
  const catalog = new Map<string, CatalogAsset>([
    [
      'chair-1',
      {
        id: 'chair-1',
        name: 'Chair',
        kind: 'model',
        category: 'chair',
        tags: [],
        mount: 'floor',
        url: 'assets/chair-1/model.glb',
        thumbnailUrl: 'assets/chair-1/thumbnail.webp',
        dimensions: [1, 1, 1],
        license: 'CC0',
        sourceUrl: 'https://example.com',
      },
    ],
  ]);

  it('resolves a catalog model to its file', () => {
    expect(items.itemImage({ assetId: 'chair-1', mount: 'floor' }, catalog)).toEqual({ kind: 'model', path: 'assets/chair-1/model.glb' });
  });

  it('resolves a photo to its upload, as a picture on a wall and a rug on the floor', () => {
    const id = 'AbCdEfGhIjKlMnOpQrSt_-';
    expect(items.itemImage({ assetId: items.photoAssetId(id), mount: 'wall' }, catalog)).toEqual({ kind: 'picture', path: `assets/uploads/${id}.webp` });
    expect(items.itemImage({ assetId: items.photoAssetId(id), mount: 'floor' }, catalog)?.kind).toBe('rug');
  });

  it('returns null for an asset the catalog does not list yet', () => {
    expect(items.itemImage({ assetId: 'missing', mount: 'floor' }, catalog)).toBeNull();
  });
});

describe('newItem', () => {
  it('lands a floor item on the drop point, flat, with its front toward +z', () => {
    const placed = items.newItem(rectangle(), draft('floor', [1, 1, 1]), [1.5, 2])!;
    expect(placed.position).toEqual([1.5, 0, 2]);
    expect(placed.rotationY).toBe(0);
    expect(placed.wallId).toBeUndefined();
  });

  it('puts a floor item in the middle of the room when there was no drop point', () => {
    const placed = items.newItem(rectangle(), draft('floor', [1, 1, 1]), null)!;
    expect(placed.position[0]).toBeCloseTo(2, 6);
    expect(placed.position[2]).toBeCloseTo(1.5, 6);
  });

  it('hangs a wall item on the nearest wall', () => {
    const placed = items.newItem(rectangle(), draft('wall', [0.6, 0.4, 0.03]), [3, 0.2])!;
    expect(placed.wallId).toBe('w0');
    expect(placed.position[2]).toBeCloseTo(0.015, 6);
    expect(placed.position[1]).toBe(items.PICTURE_BOTTOM);
  });

  it('uses the longest wall for a wall item dropped without a point', () => {
    const placed = items.newItem(rectangle(), draft('wall', [0.6, 0.4, 0.03]), null)!;
    expect(['w0', 'w2']).toContain(placed.wallId);
  });

  it('returns null for a wall item in a room without walls', () => {
    expect(items.newItem(EMPTY, draft('wall', [0.6, 0.4, 0.03]), null)).toBeNull();
  });
});
