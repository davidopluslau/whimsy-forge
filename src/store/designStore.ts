import { create } from 'zustand';
import { createEmptyDesign, type Design, type Room, type Vec2 } from '../model/design';
import * as room from '../model/room';

type DesignStore = {
  design: Design;
  setDesign: (design: Design) => void;
  /** Returns the new wall's id, or null if the wall was rejected. */
  addWall: (start: Vec2, end: Vec2) => string | null;
  removeWall: (id: string) => void;
  /** Returns whether the length was applied. */
  setWallLength: (id: string, length: number) => boolean;
  /** Returns whether the height was applied. */
  setWallHeight: (height: number) => boolean;
};

export const useDesignStore = create<DesignStore>((set, get) => {
  /** Applies a pure room edit. Returns false if it left the room unchanged. */
  function updateRoom(edit: (current: Room) => Room): boolean {
    const { design } = get();
    const next = edit(design.room);
    if (next === design.room) return false;
    set({ design: { ...design, room: next, updatedAt: new Date().toISOString() } });
    return true;
  }

  return {
    design: createEmptyDesign('Untitled design'),
    setDesign: (design) => set({ design }),
    addWall: (start, end) => (updateRoom((current) => room.addWall(current, start, end)) ? get().design.room.walls.at(-1)!.id : null),
    removeWall: (id) => {
      updateRoom((current) => room.removeWall(current, id));
    },
    setWallLength: (id, length) => updateRoom((current) => room.setWallLength(current, id, length)),
    setWallHeight: (height) => updateRoom((current) => room.setWallHeight(current, height)),
  };
});
