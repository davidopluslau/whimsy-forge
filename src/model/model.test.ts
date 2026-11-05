import { describe, expect, it } from 'vitest';
import { cleanDesignName, copiedDesign, createEmptyDesign, MAX_DESIGN_NAME_LENGTH, renamedDesign } from './design';
import { generateId, isDesignId } from './ids';

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
