import { describe, expect, it } from 'vitest';
import { createEmptyDesign, type Room, type Vec2 } from './design';
import { addWall, findRoomLoop, nearestWall, removeWall, setWallHeight, setWallLength, wallFootprints, wallLength } from './room';

function chain(points: Vec2[], base: Room = createEmptyDesign('Test').room): Room {
  let room = base;
  for (let i = 0; i + 1 < points.length; i++) room = addWall(room, points[i]!, points[i + 1]!);
  return room;
}

const rectangle = (width: number, depth: number): Vec2[] => [[0, 0], [width, 0], [width, depth], [0, depth], [0, 0]];
const lShape: Vec2[] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 5], [0, 5], [0, 0]];

describe('addWall', () => {
  const empty = createEmptyDesign('Test').room;

  it('adds a wall in meters', () => {
    const room = addWall(empty, [0, 0], [4, 0]);
    expect(room.walls).toHaveLength(1);
    expect(wallLength(room.walls[0]!)).toBe(4);
  });

  it.each([
    ['too short', [0, 0], [0.01, 0]],
    ['too long', [0, 0], [101, 0]],
  ] as [string, Vec2, Vec2][])('rejects a wall that is %s', (_, start, end) => {
    expect(addWall(empty, start, end)).toBe(empty);
  });

  it('rejects a duplicate in either direction', () => {
    const room = addWall(empty, [0, 0], [4, 0]);
    expect(addWall(room, [0, 0], [4, 0])).toBe(room);
    expect(addWall(room, [4, 0], [0, 0])).toBe(room);
  });
});

describe('findRoomLoop', () => {
  it('finds nothing with no walls or an open chain', () => {
    expect(findRoomLoop([])).toBeNull();
    expect(findRoomLoop(chain([[0, 0], [4, 0], [4, 5], [0, 5]]).walls)).toBeNull();
  });

  it('finds a rectangle and its area', () => {
    const loop = findRoomLoop(chain(rectangle(4, 5)).walls)!;
    expect(loop.edges).toHaveLength(4);
    expect(loop.area).toBeCloseTo(20, 9);
  });

  it('finds an L-shape drawn in either direction', () => {
    expect(findRoomLoop(chain(lShape).walls)!.area).toBeCloseTo(14, 9);
    expect(findRoomLoop(chain([...lShape].reverse()).walls)!.area).toBeCloseTo(14, 9);
  });

  it('follows walls stored in any order and direction', () => {
    const room = chain(rectangle(4, 5));
    const shuffled = [room.walls[2]!, { ...room.walls[0]!, start: room.walls[0]!.end, end: room.walls[0]!.start }, room.walls[3]!, room.walls[1]!];
    expect(findRoomLoop(shuffled)!.area).toBeCloseTo(20, 9);
  });

  it('ignores a dead-end wall', () => {
    const room = addWall(chain(rectangle(4, 5)), [2, 0], [2, -1]);
    const withStub = addWall(room, [4, 5], [6, 7]);
    expect(findRoomLoop(withStub.walls)!.area).toBeCloseTo(20, 9);
  });

  it('uses the outer outline when a partition joins two corners', () => {
    const room = addWall(chain(rectangle(4, 5)), [0, 0], [4, 5]);
    const loop = findRoomLoop(room.walls)!;
    expect(loop.area).toBeCloseTo(20, 9);
    expect(loop.edges).toHaveLength(4);
  });

  it('takes the largest of two separate outlines', () => {
    const second: Vec2[] = [[10, 0], [11, 0], [11, 1], [10, 1], [10, 0]];
    expect(findRoomLoop(chain(second, chain(rectangle(4, 5))).walls)!.area).toBeCloseTo(20, 9);
  });

  it('rejects an outline that crosses itself', () => {
    expect(findRoomLoop(chain([[0, 0], [4, 4], [4, 0], [0, 4], [0, 0]]).walls)).toBeNull();
  });
});

