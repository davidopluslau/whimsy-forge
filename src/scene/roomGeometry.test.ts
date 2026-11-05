import { describe, expect, it } from 'vitest';
import { createEmptyDesign, type Room, type Vec2 } from '../model/design';
import { addWall } from '../model/room';
import { buildRoomGeometry, wallPrism } from './roomGeometry';

const CENTIMETER = 0.01;

function roomFrom(points: Vec2[], closed = true): Room {
  let room = createEmptyDesign('Test').room;
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) room = addWall(room, points[i]!, points[(i + 1) % points.length]!);
  return room;
}

type Triangle = [number[], number[], number[]];

function triangles(positions: Float32Array): Triangle[] {
  const result: Triangle[] = [];
  for (let i = 0; i < positions.length; i += 9) {
    const at = (offset: number) => [positions[i + offset]!, positions[i + offset + 1]!, positions[i + offset + 2]!];
    result.push([at(0), at(3), at(6)]);
  }
  return result;
}

function normal([a, b, c]: Triangle) {
  const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
  const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
  return [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!] as const;
}

const triangleArea = (triangle: Triangle) => Math.hypot(...normal(triangle)) / 2;
const totalArea = (positions: Float32Array) => triangles(positions).reduce((sum, triangle) => sum + triangleArea(triangle), 0);

/** Volume by the divergence theorem. Only positive and correct if every face points outward. */
function signedVolume(positions: Float32Array) {
  return triangles(positions).reduce((sum, [a, b, c]) => {
    const cross = [b[1]! * c[2]! - b[2]! * c[1]!, b[2]! * c[0]! - b[0]! * c[2]!, b[0]! * c[1]! - b[1]! * c[0]!];
    return sum + (a[0]! * cross[0]! + a[1]! * cross[1]! + a[2]! * cross[2]!) / 6;
  }, 0);
}

function pointInFloor(positions: Float32Array, x: number, z: number) {
  return triangles(positions).some(([a, b, c]) => {
    const side = (p: number[], q: number[]) => (q[0]! - p[0]!) * (z - p[2]!) - (q[2]! - p[2]!) * (x - p[0]!);
    const [d1, d2, d3] = [side(a, b), side(b, c), side(c, a)];
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  });
}

describe('wall dimensions in 3D', () => {
  const room = roomFrom([[0, 0], [4, 0], [4, 5], [0, 5]]);
  const geometry = buildRoomGeometry(room);

  /** Corner-to-corner spans of the wall's room-side face, read back from the 3D vertices. */
  function roomSideSpan(wallIndex: number) {
    const wall = room.walls[wallIndex]!;
    const vertices = triangles(geometry.walls[wallIndex]!.positions).flat();
    const has = ([x, y]: Vec2, height: number) =>
      vertices.some((v) => Math.abs(v[0]! - x) < 1e-5 && Math.abs(v[1]! - height) < 1e-5 && Math.abs(v[2]! - y) < 1e-5);
    for (const corner of [wall.start, wall.end]) {
      expect(has(corner, 0)).toBe(true);
      expect(has(corner, room.wallHeight)).toBe(true);
    }
    return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
  }

  it('a 4 × 5 m room has walls of 4 and 5 m on the room side, within 1 cm', () => {
    expect(Math.abs(roomSideSpan(0) - 4)).toBeLessThan(CENTIMETER);
    expect(Math.abs(roomSideSpan(1) - 5)).toBeLessThan(CENTIMETER);
    expect(Math.abs(roomSideSpan(2) - 4)).toBeLessThan(CENTIMETER);
    expect(Math.abs(roomSideSpan(3) - 5)).toBeLessThan(CENTIMETER);
  });

  it('extrudes every wall from the floor to wallHeight', () => {
    for (const wall of geometry.walls) {
      const heights = triangles(wall.positions).flat().map((v) => v[1]!);
      expect(Math.min(...heights)).toBe(0);
      expect(Math.max(...heights)).toBeCloseTo(room.wallHeight, 5);
    }
  });

  it('a wall is as thick as its thickness, and sits outside the room', () => {
    const north = triangles(geometry.walls[0]!.positions).flat();
    const zs = north.map((v) => v[2]!);
    expect(Math.max(...zs)).toBeCloseTo(0, 5);
    expect(Math.min(...zs)).toBeCloseTo(-room.walls[0]!.thickness, 5);
  });

  it('walls have the right volume, with outward-facing triangles', () => {
    const thickness = room.walls[0]!.thickness;
    // The prism has no bottom cap; the sum still holds because y = 0 passes through the origin.
    const expected = (4 + thickness) * thickness * room.wallHeight;
    expect(signedVolume(geometry.walls[0]!.positions)).toBeCloseTo(expected, 4);
  });

  it('builds the same walls whichever way round the room is drawn', () => {
    const reversed = buildRoomGeometry(roomFrom([[0, 5], [4, 5], [4, 0], [0, 0]]));
    for (const wall of reversed.walls) {
      const heights = triangles(wall.positions).flat();
      const zs = heights.map((v) => v[2]!);
      const xs = heights.map((v) => v[0]!);
      // No wall reaches into the room's interior.
      const inside = heights.some((v) => v[0]! > 0.001 && v[0]! < 3.999 && v[2]! > 0.001 && v[2]! < 4.999);
      expect(inside).toBe(false);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(-0.2);
      expect(Math.max(...zs)).toBeLessThanOrEqual(5.2);
    }
  });
});

