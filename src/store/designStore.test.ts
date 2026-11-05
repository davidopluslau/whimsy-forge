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

  it('removes a wall', () => {
    const id = store().addWall([0, 0], [4, 0])!;
    store().removeWall(id);
    expect(store().design.room.walls).toEqual([]);
  });
});
