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

/** All lengths are meters. */
export type Design = {
  schemaVersion: 1;
  id: string;
  name: string;
  updatedAt: string;
  room: Room;
  items: {
    id: string;
    assetId: string;
    position: Vec3;
    rotationY: number;
    scale: Vec3;
    mount: 'floor' | 'wall' | 'ceiling';
    wallId?: string;
    materialOverrides?: Record<string, string>;
  }[];
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
