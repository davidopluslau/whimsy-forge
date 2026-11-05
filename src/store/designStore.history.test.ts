import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDesign, type Item } from '../model/design';
import * as items from '../model/items';
import { HISTORY_LIMIT, useDesignStore } from './designStore';

const store = () => useDesignStore.getState();

const sofa = (id: string, x = 1): Item => ({ id, assetId: 'sofa', position: [x, 0, 1], rotationY: 0, size: [2, 0.8, 1], mount: 'floor' });

/** The design as JSON, minus the timestamp that every edit stamps. Undo must restore the rest exactly. */
const json = () => JSON.stringify({ ...store().design, updatedAt: '' });

beforeEach(() => store().setDesign({ ...createEmptyDesign('Test'), updatedAt: '2000-01-01T00:00:00.000Z' }));

describe('undo and redo', () => {
  it('reverses and reapplies a wall, step by step', () => {
    const empty = json();
    store().addWall([0, 0], [4, 0]);
    const oneWall = json();
    store().addWall([4, 0], [4, 3]);
    const twoWalls = json();

    expect(store().undo()).toBe(true);
    expect(json()).toBe(oneWall);
    expect(store().undo()).toBe(true);
    expect(json()).toBe(empty);
    expect(store().undo()).toBe(false);

    expect(store().redo()).toBe(true);
    expect(json()).toBe(oneWall);
    expect(store().redo()).toBe(true);
    expect(json()).toBe(twoWalls);
    expect(store().redo()).toBe(false);
  });

  it('clears redo once a new edit is made', () => {
    store().addWall([0, 0], [4, 0]);
    store().undo();
    store().addWall([0, 0], [0, 4]);
    expect(store().redo()).toBe(false);
  });

  it('undoes item placement, movement, rotation and removal', () => {
    store().addItem(sofa('s'));
    const placed = json();
    store().updateItem('s', { position: [3, 0, 2] });
    store().rotateItem('s', Math.PI / 2);
    const moved = json();
    store().removeItem('s');
    expect(store().design.items).toEqual([]);

    store().undo();
    expect(json()).toBe(moved);
    store().undo();
    store().undo();
    expect(json()).toBe(placed);
  });

  it('records every kind of change: walls, openings, materials and items', () => {
    const start = json();
    const wallId = store().addWall([0, 0], [4, 0])!;
    store().setWallMaterial(wallId, 'paint-white');
    store().setFloorMaterial('oak');
    store().addItem(sofa('s'));
    for (let step = 0; step < 4; step++) store().undo();
    expect(json()).toBe(start);
  });

  it('applies a removed wall\'s items being dropped, and restores them on undo', () => {
    const wallId = store().addWall([0, 0], [4, 0])!;
    store().addWall([4, 0], [4, 3]);
    store().addWall([4, 3], [0, 3]);
    store().addWall([0, 3], [0, 0]);
    const wallItem = { ...sofa('p'), mount: 'wall' as const, ...items.placeOnWall(store().design.room, wallId, [2, 0.5], [0.6, 0.4, 0.03], 1.2, null)! };
    store().addItem(wallItem);
    const withPicture = json();

    store().removeWall(wallId);
    expect(store().design.items.map((candidate) => candidate.id)).toEqual([]);

    store().undo();
    expect(json()).toBe(withPicture);
  });

  it('keeps no more than HISTORY_LIMIT steps', () => {
    for (let index = 0; index < HISTORY_LIMIT + 10; index++) store().addItem(sofa(`s${index}`, index * 0.1));
    expect(store().past).toHaveLength(HISTORY_LIMIT);
  });

  it('reports a refused edit as not applied and records nothing', () => {
    expect(store().updateItem('missing', { rotationY: 1 })).toBe(false);
    expect(store().past).toHaveLength(0);
  });

  it('starts fresh when a new design is loaded', () => {
    store().addItem(sofa('s'));
    store().setDesign(createEmptyDesign('Other'));
    expect(store().past).toHaveLength(0);
    expect(store().undo()).toBe(false);
  });
});

describe('gestures', () => {
  it('turns a whole drag into one undo step, while the design follows each move', () => {
    store().addItem(sofa('s', 1));
    const before = json();

    store().beginGesture();
    store().updateItem('s', { position: [1.5, 0, 1] });
    store().updateItem('s', { position: [2, 0, 1] });
    store().updateItem('s', { position: [2.5, 0, 1] });
    expect(store().design.items[0]!.position[0]).toBe(2.5);
    store().endGesture();

    expect(store().past).toHaveLength(2);
    store().undo();
    expect(json()).toBe(before);
  });

  it('records nothing for a gesture that changed nothing', () => {
    store().addItem(sofa('s'));
    const steps = store().past.length;
    store().beginGesture();
    store().endGesture();
    expect(store().past).toHaveLength(steps);
  });

  it('cannot undo in the middle of a gesture', () => {
    store().addItem(sofa('s'));
    store().beginGesture();
    store().updateItem('s', { rotationY: 1 });
    expect(store().undo()).toBe(false);
    store().endGesture();
  });
});

describe('item actions', () => {
  it('duplicates an item beside the original with the new id, as one step', () => {
    store().addItem(sofa('s'));
    expect(store().duplicateItem('s', 'copy')).toBe('copy');
    const [original, copy] = store().design.items;
    expect(copy!.id).toBe('copy');
    expect(copy!.position[0]).toBeCloseTo(original!.position[0] + items.DUPLICATE_OFFSET, 6);
    store().undo();
    expect(store().design.items.map((candidate) => candidate.id)).toEqual(['s']);
  });

  it('nudges a floor item and reports whether it moved', () => {
    store().addItem(sofa('s', 1));
    expect(store().nudgeItem('s', items.NUDGE_STEP, 0)).toBe(true);
    expect(store().design.items[0]!.position[0]).toBeCloseTo(1 + items.NUDGE_STEP, 6);
    expect(store().nudgeItem('missing', 1, 1)).toBe(false);
  });

  it('keeps every item in the design JSON that the view is derived from', () => {
    store().addItem(sofa('a'));
    store().addItem(sofa('b', 4));
    const saved = JSON.parse(json()) as { items: Item[] };
    expect(saved.items.map((candidate) => candidate.id)).toEqual(['a', 'b']);
    expect(saved.items[1]!.size).toEqual([2, 0.8, 1]);
  });
});
