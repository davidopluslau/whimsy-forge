import { describe, expect, it } from 'vitest';
import { createEmptyDesign, type Room, type Vec2 } from '../model/design';
import { materialsFor } from '../model/materials';
import { addOpening, moveOpening, updateOpening } from '../model/openings';
import { addWall, setWallMaterial } from '../model/room';
import { buildRoomGeometry, floorUvs } from './roomGeometry';

function roomFrom(points: Vec2[]): Room {
  let room = createEmptyDesign('Test').room;
  points.forEach((point, index) => {
    room = addWall(room, point, points[(index + 1) % points.length]!);
  });
  return room;
}

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function triangles(positions: Float32Array): [V, V, V][] {
  const result: [V, V, V][] = [];
  for (let i = 0; i < positions.length; i += 9) {
    const at = (offset: number): V => [positions[i + offset]!, positions[i + offset + 1]!, positions[i + offset + 2]!];
    result.push([at(0), at(3), at(6)]);
  }
  return result;
}

/** Enclosed volume by the divergence theorem. Only right if the surface is closed with outward faces. */
function volume(positions: Float32Array) {
  return triangles(positions).reduce((sum, [a, b, c]) => sum + dot(a, cross(b, c)) / 6, 0);
}

/** The distance to the first surface along a ray, counting only faces that point back at the ray: what a camera would see. */
function firstVisibleHit(positions: Float32Array, origin: V, direction: V): number | null {
  let best: number | null = null;
  for (const [a, b, c] of triangles(positions)) {
    const e1 = sub(b, a);
    const e2 = sub(c, a);
    const normal = cross(e1, e2);
    if (dot(normal, direction) >= 0) continue; // Back-facing: not drawn.
    const p = cross(direction, e2);
    const det = dot(e1, p);
    if (Math.abs(det) < 1e-12) continue;
    const s = sub(origin, a);
    const u = dot(s, p) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1);
    const v = dot(direction, q) / det;
    if (v < 0 || u + v > 1) continue;
    const t = dot(e2, q) / det;
    if (t > 0 && (best === null || t < best)) best = t;
  }
  return best;
}

const THICKNESS = 0.12;
const HEIGHT = 2.5;

