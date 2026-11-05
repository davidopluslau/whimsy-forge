import { generateId } from './ids';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** All lengths are meters. */
export type Design = {
  schemaVersion: 1;
  id: string;
  name: string;
  updatedAt: string;
  room: {
    wallHeight: number;
    walls: { id: string; start: Vec2; end: Vec2; thickness: number; materialId?: string }[];
    openings: {
      id: string;
      wallId: string;
      kind: 'door' | 'window';
      offset: number;
      width: number;
      height: number;
      sill: number;
    }[];
    floorMaterialId?: string;
  };
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