describe('floor', () => {
  it('is missing until the walls close', () => {
    expect(buildRoomGeometry(roomFrom([[0, 0], [4, 0], [4, 5], [0, 5]], false)).floor).toBeNull();
  });

  it('covers a rectangle exactly and faces up', () => {
    const floor = buildRoomGeometry(roomFrom([[0, 0], [4, 0], [4, 5], [0, 5]])).floor!;
    expect(totalArea(floor)).toBeCloseTo(20, 4);
    for (const triangle of triangles(floor)) expect(normal(triangle)[1]).toBeGreaterThan(0);
  });

  describe.each([
    ['clockwise', [[0, 0], [4, 0], [4, 2], [2, 2], [2, 5], [0, 5]] as Vec2[]],
    ['counterclockwise', [[0, 5], [2, 5], [2, 2], [4, 2], [4, 0], [0, 0]] as Vec2[]],
  ])('an L-shaped room drawn %s', (_, outline) => {
    const floor = buildRoomGeometry(roomFrom(outline)).floor!;

    it('has the area of the L, not of its bounding box', () => {
      expect(totalArea(floor)).toBeCloseTo(14, 4);
    });

    it('faces up everywhere', () => {
      for (const triangle of triangles(floor)) expect(normal(triangle)[1]).toBeGreaterThan(0);
    });

    it('covers both arms and leaves the notch empty', () => {
      expect(pointInFloor(floor, 1, 4)).toBe(true);
      expect(pointInFloor(floor, 3, 1)).toBe(true);
      expect(pointInFloor(floor, 1, 1)).toBe(true);
      expect(pointInFloor(floor, 3, 4)).toBe(false);
      expect(pointInFloor(floor, 2.1, 2.1)).toBe(false);
    });
  });

  it('keeps the L walls out of the room at the inside corner', () => {
    const room = roomFrom([[0, 0], [4, 0], [4, 2], [2, 2], [2, 5], [0, 5]]);
    for (const wall of buildRoomGeometry(room).walls) {
      for (const [x, , z] of triangles(wall.positions).flat()) {
        const insideRoom = (x! > 0.001 && x! < 1.999 && z! > 0.001 && z! < 4.999) || (x! > 0.001 && x! < 3.999 && z! > 0.001 && z! < 1.999);
        expect(insideRoom).toBe(false);
      }
    }
  });
});

describe('wallPrism', () => {
  it('produces outward faces for either outline winding', () => {
    const outline: Vec2[] = [[0, 0], [2, 0], [2, 1], [0, 1]];
    expect(signedVolume(wallPrism(outline, 3))).toBeCloseTo(6, 4);
    expect(signedVolume(wallPrism([...outline].reverse(), 3))).toBeCloseTo(6, 4);
  });
});

describe('bounds', () => {
  it('are null with no walls and contain the room otherwise', () => {
    expect(buildRoomGeometry(createEmptyDesign('Empty').room).bounds).toBeNull();
    const { center, radius } = buildRoomGeometry(roomFrom([[0, 0], [4, 0], [4, 5], [0, 5]])).bounds!;
    expect(center[0]).toBeCloseTo(2, 5);
    expect(center[1]).toBeCloseTo(2.5, 5);
    expect(radius).toBeGreaterThan(Math.hypot(2, 2.5));
  });
});
