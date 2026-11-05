import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDesign } from '../model/design';
import { useDesignStore } from './designStore';

const store = () => useDesignStore.getState();

describe('designStore', () => {
  beforeEach(() => store().setDesign({ ...createEmptyDesign('Test'), updatedAt: '2000-01-01T00:00:00.000Z' }));

  it('adds a wall to the design and stamps updatedAt', () => {
    const id = store().addWall([0, 0], [4, 0]);
    expect(store().design.room.walls.map((wall) => wall.id)).toEqual([id]);
    expect(store().design.updatedAt).not.toBe('2000-01-01T00:00:00.000Z');
  });

  it('reports a rejected wall and leaves the design alone', () => {
    const before = store().design;
    expect(store().addWall([0, 0], [0, 0])).toBeNull();
    expect(store().design).toBe(before);
  });

  it('applies and reports length and height edits', () => {
    const id = store().addWall([0, 0], [4, 0])!;
    expect(store().setWallLength(id, 6)).toBe(true);
    expect(store().design.room.walls[0]!.end).toEqual([6, 0]);
    expect(store().setWallLength(id, -1)).toBe(false);
    expect(store().setWallHeight(3)).toBe(true);
    expect(store().design.room.wallHeight).toBe(3);
    expect(store().setWallHeight(0)).toBe(false);
  });

  it('adds, edits and removes an opening, reporting refusals', () => {
    const wallId = store().addWall([0, 0], [4, 0])!;
    const id = store().addOpening(wallId, 'door', 2)!;
    expect(store().design.room.openings.map((opening) => opening.id)).toEqual([id]);
    expect(store().addOpening('nope', 'door', 2)).toBeNull();

    expect(store().updateOpening(id, { width: 1 })).toBe(true);
    expect(store().updateOpening(id, { width: 10 })).toBe(false);
    store().moveOpening(id, 0.5);
    expect(store().design.room.openings[0]!.offset).toBe(0.5);
    store().dragOpeningEdge(id, 'end', 2);
    expect(store().design.room.openings[0]!.width).toBe(1.5);

    store().removeOpening(id);
    expect(store().design.room.openings).toEqual([]);
  });

  it('sets a wall material and the floor material', () => {
    const first = store().addWall([0, 0], [4, 0])!;
    const second = store().addWall([4, 0], [4, 5])!;
    const before = store().design.room.walls.find((wall) => wall.id === second);
    store().setWallMaterial(first, 'red-brick');
    expect(store().design.room.walls[0]!.materialId).toBe('red-brick');
    expect(store().design.room.walls.find((wall) => wall.id === second)).toBe(before);

    store().setFloorMaterial('floor-tiles-06');
    expect(store().design.room.floorMaterialId).toBe('floor-tiles-06');
  });

  it('removes a wall', () => {
    const id = store().addWall([0, 0], [4, 0])!;
    store().removeWall(id);
    expect(store().design.room.walls).toEqual([]);
  });
});
