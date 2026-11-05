import { describe, expect, it } from 'vitest';
import type { Room, Vec2, Vec3, Wall } from '../model/design';
import { fittedStoredView, framedView, OVERVIEW_POSITION, viewPresets, type RoomBounds } from './cameraViews';
import { buildRoomGeometry } from './roomGeometry';
import { imageFileName } from './capture';

function rectangleRoom(width: number, depth: number): Room {
  const corners: Vec2[] = [
    [0, 0],
    [width, 0],
    [width, depth],
    [0, depth],
  ];
  const walls: Wall[] = corners.map((start, index) => ({ id: `w${index}`, start, end: corners[(index + 1) % 4]!, thickness: 0.1 }));
  return { wallHeight: 2.5, walls, openings: [] };
}

const room = rectangleRoom(4, 3);
const bounds = buildRoomGeometry(room).bounds!;
const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('framedView', () => {
  it('looks at the middle of the room from the given direction', () => {
    const { position, target } = framedView(bounds, 2.5, 1.5, OVERVIEW_POSITION);
    expect(target).toEqual([bounds.center[0], 1.25, bounds.center[1]]);
    const offset: Vec3 = [position[0] - target[0], position[1] - target[1], position[2] - target[2]];
    const scale = offset[0] / OVERVIEW_POSITION[0];
    expect(offset[1] / OVERVIEW_POSITION[1]).toBeCloseTo(scale);
    expect(offset[2] / OVERVIEW_POSITION[2]).toBeCloseTo(scale);
  });

  it('stands further back on a portrait canvas, and no further than the height needs on a wide one', () => {
    const portrait = framedView(bounds, 2.5, 0.5, OVERVIEW_POSITION);
    const square = framedView(bounds, 2.5, 1, OVERVIEW_POSITION);
    const wide = framedView(bounds, 2.5, 2, OVERVIEW_POSITION);
    expect(distance(portrait.position, portrait.target)).toBeGreaterThan(distance(square.position, square.target));
    expect(distance(wide.position, wide.target)).toBeCloseTo(distance(square.position, square.target));
  });

  it('frames an empty design around the origin', () => {
    const { position, target } = framedView(null, 2.5, 1, OVERVIEW_POSITION);
    expect(target).toEqual([0, 1.25, 0]);
    expect(position.every(Number.isFinite)).toBe(true);
  });
});

describe('fittedStoredView', () => {
  const area: RoomBounds = { center: [0, 0], radius: 3 };
  const outside = { position: [8, 6, 0] as Vec3, target: [0, 1, 0] as Vec3 };
  const inside = { position: [1, 1.5, 1] as Vec3, target: [0, 1, 0] as Vec3 };

  it('keeps a view unchanged on a wide or square canvas', () => {
    expect(fittedStoredView(outside, area, 1.6)).toEqual(outside);
    expect(fittedStoredView(outside, area, 1)).toEqual(outside);
  });

  it('moves back along the same line on a portrait canvas, looking at the same point', () => {
    const fitted = fittedStoredView(outside, area, 0.5);
    expect(fitted.target).toEqual(outside.target);
    expect(fitted.position).toEqual([16, 11, 0]);
  });

  it("doesn't move a view from inside the room back through a wall", () => {
    expect(fittedStoredView(inside, area, 0.5)).toEqual(inside);
  });
});

describe('viewPresets', () => {
  it('offers overview, top and eye level for a closed room', () => {
    expect(viewPresets(room, bounds, []).map((preset) => preset.name)).toEqual(['Overview', 'Top', 'Eye level']);
  });

  it('opens at the shared view', () => {
    const shared = { name: 'Shared view', position: [9, 9, 9] as Vec3, target: [1, 1, 1] as Vec3 };
    const [first] = viewPresets(room, bounds, [shared]);
    expect(first!.name).toBe('Shared view');
    expect(first!.view(1.5)).toEqual({ position: shared.position, target: shared.target });
  });

  it('ignores a stored camera that is malformed', () => {
    const damaged = { name: 'Broken', position: [1, Number.NaN, 1], target: 'nope' } as never;
    expect(viewPresets(room, bounds, [damaged]).map((preset) => preset.name)).toEqual(['Overview', 'Top', 'Eye level']);
  });

  it('has no eye level without a closed room, and still offers the rest', () => {
    const open: Room = { wallHeight: 2.5, walls: [{ id: 'w', start: [0, 0], end: [3, 0], thickness: 0.1 }], openings: [] };
    expect(viewPresets(open, buildRoomGeometry(open).bounds, []).map((preset) => preset.name)).toEqual(['Overview', 'Top']);
    expect(viewPresets({ wallHeight: 2.5, walls: [], openings: [] }, null, []).map((preset) => preset.name)).toEqual(['Overview', 'Top']);
  });

  it('puts the eye-level camera inside the room, below the ceiling, looking across it', () => {
    const eye = viewPresets(room, bounds, []).find((preset) => preset.name === 'Eye level')!.view(0.5);
    const [x, y, z] = eye.position;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(4);
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThan(3);
    expect(y).toBeGreaterThan(1);
    expect(y).toBeLessThan(2.5);
    expect(eye.target[0]).toBeCloseTo(2);
    expect(eye.target[2]).toBeCloseTo(1.5);
  });

  it('keeps eye level under a very low ceiling', () => {
    const low = { ...room, wallHeight: 1.2 };
    const eye = viewPresets(low, bounds, []).find((preset) => preset.name === 'Eye level')!.view(1);
    expect(eye.position[1]).toBeLessThan(1.2);
    expect(eye.target[1]).toBeLessThanOrEqual(eye.position[1]);
  });
});

describe('imageFileName', () => {
  it('uses the design name', () => {
    expect(imageFileName('Living room')).toBe('Living room.png');
    expect(imageFileName('Café 🪑')).toBe('Café 🪑.png');
  });

  it('removes what file systems refuse', () => {
    expect(imageFileName('a/b\\c:d*e?"f<g>h|i')).toBe('a b c d e f g h i.png');
    expect(imageFileName('..secret..')).toBe('secret.png');
  });

  it('falls back when nothing is left', () => {
    expect(imageFileName(' /// ')).toBe('design.png');
  });
});