describe('a door and a window in one wall', () => {
  // The first wall runs from (0, 0) to (6, 0), with the room on the +z side and its thickness on the -z side.
  let room = roomFrom([[0, 0], [6, 0], [6, 5], [0, 5]]);
  room = addOpening(room, room.walls[0]!.id, 'door', 1.5, 'door');
  room = addOpening(room, room.walls[0]!.id, 'window', 4, 'window');
  const wallPositions = buildRoomGeometry(room).walls[0]!.positions;
  const [door, window] = room.openings as [Room['openings'][number], Room['openings'][number]];

  const FROM_INSIDE = { origin: (x: number, y: number): V => [x, y, 2], direction: [0, 0, -1] as V };
  const FROM_OUTSIDE = { origin: (x: number, y: number): V => [x, y, -2], direction: [0, 0, 1] as V };

  describe.each([
    ['inside', FROM_INSIDE],
    ['outside', FROM_OUTSIDE],
  ])('seen from %s', (_, view) => {
    const hit = (x: number, y: number) => firstVisibleHit(wallPositions, view.origin(x, y), view.direction);

    it('there is a clear view through the door, from the floor up', () => {
      for (const y of [0.01, 1, door.height - 0.01]) expect(hit(door.offset + door.width / 2, y)).toBeNull();
      for (const x of [door.offset + 0.01, door.offset + door.width - 0.01]) expect(hit(x, 1)).toBeNull();
    });

    it('there is a clear view through the window', () => {
      const middle = window.offset + window.width / 2;
      for (const y of [window.sill + 0.01, window.sill + window.height / 2, window.sill + window.height - 0.01]) expect(hit(middle, y)).toBeNull();
    });

    it('the wall is solid right around the holes', () => {
      expect(hit(door.offset - 0.01, 1)).not.toBeNull();
      expect(hit(door.offset + door.width + 0.01, 1)).not.toBeNull();
      expect(hit(door.offset + door.width / 2, door.height + 0.01)).not.toBeNull();
      const middle = window.offset + window.width / 2;
      expect(hit(middle, window.sill - 0.01)).not.toBeNull();
      expect(hit(middle, window.sill + window.height + 0.01)).not.toBeNull();
      expect(hit(window.offset - 0.01, window.sill + 0.5)).not.toBeNull();
      expect(hit(window.offset + window.width + 0.01, window.sill + 0.5)).not.toBeNull();
    });
  });

  it('the holes have depth: looking at an angle, the reveal is visible, both ways', () => {
    // A slanted ray entering the hole just short of its far side must strike that side inside the wall.
    const jamb = window.offset + window.width;
    const y = window.sill + window.height / 2;
    const unit: V = [1 / Math.SQRT2, 0, 1 / Math.SQRT2];
    const cases: [number, number][] = [
      [-THICKNESS, 1], // From outside, entering at the outer face.
      [0, -1], // From the room, entering at the inner face.
    ];
    for (const [faceZ, sign] of cases) {
      const direction: V = [unit[0], 0, unit[2] * sign];
      const origin: V = [jamb - 0.02 - direction[0], y, faceZ - direction[2]];
      const distance = firstVisibleHit(wallPositions, origin, direction);
      expect(distance).not.toBeNull();
      const hitX = origin[0] + direction[0] * distance!;
      const hitZ = origin[2] + direction[2] * distance!;
      expect(hitX).toBeCloseTo(jamb, 4);
      expect(hitZ).toBeGreaterThan(-THICKNESS);
      expect(hitZ).toBeLessThan(0);
    }
  });

  it('removes exactly the volume of the holes, and stays a closed surface', () => {
    const wallOnly = buildRoomGeometry(roomFrom([[0, 0], [6, 0], [6, 5], [0, 5]])).walls[0]!.positions;
    const holes = (door.width * door.height + window.width * window.height) * THICKNESS;
    expect(volume(wallOnly)).toBeCloseTo((6 + THICKNESS) * THICKNESS * HEIGHT, 3);
    expect(volume(wallPositions)).toBeCloseTo(volume(wallOnly) - holes, 3);
  });

  it('leaves the other walls whole', () => {
    const plain = buildRoomGeometry(roomFrom([[0, 0], [6, 0], [6, 5], [0, 5]]));
    const cut = buildRoomGeometry(room);
    for (const index of [1, 2, 3]) expect(cut.walls[index]!.positions).toEqual(plain.walls[index]!.positions);
  });

  it('extends the floor through the door, but not under the window', () => {
    const floor = buildRoomGeometry(room).floor!;
    const down: V = [0, -1, 0];
    const floorAt = (x: number, z: number) => firstVisibleHit(floor, [x, 1, z], down);
    expect(floorAt(door.offset + door.width / 2, -THICKNESS / 2)).not.toBeNull();
    expect(floorAt(window.offset + window.width / 2, -THICKNESS / 2)).toBeNull();
    expect(floorAt(3, 2.5)).not.toBeNull();
  });

  it('gives every vertex texture coordinates in meters', () => {
    const { positions, uvs } = buildRoomGeometry(room).walls[0]!;
    expect(uvs.length / 2).toBe(positions.length / 3);
    expect(uvs.every(Number.isFinite)).toBe(true);
    // On the wall's long faces, u is the distance along the wall and v the height.
    for (let i = 0; i < positions.length; i += 9) {
      const [a, b, c] = triangles(positions.subarray(i, i + 9))[0]!;
      const normal = cross(sub(b, a), sub(c, a));
      if (Math.abs(normal[2]) < Math.abs(normal[0]) + Math.abs(normal[1]) + 1e-9) continue;
      const vertex = i / 3;
      expect(uvs[vertex * 2]).toBeCloseTo(a[0], 4);
      expect(uvs[vertex * 2 + 1]).toBeCloseTo(a[1], 4);
    }
  });
});

