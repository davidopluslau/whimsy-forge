import { describe, expect, it } from 'vitest';
import fixture from '../model/fixtures/design-v1.json';
import { parseDesign, type Schema } from '../model/migrate';
import { buildRoomGeometry } from '../scene/roomGeometry';
import { useDesignStore } from './designStore';

/**
 * Proves the migration path: a v1 file on disk still opens after the schema moves to v2. The bump is a
 * realistic one (every wall gains a required field), and it's made
 * only here, so the app's real version stays where it is.
 */
const BUMPED: Schema = {
  version: 2,
  steps: {
    1: (doc) => {
      const room = doc.room as { walls: object[] };
      return { ...doc, room: { ...room, walls: room.walls.map((wall) => ({ ...wall, baseboard: false })) } };
    },
  },
};

describe('a schema bump to v2', () => {
  const fixtureText = JSON.stringify(fixture);

  it('opens the v1 fixture with nothing lost', () => {
    const design = parseDesign(fixtureText, BUMPED);
    expect(design.schemaVersion).toBe(2);
    expect(design.name).toBe(fixture.name);
    expect(design.room.openings).toEqual(fixture.room.openings);
    expect(design.items).toEqual(fixture.items);
    expect(design.room.walls[0]).toEqual({ ...fixture.room.walls[0], baseboard: false });
  });

  it('gives the editor a design it can render and edit', () => {
    const design = parseDesign(fixtureText, BUMPED);
    const geometry = buildRoomGeometry(design.room);
    expect(geometry.walls).toHaveLength(4);
    expect(geometry.floor).not.toBeNull();

    const store = useDesignStore.getState();
    store.setDesign(design);
    expect(store.setWallHeight(3)).toBe(true);
    expect(useDesignStore.getState().design.room.wallHeight).toBe(3);
    expect(useDesignStore.getState().undo()).toBe(true);
    expect(useDesignStore.getState().design.room).toEqual(design.room);
  });

  it('then writes it back at v2, which opens without running the step again', () => {
    const saved = JSON.stringify(parseDesign(fixtureText, BUMPED));
    const reopened = parseDesign(saved, { version: 2, steps: {} });
    expect(reopened.schemaVersion).toBe(2);
    expect(reopened.room.walls).toHaveLength(4);
  });
});
