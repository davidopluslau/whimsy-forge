import { CURRENT_SCHEMA_VERSION, type Design } from './design';

export type StoredDoc = Record<string, unknown>;

/** A pure step from one schema version to the next. It must not change its input. */
export type Migration = (doc: Readonly<StoredDoc>) => StoredDoc;

/** A schema version and the steps that reach it, each keyed by the version it starts from. */
export type Schema = { version: number; steps: Readonly<Record<number, Migration>> };

/**
 * To change the schema: bump `CURRENT_SCHEMA_VERSION`, then add the step from the previous version
 * here. Leave `fixtures/design-v1.json` as it is: it stands for documents already in storage.
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

const CURRENT_SCHEMA: Schema = { version: CURRENT_SCHEMA_VERSION, steps: MIGRATIONS };

/** The document was saved by a newer build than this one, so it must not be opened or rewritten. */
export class NewerSchemaError extends Error {
  readonly found: number;
  readonly supported: number;

  constructor(found: number, supported: number) {
    super(
      `This design was saved by a newer version of Whimsy Forge (schema ${found}), and this version only reads up to schema ${supported}. ` +
        'Reload the page to get the latest version. The design has not been changed.',
    );
    this.name = 'NewerSchemaError';
    this.found = found;
    this.supported = supported;
  }
}

/** The document is not a design at all, or is missing parts that every design has. */
export class UnreadableDesignError extends Error {
  constructor(reason: string) {
    super(`This design can't be read: ${reason}.`);
    this.name = 'UnreadableDesignError';
  }
}

const isRecord = (value: unknown): value is StoredDoc => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Checks the parts the editor reads without a guard, so a damaged file gets a message and not a crash. */
function checkShape(doc: StoredDoc): void {
  const { id, name, room, items, cameras } = doc;
  if (typeof id !== 'string' || typeof name !== 'string') throw new UnreadableDesignError('its id or name is missing');
  if (!isRecord(room) || typeof room.wallHeight !== 'number' || !Array.isArray(room.walls) || !Array.isArray(room.openings)) {
    throw new UnreadableDesignError('its room is incomplete');
  }
  if (!Array.isArray(items) || !Array.isArray(cameras)) throw new UnreadableDesignError('its item list is missing');
}

/** Brings a stored document up to the schema, one pure step at a time. Throws if it can't. */
export function migrate(doc: unknown, schema: Schema = CURRENT_SCHEMA): Design {
  if (!isRecord(doc)) throw new UnreadableDesignError('it is not a design document');
  const { schemaVersion } = doc;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new UnreadableDesignError('its schema version is not valid');
  }
  if (schemaVersion > schema.version) throw new NewerSchemaError(schemaVersion, schema.version);

  let current: StoredDoc = doc;
  for (let version = schemaVersion; version < schema.version; version++) {
    const step = schema.steps[version];
    if (!step) throw new Error(`No migration from schema ${version} to ${version + 1}`);
    current = { ...step(current), schemaVersion: version + 1 };
  }
  checkShape(current);
  return current as Design;
}

export function parseDesign(json: string, schema: Schema = CURRENT_SCHEMA): Design {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    throw new UnreadableDesignError('it is not valid JSON');
  }
  return migrate(doc, schema);
}
