import { describe, expect, it } from 'vitest';
import type { Item, Room, Vec2 } from './design';
import * as items from './items';
import * as room from './room';

const EMPTY: Room = { wallHeight: 2.5, walls: [], openings: [] };

/** A 4 m by 3 m room, its walls drawn around the outline from (0, 0). */
function rectangle(): Room {
  const corners: Vec2[] = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ];
  return corners.reduce((current, corner, index) => room.addWall(current, corner, corners[(index + 1) % 4]!, `w${index}`), EMPTY);
}

function item(overrides: Partial<Item> = {}): Item {
  return { id: 'i', assetId: 'a', position: [1, 0, 1], rotationY: 0, size: [1, 1, 1], mount: 'floor', ...overrides };
}

const close = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 6));
};

describe('footprint', () => {
  it('is the size around the position when unrotated', () => {
    const corners = items.footprint(item({ position: [1, 0, 2], size: [1, 1, 0.5] }));
    const xs = corners.map((corner) => corner[0]);
    const ys = corners.map((corner) => corner[1]);
    close([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [0.5, 1.5, 1.75, 2.25]);
  });

  it('swaps width and depth after a quarter turn', () => {
    const corners = items.footprint(item({ position: [0, 0, 0], size: [2, 1, 0.5], rotationY: Math.PI / 2 }));
    const xs = corners.map((corner) => corner[0]);
    const ys = corners.map((corner) => corner[1]);
    close([Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)], [0.5, 2]);
  });
});

describe('polygonsOverlap and overlappingItemIds', () => {
  it('counts shapes that only touch as clear', () => {
    const left = items.footprint(item({ id: 'l', position: [0, 0, 0], size: [1, 1, 1] }));
    const right = items.footprint(item({ id: 'r', position: [1, 0, 0], size: [1, 1, 1] }));
    expect(items.polygonsOverlap(left, right)).toBe(false);
  });

  it('finds overlapping rotated shapes that axis-aligned boxes would miss', () => {
    const square = items.footprint(item({ position: [0, 0, 0], size: [2, 1, 2] }));
    const diamond = items.footprint(item({ position: [1.7, 0, 0], size: [1, 1, 1], rotationY: Math.PI / 4 }));
    expect(items.polygonsOverlap(square, diamond)).toBe(true);
  });

  it('returns both ids for each overlapping pair and leaves other items out', () => {
    const list = [
      item({ id: 'a', position: [0, 0, 0] }),
      item({ id: 'b', position: [0.5, 0, 0] }),
      item({ id: 'c', position: [5, 0, 5] }),
    ];
    expect([...items.overlappingItemIds(list)].sort()).toEqual(['a', 'b']);
  });
});

describe('placeOnWall', () => {
  it('hangs a picture flush against the room side of a wall, facing into the room', () => {
    const placed = items.placeOnWall(rectangle(), 'w0', [2, 0.5], [0.6, 0.4, 0.03], 1.2, null)!;
    expect(placed.wallId).toBe('w0');
    close(placed.position, [2, 1.2, 0.015]);
    expect(placed.rotationY).toBeCloseTo(0, 6);
  });

  it('slides along the wall but stays within its ends', () => {
    const placed = items.placeOnWall(rectangle(), 'w0', [10, 0.5], [0.6, 0.4, 0.03], 1.2, null)!;
    expect(placed.position[0]).toBeCloseTo(3.7, 6);
  });

  it('faces the other way for the opposite wall', () => {
    const placed = items.placeOnWall(rectangle(), 'w2', [2, 2.5], [0.6, 0.4, 0.03], 1.2, null)!;
    close(placed.position, [2, 1.2, 2.985]);
    expect(Math.abs(placed.rotationY)).toBeCloseTo(Math.PI, 6);
  });

  it('keeps the bottom edge between the floor and the ceiling', () => {
    const placed = items.placeOnWall(rectangle(), 'w0', [2, 0.5], [0.6, 0.4, 0.03], 9, null)!;
    expect(placed.position[1]).toBeCloseTo(2.1, 6);
  });

  it('returns null for a wall that is not there', () => {
    expect(items.placeOnWall(rectangle(), 'missing', [2, 0.5], [0.6, 0.4, 0.03], 1.2, null)).toBeNull();
  });
});

