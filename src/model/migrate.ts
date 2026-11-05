import { CURRENT_SCHEMA_VERSION, type Design } from './design';

/** Brings a stored document up to the current schema. Add a pure step per future version. */
export function migrate(doc: unknown): Design {
  if (typeof doc !== 'object' || doc === null) throw new Error('Design is not an object');
  const { schemaVersion } = doc as { schemaVersion?: unknown };
  if (schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported design schemaVersion: ${String(schemaVersion)}`);
  }
  return doc as Design;
}

export function parseDesign(json: string): Design {
  return migrate(JSON.parse(json));
}
