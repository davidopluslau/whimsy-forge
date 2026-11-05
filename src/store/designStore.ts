import { create } from 'zustand';
import { createEmptyDesign, type Design, type Item, type Opening, type Room, type Vec2 } from '../model/design';
import * as items from '../model/items';
import * as openings from '../model/openings';
import * as room from '../model/room';

/** The parts of a design that edits change. Undo and redo restore these and nothing else. */
export type Document = Pick<Design, 'room' | 'items'>;

/** One undoable step, as the document before it and after it. Undo applies `before`, redo applies `after`. */
export type Command = { before: Document; after: Document };

/** Older steps are dropped beyond this, so a long session stays bounded in memory. */
export const HISTORY_LIMIT = 200;

type ItemPatch = Partial<Omit<Item, 'id'>>;

type DesignStore = {
  design: Design;
  /** Steps that undo can reverse, oldest first. */
  past: Command[];
  /** Steps that were undone, most recent first. */
  future: Command[];
  /** The document when the current gesture began; null outside a gesture. */
  gestureBase: Document | null;
  setDesign: (design: Design) => void;
  /**
   * Groups the edits made until `endGesture` into one undo step, e.g. a drag. Edits still apply at once,
   * so the view follows the pointer; only the history waits.
   */
  beginGesture: () => void;
  endGesture: () => void;
  /** Returns whether a step was undone. */
  undo: () => boolean;
  /** Returns whether a step was redone. */
  redo: () => boolean;
  /** Returns the new wall's id, or null if the wall was rejected. */
  addWall: (start: Vec2, end: Vec2) => string | null;
  /** Removes the wall and any items hung on it. */
  removeWall: (id: string) => void;
  /** Returns whether the length was applied. */
  setWallLength: (id: string, length: number) => boolean;
  /** Returns whether the height was applied. */
  setWallHeight: (height: number) => boolean;
  setWallMaterial: (id: string, materialId: string | undefined) => void;
  setFloorMaterial: (materialId: string | undefined) => void;
  /** Returns the new opening's id, or null if there was no room for it. */
  addOpening: (wallId: string, kind: Opening['kind'], center: number) => string | null;
  removeOpening: (id: string) => void;
  moveOpening: (id: string, offset: number) => void;
  dragOpeningEdge: (id: string, edge: 'start' | 'end', position: number) => void;
  /** Returns whether the values were applied. */
  updateOpening: (id: string, patch: openings.OpeningPatch) => boolean;
  /** Returns the item's id. */
  addItem: (item: Item) => string;
  removeItem: (id: string) => void;
  /** Returns whether the item changed. */
  updateItem: (id: string, patch: ItemPatch) => boolean;
  /** Returns the copy's id, or null if the item isn't there. */
  duplicateItem: (id: string, newId: string) => string | null;
  nudgeItem: (id: string, dx: number, dz: number) => boolean;
  rotateItem: (id: string, angle: number) => boolean;
};

const pick = (design: Design): Document => ({ room: design.room, items: design.items });
const stamp = (design: Design): Design => ({ ...design, updatedAt: new Date().toISOString() });