describe('cut cases', () => {
  const base = () => roomFrom([[0, 0], [4, 0], [4, 5], [0, 5]]);

  it('cuts a door the full height of the wall, right through the top', () => {
    let room = base();
    room = addOpening(room, room.walls[0]!.id, 'door', 2, 'door');
    room = updateOpening(room, 'door', { height: HEIGHT });
    const positions = buildRoomGeometry(room).walls[0]!.positions;
    expect(firstVisibleHit(positions, [2, HEIGHT - 0.01, 2], [0, 0, -1])).toBeNull();
    const uncut = buildRoomGeometry(base()).walls[0]!.positions;
    expect(volume(positions)).toBeCloseTo(volume(uncut) - 0.9 * HEIGHT * THICKNESS, 3);
  });

  it('cuts an opening flush with the wall end', () => {
    let room = base();
    room = addOpening(room, room.walls[0]!.id, 'door', 0, 'door');
    const positions = buildRoomGeometry(room).walls[0]!.positions;
    expect(firstVisibleHit(positions, [0.02, 1, 2], [0, 0, -1])).toBeNull();
    const uncut = buildRoomGeometry(base()).walls[0]!.positions;
    expect(volume(positions)).toBeCloseTo(volume(uncut) - 0.9 * 2.1 * THICKNESS, 3);
  });

  it('cuts in a wall running in any direction, drawn either way round', () => {
    const diagonal: Vec2[] = [[0, 0], [3, 4], [-1, 7], [-4, 3]];
    for (const outline of [diagonal, [...diagonal].reverse()]) {
      let room = roomFrom(outline);
      const wall = room.walls[0]!;
      room = addOpening(room, wall.id, 'window', 2.5, 'window');
      const opening = room.openings[0]!;
      const [uncut, cut] = [buildRoomGeometry(roomFrom(outline)), buildRoomGeometry(room)];
      expect(volume(cut.walls[0]!.positions)).toBeCloseTo(volume(uncut.walls[0]!.positions) - opening.width * opening.height * THICKNESS, 2);
    }
  });

  it('cuts in a wall that is not part of a closed room', () => {
    let room = createEmptyDesign('Test').room;
    room = addWall(room, [0, 0], [4, 0]);
    room = addOpening(room, room.walls[0]!.id, 'door', 2, 'door');
    const { walls, floor } = buildRoomGeometry(room);
    expect(floor).toBeNull();
    expect(firstVisibleHit(walls[0]!.positions, [2, 1, 2], [0, 0, -1])).toBeNull();
    expect(firstVisibleHit(walls[0]!.positions, [0.5, 1, 2], [0, 0, -1])).not.toBeNull();
  });
});

describe('derived per wall', () => {
  it('moving an opening reuses the geometry of every other wall', () => {
    let room = roomFrom([[0, 0], [4, 0], [4, 5], [0, 5]]);
    room = addOpening(room, room.walls[0]!.id, 'door', 1, 'door');
    const before = buildRoomGeometry(room);
    const after = buildRoomGeometry(moveOpening(room, 'door', 2));
    expect(after.walls[0]!.positions).not.toBe(before.walls[0]!.positions);
    for (const index of [1, 2, 3]) expect(after.walls[index]!.positions).toBe(before.walls[index]!.positions);
  });

  it('changing a material reuses all the wall geometry', () => {
    let room = roomFrom([[0, 0], [4, 0], [4, 5], [0, 5]]);
    room = addOpening(room, room.walls[0]!.id, 'door', 1, 'door');
    const before = buildRoomGeometry(room);
    const after = buildRoomGeometry(setWallMaterial(room, room.walls[0]!.id, materialsFor('wall')[0]!.id));
    after.walls.forEach((wall, index) => expect(wall.positions).toBe(before.walls[index]!.positions));
  });
});

describe('floorUvs', () => {
  it('are the plan coordinates in meters', () => {
    const uvs = floorUvs(new Float32Array([1, 0, 2, 3, 0, 4]));
    expect([...uvs]).toEqual([1, 2, 3, 4]);
  });
});
