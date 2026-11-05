import { create } from 'zustand';
import { createEmptyDesign, type Design, type Opening, type Room, type Vec2 } from '../model/design';
import * as openings from '../model/openings';
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
  setWallMaterial: (id: string, materialId: string | undefined) => void;
  setFloorMaterial: (materialId: string | undefined) => void;
  /** Returns the new opening's id, or null if there was no room for it. */
  addOpening: (wallId: string, kind: Opening['kind'], center: number) => string | null;
  removeOpening: (id: string) => void;
  moveOpening: (id: string, offset: number) => void;
  dragOpeningEdge: (id: string, edge: 'start' | 'end', position: number) => void;
  /** Returns whether the values were applied. */
  updateOpening: (id: string, patch: openings.OpeningPatch) => boolean;
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
  };
});