describe('followWalls', () => {
  it('keeps a hung picture on its wall when the wall is lengthened', () => {
    const before = rectangle();
    const picture = { ...item({ id: 'p', mount: 'wall', size: [0.6, 0.4, 0.03] }), ...items.placeOnWall(before, 'w0', [2, 0.5], [0.6, 0.4, 0.03], 1.2, null)! };
    const longer = room.setWallLength(before, 'w0', 6);
    const [moved] = items.followWalls(longer, [picture]);
    expect(moved!.wallId).toBe('w0');
    expect(moved!.position[2]).toBeCloseTo(0.015, 6);
    expect(moved!.position[0]).toBeCloseTo(2, 6);
  });

  it('drops a wall item whose wall was removed, and leaves other items alone', () => {
    const before = rectangle();
    const picture = { ...item({ id: 'p', mount: 'wall', size: [0.6, 0.4, 0.03] }), ...items.placeOnWall(before, 'w0', [2, 0.5], [0.6, 0.4, 0.03], 1.2, null)! };
    const sofa = item({ id: 's' });
    const after = room.removeWall(before, 'w0');
    expect(items.followWalls(after, [picture, sofa]).map((candidate) => candidate.id)).toEqual(['s']);
  });

  it('returns the same array when nothing moved', () => {
    const before = rectangle();
    const picture = { ...item({ id: 'p', mount: 'wall', size: [0.6, 0.4, 0.03] }), ...items.placeOnWall(before, 'w0', [2, 0.5], [0.6, 0.4, 0.03], 1.2, null)! };
    const list = [picture];
    expect(items.followWalls(before, list)).toBe(list);
  });
});

describe('nudgeItem', () => {
  it('moves a floor item in plan', () => {
    const moved = items.nudgeItem(EMPTY, item({ position: [1, 0, 1] }), 0.05, -0.05);
    close(moved.position, [1.05, 0, 0.95]);
  });

  it('slides a wall item along its wall and keeps it flush', () => {
    const current = rectangle();
    const picture = { ...item({ id: 'p', mount: 'wall', size: [0.6, 0.4, 0.03] }), ...items.placeOnWall(current, 'w0', [2, 0.5], [0.6, 0.4, 0.03], 1.2, null)! };
    const slid = items.nudgeItem(current, picture, 0.5, 0);
    expect(slid.position[0]).toBeCloseTo(2.5, 6);
    expect(slid.position[2]).toBeCloseTo(0.015, 6);
  });
});

describe('rotateItem and duplicateItem', () => {
  it('turns by an angle and wraps into (-π, π]', () => {
    const turned = items.rotateItem(item({ rotationY: 3 }), 0.5);
    expect(turned.rotationY).toBeCloseTo(3.5 - 2 * Math.PI, 6);
  });

  it('copies a floor item diagonally from the original', () => {
    const copy = items.duplicateItem(EMPTY, item({ position: [1, 0, 1] }));
    close(copy.position, [1 + items.DUPLICATE_OFFSET, 0, 1 + items.DUPLICATE_OFFSET]);
  });
});

describe('photoSize', () => {
  it('makes a picture as wide as typed and as tall as its photo, with a thin frame', () => {
    expect(items.photoSize('wall', 0.8, 2)).toEqual([0.8, 0.4, items.PICTURE_DEPTH]);
  });

  it('makes a rug a flat sheet with its length from the photo', () => {
    expect(items.photoSize('floor', 2, 1.5)).toEqual([2, items.RUG_THICKNESS, 2 / 1.5]);
  });
});

describe('photo ids', () => {
  it('round-trips an upload id through an asset id and a path', () => {
    const asset = items.photoAssetId('AbCdEfGhIjKlMnOpQrSt_-');
    expect(items.uploadIdOf(asset)).toBe('AbCdEfGhIjKlMnOpQrSt_-');
    expect(items.uploadIdOf('chair-1')).toBeNull();
    expect(items.uploadPath('AbCdEfGhIjKlMnOpQrSt_-')).toBe('assets/uploads/AbCdEfGhIjKlMnOpQrSt_-.webp');
  });
});
