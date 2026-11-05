import { describe, expect, it } from 'vitest';
import { createEmptyDesign } from './design';
import { generateId, isDesignId } from './ids';
import { migrate, parseDesign } from './migrate';

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

describe('migrate', () => {
  it('returns a current design unchanged', () => {
    const design = createEmptyDesign('Test');
    expect(migrate(structuredClone(design))).toEqual(design);
    expect(parseDesign(JSON.stringify(design))).toEqual(design);
  });

  it.each([[null], ['text'], [{}], [{ schemaVersion: 2 }], [{ schemaVersion: '1' }]])(
    'rejects %j',
    (doc) => expect(() => migrate(doc)).toThrow(),
  );
});
