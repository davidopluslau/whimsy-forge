import { describe, expect, it } from 'vitest';
import { PRIVATE_STAND_IN } from './catalog';
import { cleanDesignName, copiedDesign, createEmptyDesign, type Item, MAX_DESIGN_NAME_LENGTH, privateItemCount, renamedDesign, snapshotOf } from './design';
import { generateId, isDesignId } from './ids';

describe('snapshotOf', () => {
  const design = createEmptyDesign('Kitchen');
  design.room.walls.push({ id: 'w', start: [0, 0], end: [1, 0], thickness: 0.1 });
  const SNAPSHOT_ID = generateId();
  const view = { position: [1, 2, 3] as [number, number, number], target: [0, 1, 0] as [number, number, number] };

  it("never carries the live design's id, which would let a viewer read the design", () => {
    const snapshot = snapshotOf(design, SNAPSHOT_ID, view);
    expect(snapshot.id).toBe(SNAPSHOT_ID);
    expect(JSON.stringify(snapshot)).not.toContain(design.id);
  });

  it('keeps what the design shows, and records where the owner was looking', () => {
    const snapshot = snapshotOf(design, SNAPSHOT_ID, view);
    expect(snapshot.name).toBe('Kitchen');
    expect(snapshot.room).toEqual(design.room);
    expect(snapshot.cameras).toEqual([{ name: 'Shared view', ...view }]);
    expect(snapshotOf(design, SNAPSHOT_ID, null).cameras).toEqual([]);
  });

  it('is independent of the design, which keeps changing', () => {
    const before = structuredClone(design);
    const snapshot = snapshotOf(design, SNAPSHOT_ID, view);
    expect(design).toEqual(before);
    expect(snapshot.room.walls).not.toBe(design.room.walls);
    expect(snapshot.room.walls[0]).not.toBe(design.room.walls[0]);
  });

  describe('with private items', () => {
    const PRIVATE_ID = 'private-AbCdEfGhIjKlMnOpQrSt_-';
    const item = (id: string, assetId: string): Item => ({ id, assetId, position: [1, 0, 2], rotationY: 0.5, size: [2, 0.8, 0.9], mount: 'floor' });
    const furnished = { ...design, items: [item('a', PRIVATE_ID), item('b', 'sofa'), item('c', 'private-oddly-named')] };

    it("never carries a private asset's id, and keeps each item's place and size", () => {
      const snapshot = snapshotOf(furnished, SNAPSHOT_ID, view);
      expect(JSON.stringify(snapshot)).not.toContain('private-');
      expect(snapshot.items).toEqual([{ ...item('a', PRIVATE_STAND_IN) }, item('b', 'sofa'), item('c', PRIVATE_STAND_IN)]);
      expect(furnished.items[0]!.assetId).toBe(PRIVATE_ID);
    });

    it('counts private items in the design and their stand-ins in the snapshot alike', () => {
      expect(privateItemCount(furnished.items)).toBe(2);
      expect(privateItemCount(snapshotOf(furnished, SNAPSHOT_ID, view).items)).toBe(2);
      expect(privateItemCount(design.items)).toBe(0);
    });
  });
});

describe('ids', () => {
  it('generates distinct 22-character URL-safe ids', () => {
    const ids = new Set(Array.from({ length: 200 }, generateId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(isDesignId(id)).toBe(true);
  });

  it.each(['', 'short', 'a'.repeat(21), 'a'.repeat(23), `${'a'.repeat(21)}/`, `${'a'.repeat(21)}.`])(
    'rejects %j',
    (id) => expect(isDesignId(id)).toBe(false),
  );
});

describe('design names', () => {
  const design = createEmptyDesign('Kitchen');

  it('cleans names, and refuses an empty one', () => {
    expect(cleanDesignName('  Den  ')).toBe('Den');
    expect(cleanDesignName('   ')).toBeNull();
    expect(cleanDesignName('x'.repeat(MAX_DESIGN_NAME_LENGTH + 5))).toHaveLength(MAX_DESIGN_NAME_LENGTH);
  });

  it('returns the same object when a rename changes nothing', () => {
    expect(renamedDesign(design, ' Kitchen ')).toBe(design);
    expect(renamedDesign(design, '')).toBe(design);
    expect(renamedDesign(design, 'Den').name).toBe('Den');
  });

  it('copies a design under a new id, sharing nothing with the original', () => {
    const copy = copiedDesign(design, 'new-id', '2030-01-01T00:00:00.000Z');
    expect(copy).toMatchObject({ id: 'new-id', name: 'Copy of Kitchen', updatedAt: '2030-01-01T00:00:00.000Z' });
    expect(copy.room).toEqual(design.room);
    expect(copy.room).not.toBe(design.room);
  });

  it('keeps a copy of a long name within the limit', () => {
    const long = createEmptyDesign('x'.repeat(MAX_DESIGN_NAME_LENGTH));
    expect(copiedDesign(long, 'id', '').name).toHaveLength(MAX_DESIGN_NAME_LENGTH);
  });
});