describe('wallFootprints', () => {
  it('leaves the room-side face on the drawn line and mitres the outer corner', () => {
    const room = chain(rectangle(4, 5));
    const thickness = room.walls[0]!.thickness;
    const [first] = wallFootprints(room);
    const outline = first!.outline;
    const has = ([x, y]: Vec2) => outline.some((p) => Math.abs(p[0] - x) < 1e-9 && Math.abs(p[1] - y) < 1e-9);
    expect(has([0, 0])).toBe(true);
    expect(has([4, 0])).toBe(true);
    expect(has([-thickness, -thickness])).toBe(true);
    expect(has([4 + thickness, -thickness])).toBe(true);
    expect(first!.away[0]).toBeCloseTo(0, 9);
    expect(first!.away[1]).toBeCloseTo(-1, 9);
  });

  it('centers a wall that is not part of an outline', () => {
    const room = chain([[0, 0], [4, 0]]);
    const half = room.walls[0]!.thickness / 2;
    const ys = wallFootprints(room)[0]!.outline.map((p) => p[1]);
    expect(Math.max(...ys)).toBeCloseTo(half, 9);
    expect(Math.min(...ys)).toBeCloseTo(-half, 9);
  });

  it('keeps wall order and survives a very sharp corner', () => {
    const room = chain([[0, 0], [5, 0], [0, 0.1], [0, 0]]);
    const footprints = wallFootprints(room);
    expect(footprints.map((footprint) => footprint.wallId)).toEqual(room.walls.map((wall) => wall.id));
    for (const { outline } of footprints) {
      for (const [x, y] of outline) expect(Math.hypot(x, y)).toBeLessThan(10);
    }
  });
});

describe('setWallLength', () => {
  it('keeps a rectangle rectangular', () => {
    const room = chain(rectangle(4, 5));
    const next = setWallLength(room, room.walls[0]!.id, 6);
    expect(next.walls.map((wall) => Number(wallLength(wall).toFixed(6)))).toEqual([6, 5, 6, 5]);
    expect(findRoomLoop(next.walls)!.area).toBeCloseTo(30, 9);
  });

  it('applies the typed length exactly on a diagonal wall', () => {
    const room = chain([[1, 1], [4, 5]]);
    expect(wallLength(setWallLength(room, room.walls[0]!.id, 7.25).walls[0]!)).toBeCloseTo(7.25, 9);
  });

  it('keeps a triangle closed, with the typed length and the next wall unchanged', () => {
    const room = chain([[0, 0], [3, 0], [0, 4], [0, 0]]);
    const next = setWallLength(room, room.walls[0]!.id, 6);
    expect(wallLength(next.walls[0]!)).toBeCloseTo(6, 9);
    expect(wallLength(next.walls[1]!)).toBeCloseTo(5, 9);
    expect(findRoomLoop(next.walls)).not.toBeNull();
  });

  it('only moves the end corner when several walls meet there', () => {
    const room = addWall(chain([[0, 0], [3, 0], [3, 2]]), [3, 0], [5, 0]);
    const next = setWallLength(room, room.walls[0]!.id, 4);
    expect(next.walls[1]).toEqual({ ...room.walls[1]!, start: [4, 0] });
  });

  it('refuses a length that would make the room cross itself', () => {
    const room = chain(lShape);
    // Pushing the L's inner wall past the far side of the room.
    expect(setWallLength(room, room.walls[2]!.id, 5)).toBe(room);
    expect(setWallLength(room, room.walls[2]!.id, 3)).not.toBe(room);
  });

  it.each([0, 0.01, -1, 101, NaN])('refuses %d', (length) => {
    const room = chain(rectangle(4, 5));
    expect(setWallLength(room, room.walls[0]!.id, length)).toBe(room);
  });
});

describe('other edits', () => {
  it('removeWall also removes its openings', () => {
    const base = chain(rectangle(4, 5));
    const wallId = base.walls[0]!.id;
    const opening = { id: 'o', kind: 'door' as const, offset: 1, width: 1, height: 2, sill: 0 };
    const room: Room = { ...base, openings: [{ ...opening, wallId }, { ...opening, id: 'p', wallId: base.walls[1]!.id }] };
    const next = removeWall(room, wallId);
    expect(next.walls).toHaveLength(3);
    expect(next.openings.map((other) => other.id)).toEqual(['p']);
  });

  it('setWallHeight keeps a sensible range', () => {
    const room = createEmptyDesign('Test').room;
    expect(setWallHeight(room, 3).wallHeight).toBe(3);
    expect(setWallHeight(room, 0.5)).toBe(room);
    expect(setWallHeight(room, 11)).toBe(room);
    expect(setWallHeight(room, NaN)).toBe(room);
  });

  it('nearestWall finds the closest wall within tolerance', () => {
    const room = chain(rectangle(4, 5));
    expect(nearestWall(room.walls, [2, 0.1], 0.2)?.id).toBe(room.walls[0]!.id);
    expect(nearestWall(room.walls, [2, 2.5], 0.2)).toBeNull();
  });
});