export const useDesignStore = create<DesignStore>((set, get) => {
  /** Applies a design edit. Returns false if it returned the same design, which means a refusal. */
  function commit(edit: (current: Design) => Design): boolean {
    const { design, gestureBase, past } = get();
    const next = edit(design);
    if (next === design) return false;
    const stamped = stamp(next);
    if (gestureBase) {
      set({ design: stamped });
    } else {
      set({ design: stamped, past: [...past, { before: pick(design), after: pick(stamped) }].slice(-HISTORY_LIMIT), future: [] });
    }
    return true;
  }

  /** Applies a pure room edit. Wall items follow their walls, and go if their wall goes. */
  function updateRoom(edit: (current: Room) => Room): boolean {
    return commit((design) => {
      const nextRoom = edit(design.room);
      if (nextRoom === design.room) return design;
      return { ...design, room: nextRoom, items: items.followWalls(nextRoom, design.items) };
    });
  }

  /** Applies an edit to one item. Returns false when the item is missing or nothing changed. */
  function updateItemWith(id: string, edit: (item: Item) => Item): boolean {
    return commit((design) => {
      const index = design.items.findIndex((item) => item.id === id);
      if (index === -1) return design;
      const current = design.items[index]!;
      const updated = edit(current);
      if (JSON.stringify(updated) === JSON.stringify(current)) return design;
      return { ...design, items: design.items.map((item, position) => (position === index ? updated : item)) };
    });
  }

  return {
    design: createEmptyDesign('Untitled design'),
    past: [],
    future: [],
    gestureBase: null,
    setDesign: (design) => set({ design, past: [], future: [], gestureBase: null }),
    beginGesture: () => {
      if (!get().gestureBase) set({ gestureBase: pick(get().design) });
    },
    endGesture: () => {
      const { gestureBase, design, past } = get();
      if (!gestureBase) return;
      const changed = design.room !== gestureBase.room || design.items !== gestureBase.items;
      set({
        gestureBase: null,
        ...(changed ? { past: [...past, { before: gestureBase, after: pick(design) }].slice(-HISTORY_LIMIT), future: [] } : {}),
      });
    },
    undo: () => {
      const { past, future, design, gestureBase } = get();
      const command = past.at(-1);
      if (!command || gestureBase) return false;
      set({ design: stamp({ ...design, ...command.before }), past: past.slice(0, -1), future: [command, ...future] });
      return true;
    },
    redo: () => {
      const { past, future, design, gestureBase } = get();
      const command = future[0];
      if (!command || gestureBase) return false;
      set({ design: stamp({ ...design, ...command.after }), past: [...past, command], future: future.slice(1) });
      return true;
    },

    addWall: (start, end) => (updateRoom((current) => room.addWall(current, start, end)) ? get().design.room.walls.at(-1)!.id : null),
    removeWall: (id) => {
      updateRoom((current) => room.removeWall(current, id));
    },
    setWallLength: (id, length) => updateRoom((current) => room.setWallLength(current, id, length)),
    setWallHeight: (height) => updateRoom((current) => room.setWallHeight(current, height)),
    setWallMaterial: (id, materialId) => {
      updateRoom((current) => room.setWallMaterial(current, id, materialId));
    },
    setFloorMaterial: (materialId) => {
      updateRoom((current) => room.setFloorMaterial(current, materialId));
    },
    addOpening: (wallId, kind, center) => (updateRoom((current) => openings.addOpening(current, wallId, kind, center)) ? get().design.room.openings.at(-1)!.id : null),
    removeOpening: (id) => {
      updateRoom((current) => openings.removeOpening(current, id));
    },
    moveOpening: (id, offset) => {
      updateRoom((current) => openings.moveOpening(current, id, offset));
    },
    dragOpeningEdge: (id, edge, position) => {
      updateRoom((current) => openings.dragOpeningEdge(current, id, edge, position));
    },
    updateOpening: (id, patch) => updateRoom((current) => openings.updateOpening(current, id, patch)),

    addItem: (item) => {
      commit((design) => ({ ...design, items: [...design.items, item] }));
      return item.id;
    },
    removeItem: (id) => {
      commit((design) => (design.items.some((item) => item.id === id) ? { ...design, items: design.items.filter((item) => item.id !== id) } : design));
    },
    updateItem: (id, patch) => updateItemWith(id, (item) => ({ ...item, ...patch })),
    duplicateItem: (id, newId) => {
      const original = get().design.items.find((item) => item.id === id);
      if (!original) return null;
      const placed = items.duplicateItem(get().design.room, original);
      commit((design) => ({ ...design, items: [...design.items, { ...original, ...placed, id: newId }] }));
      return newId;
    },
    nudgeItem: (id, dx, dz) => updateItemWith(id, (item) => items.nudgeItem(get().design.room, item, dx, dz)),
    rotateItem: (id, angle) => updateItemWith(id, (item) => items.rotateItem(item, angle)),
  };
});
