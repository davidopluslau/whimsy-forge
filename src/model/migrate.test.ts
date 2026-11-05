import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, createEmptyDesign } from './design';
import fixture from './fixtures/design-v1.json';
import { migrate, MIGRATIONS, NewerSchemaError, parseDesign, UnreadableDesignError, type Schema } from './migrate';

/** Throws on any write, so a step that mutates its input fails the test. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('migrate at the current schema', () => {
  it('returns a current design unchanged', () => {
    const design = createEmptyDesign('Test');
    expect(migrate(structuredClone(design))).toEqual(design);
    expect(parseDesign(JSON.stringify(design))).toEqual(design);
  });

  it('has a step from every older version', () => {
    for (let version = 1; version < CURRENT_SCHEMA_VERSION; version++) expect(MIGRATIONS[version], `step from ${version}`).toBeTypeOf('function');
  });

  it('brings the v1 fixture up to the current schema, whatever that is', () => {
    const design = migrate(deepFreeze(structuredClone(fixture)));
    expect(design.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(design.room.walls).toHaveLength(4);
    expect(design.items).toHaveLength(3);
  });
});

describe('migrate with steps', () => {
  const schema: Schema = {
    version: 3,
    steps: {
      1: (doc) => ({ ...doc, name: `${String(doc.name)} (v2)` }),
      2: (doc) => ({ ...doc, name: `${String(doc.name)} (v3)` }),
    },
  };

  it('runs each step in order and sets the version', () => {
    const design = migrate(deepFreeze(structuredClone(fixture)), schema);
    expect(design.name).toBe('Schema 1 fixture (v2) (v3)');
    expect(design.schemaVersion).toBe(3);
  });

  it('starts from the version the document is at', () => {
    const atTwo = { ...structuredClone(fixture), schemaVersion: 2 };
    expect(migrate(atTwo, schema).name).toBe('Schema 1 fixture (v3)');
  });

  it('leaves its input as it was', () => {
    const input = structuredClone(fixture);
    migrate(input, schema);
    expect(input).toEqual(fixture);
  });

  it('fails plainly if a step is missing', () => {
    expect(() => migrate(structuredClone(fixture), { version: 2, steps: {} })).toThrow('No migration from schema 1 to 2');
  });
});

describe('documents that are refused', () => {
  it('refuses a newer schema with a message that says what to do', () => {
    const newer = { ...structuredClone(fixture), schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
    expect(() => migrate(newer)).toThrow(NewerSchemaError);
    expect(() => migrate(newer)).toThrow(/newer version of Whimsy Forge.*Reload the page/);
  });

  it('checks for a newer schema before anything else, since a newer shape is unknown', () => {
    expect(() => migrate({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 })).toThrow(NewerSchemaError);
  });

  const withRoom = (room: unknown) => ({ ...structuredClone(fixture), room });

  it.each([
    ['null', null],
    ['text', 'text'],
    ['an array', []],
    ['no version', {}],
    ['a text version', { schemaVersion: '1' }],
    ['a fractional version', { schemaVersion: 1.5 }],
    ['version 0', { schemaVersion: 0 }],
    ['no room', withRoom(undefined)],
    ['no walls', withRoom({ wallHeight: 2.5, openings: [] })],
    ['no items', { ...structuredClone(fixture), items: undefined }],
  ])('calls %s unreadable', (_name, doc) => {
    expect(() => migrate(doc)).toThrow(UnreadableDesignError);
  });

  it('calls bad JSON unreadable', () => {
    expect(() => parseDesign('{nope')).toThrow(UnreadableDesignError);
  });
});
