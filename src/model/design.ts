import { generateId } from './ids';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/**
 * A wall's start and end trace its room-side face wherever the wall is part of the closed outline,
 * so the drawn lengths are the room's inside dimensions. Thickness extends away from the room.
 * Walls outside the outline (partitions, unfinished runs) are centered on the line instead.
 */
export type Wall = { id: string; start: Vec2; end: Vec2; thickness: number; materialId?: string };

/**
 * A hole through a wall. `offset` runs from the wall's start to the opening's near edge; `sill` is
 * the height of its bottom edge above the floor, always 0 for a door. See `isOpeningValid` for the limits.
 */
export type Opening = {
  id: string;
  wallId: string;
  kind: 'door' | 'window';
  offset: number;
  width: number;
  height: number;
  sill: number;
};

export type Room = {
  wallHeight: number;
  walls: Wall[];
  openings: Opening[];
  floorMaterialId?: string;
};

/**
 * A placed catalog asset or uploaded photo. `position` is the bottom center of the item: x and z on
 * the floor, y its height above the floor. `size` is the footprint in meters, copied at placement so
 * geometry never needs the catalog. A floor item's front faces +z at rotationY 0. A wall item's front
 * faces away from `wallId`, its wall. A photo's `assetId` is `photo:<uploadId>`.
 */
export type Item = {
  id: string;
  assetId: string;
  position: Vec3;
  rotationY: number;
  size: Vec3;
  mount: 'floor' | 'wall' | 'ceiling';
  wallId?: string;
  materialOverrides?: Record<string, string>;
};

/** All lengths are meters. */
export type Design = {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  id: string;
  name: string;
  updatedAt: string;
  room: Room;
  items: Item[];
  cameras: { name: string; position: Vec3; target: Vec3 }[];
};

export const CURRENT_SCHEMA_VERSION = 1;

export function createEmptyDesign(name: string): Design {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: generateId(),
    name,
    updatedAt: new Date().toISOString(),
    room: { wallHeight: 2.5, walls: [], openings: [] },
    items: [],
    cameras: [],
  };
}

/** The longest name a design may have, in UTF-16 units. */
export const MAX_DESIGN_NAME_LENGTH = 100;

/** The name as it would be stored, or null if there is nothing left to name a design with. */
export function cleanDesignName(name: string): string | null {
  const cleaned = name.trim().slice(0, MAX_DESIGN_NAME_LENGTH).trim();
  return cleaned === '' ? null : cleaned;
}

/** The design under a new name, or the same object if the name is empty or unchanged. */
export function renamedDesign(design: Design, name: string): Design {
  const cleaned = cleanDesignName(name);
  return cleaned === null || cleaned === design.name ? design : { ...design, name: cleaned };
}

/** An independent copy under its own id. Items keep their ids, which are unique only within a design. */
export function copiedDesign(design: Design, id: string, updatedAt: string): Design {
  return { ...structuredClone(design), id, updatedAt, name: cleanDesignName(`Copy of ${design.name}`) ?? design.name };
}
