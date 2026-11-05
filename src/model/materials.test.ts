import { describe, expect, it } from 'vitest';
import { createEmptyDesign, type Room } from './design';
import { materialById, MATERIALS, materialsFor } from './materials';
import { addWall, setFloorMaterial, setWallMaterial } from './room';

const seededFiles = Object.keys(import.meta.glob('../../seed/assets/**/*.webp'));

function square(): Room {
  let room = createEmptyDesign('Test').room;
  const corners: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  corners.forEach((corner, index) => {
    room = addWall(room, corner, corners[(index + 1) % corners.length]!);
  });
  return room;
}

describe('the material catalog', () => {
  it('offers a small set for floors and for walls', () => {
    expect(materialsFor('floor').length).toBeGreaterThanOrEqual(2);
    expect(materialsFor('wall').length).toBeGreaterThanOrEqual(2);
    expect(MATERIALS.length).toBeLessThanOrEqual(12);
  });

  it.each(MATERIALS.map((material) => [material.id, material] as const))('%s records its license and source, with all its maps present', (_, material) => {
    expect(material.license).toBe('CC0 1.0');
    expect(material.sourceUrl).toMatch(/^https:\/\/polyhaven\.com\/a\/\w+$/);
    for (const path of [material.url, material.normalUrl, material.roughnessUrl]) {
      expect(seededFiles).toContain(`../../seed/${path}`);
    }
    expect(material.dimensions[0]).toBeGreaterThan(0);
    expect(material.dimensions[1]).toBeGreaterThan(0);
  });

  it('does not treat a missing id as a material', () => {
    expect(materialById(undefined)).toBeUndefined();
    expect(materialById('nope')).toBeUndefined();
  });
});

describe('setWallMaterial', () => {
  const wallMaterial = materialsFor('wall')[0]!.id;

  it('changes only that wall: the others stay the same objects', () => {
    const room = square();
    const next = setWallMaterial(room, room.walls[1]!.id, wallMaterial);
    expect(next.walls[1]!.materialId).toBe(wallMaterial);
    for (const index of [0, 2, 3]) {
      expect(next.walls[index]).toBe(room.walls[index]);
      expect(next.walls[index]!.materialId).toBeUndefined();
    }
  });

  it('clears back to plain, leaving no key behind', () => {
    const room = square();
    const id = room.walls[0]!.id;
    const cleared = setWallMaterial(setWallMaterial(room, id, wallMaterial), id, undefined);
    expect('materialId' in cleared.walls[0]!).toBe(false);
  });

  it('refuses unknown ids, floor-only materials and unknown walls', () => {
    const room = square();
    const id = room.walls[0]!.id;
    expect(setWallMaterial(room, id, 'nope')).toBe(room);
    expect(setWallMaterial(room, id, materialsFor('floor')[0]!.id)).toBe(room);
    expect(setWallMaterial(room, 'nope', wallMaterial)).toBe(room);
  });

  it('is a no-op when nothing changes', () => {
    const room = square();
    const id = room.walls[0]!.id;
    expect(setWallMaterial(room, id, undefined)).toBe(room);
    const applied = setWallMaterial(room, id, wallMaterial);
    expect(setWallMaterial(applied, id, wallMaterial)).toBe(applied);
  });
});

describe('setFloorMaterial', () => {
  const floorMaterial = materialsFor('floor')[0]!.id;

  it('sets and clears the floor without touching the walls', () => {
    const room = square();
    const next = setFloorMaterial(room, floorMaterial);
    expect(next.floorMaterialId).toBe(floorMaterial);
    expect(next.walls).toBe(room.walls);
    expect('floorMaterialId' in setFloorMaterial(next, undefined)).toBe(false);
  });

  it('refuses unknown ids and wall-only materials', () => {
    const room = square();
    expect(setFloorMaterial(room, 'nope')).toBe(room);
    expect(setFloorMaterial(room, materialsFor('wall')[0]!.id)).toBe(room);
  });
});
