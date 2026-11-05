import { describe, expect, it } from 'vitest';
import { createEmptyDesign, type Opening, type Room, type Vec2 } from './design';
import { addOpening, createOpening, distanceAlongWall, dragOpeningEdge, isOpeningValid, moveOpening, nearestOpening, OPENING_DEFAULTS, openingOutline, removeOpening, updateOpening } from './openings';
import { addWall, removeWall, setWallHeight, setWallLength, wallFootprints } from './room';

function roomFrom(points: Vec2[], closed = true): Room {
  let room = createEmptyDesign('Test').room;
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) room = addWall(room, points[i]!, points[(i + 1) % points.length]!);
  return room;
}

const rectangle = () => roomFrom([[0, 0], [4, 0], [4, 5], [0, 5]]);
const wallId = (room: Room, index = 0) => room.walls[index]!.id;
const only = (room: Room) => room.openings[0]!;

function withDoor(center = 2): Room {
  const room = rectangle();
  return addOpening(room, wallId(room), 'door', center, 'door');
}

function withWindow(center = 2): Room {
  const room = rectangle();
  return addOpening(room, wallId(room), 'window', center, 'window');
}

describe('addOpening', () => {
  it('places defaults centered at the click, with a door on the floor and a window on its sill', () => {
    expect(only(withDoor(2))).toMatchObject({ kind: 'door', offset: 1.55, ...OPENING_DEFAULTS.door });
    expect(only(withDoor(2)).sill).toBe(0);
    expect(only(withWindow(2))).toMatchObject({ kind: 'window', offset: 1.4, ...OPENING_DEFAULTS.window });
  });

  it('pulls back inside the wall when placed at an end', () => {
    expect(only(withDoor(0)).offset).toBe(0);
    expect(only(withDoor(4)).offset).toBeCloseTo(3.1, 9);
  });

  it('shrinks to fit a short wall and a low ceiling', () => {
    const short = roomFrom([[0, 0], [0.5, 0]], false);
    expect(only(addOpening(short, wallId(short), 'door', 0.25)).width).toBe(0.5);

    const low = setWallHeight(rectangle(), 1.5);
    const door = only(addOpening(low, wallId(low), 'door', 2));
    expect(door.height).toBe(1.5);
    const window = only(addOpening(low, wallId(low), 'window', 2));
    expect(window.sill + window.height).toBeLessThanOrEqual(1.5);
    expect(window.height).toBeCloseTo(1.2, 9);
  });

  it('finds the nearest gap beside an existing opening, and refuses when there is none', () => {
    const room = withDoor(2);
    const beside = addOpening(room, wallId(room), 'door', 2, 'second');
    expect(beside.openings[1]!.offset).toBeCloseTo(0.65, 9);
    expect(isOpeningValid(beside, beside.openings[1]!)).toBe(true);

    const tiny = roomFrom([[0, 0], [1, 0]], false);
    const full = addOpening(tiny, wallId(tiny), 'door', 0.5);
    expect(createOpening(full, wallId(full), 'door', 0.5)).toBeNull();
    expect(addOpening(full, wallId(full), 'door', 0.5)).toBe(full);
  });

  it('refuses an unknown wall', () => {
    const room = rectangle();
    expect(addOpening(room, 'nope', 'door', 1)).toBe(room);
  });
});

describe('an opening cannot extend past its wall or above the wall height', () => {
  it.each<[string, Partial<Opening>]>([
    ['past the wall start', { offset: -0.01 }],
    ['past the wall end', { offset: 3.2 }],
    ['wider than the wall', { width: 4.5 }],
    ['narrower than the minimum', { width: 0.05 }],
    ['above the wall height', { height: 2.6 }],
    ['shorter than the minimum', { height: 0.05 }],
  ])('refuses a door edited to be %s', (_, patch) => {
    const room = withDoor();
    expect(updateOpening(room, 'door', patch)).toBe(room);
  });

  it('accepts one exactly touching the limits', () => {
    const room = withDoor();
    expect(only(updateOpening(room, 'door', { offset: 3.1 })).offset).toBe(3.1);
    expect(only(updateOpening(room, 'door', { height: 2.5 })).height).toBe(2.5);
    expect(only(updateOpening(room, 'door', { offset: 0, width: 4 })).width).toBe(4);
  });

  it('refuses a window whose top passes the wall height, or whose sill is below the floor', () => {
    const room = withWindow();
    expect(updateOpening(room, 'window', { sill: 1.4 })).toBe(room);
    expect(updateOpening(room, 'window', { sill: -0.1 })).toBe(room);
    expect(only(updateOpening(room, 'window', { sill: 1.3 })).sill).toBe(1.3);
  });

  it('keeps a door on the floor', () => {
    const room = withDoor();
    expect(updateOpening(room, 'door', { sill: 0.2 })).toBe(room);
  });

  it('refuses values that are not numbers', () => {
    const room = withDoor();
    expect(updateOpening(room, 'door', { offset: NaN })).toBe(room);
  });

  it('dragging stops at the wall ends', () => {
    const room = withDoor();
    expect(only(moveOpening(room, 'door', -5)).offset).toBe(0);
    expect(only(moveOpening(room, 'door', 50)).offset).toBeCloseTo(3.1, 9);
  });

  it('dragging an edge stops at the wall ends and at the minimum width', () => {
    const room = withDoor();
    const wide = only(dragOpeningEdge(room, 'door', 'start', -5));
    expect(wide.offset).toBe(0);
    expect(wide.offset + wide.width).toBeCloseTo(2.45, 9);

    expect(only(dragOpeningEdge(room, 'door', 'end', 50)).offset + only(dragOpeningEdge(room, 'door', 'end', 50)).width).toBeCloseTo(4, 9);
    expect(only(dragOpeningEdge(room, 'door', 'end', -5)).width).toBeCloseTo(0.2, 9);
    const narrow = only(dragOpeningEdge(room, 'door', 'start', 50));
    expect(narrow.width).toBeCloseTo(0.2, 9);
    expect(narrow.offset + narrow.width).toBeCloseTo(2.45, 9);
  });
});

describe('openings on the same wall', () => {
  function pair(): Room {
    let room = rectangle();
    room = addOpening(room, wallId(room), 'door', 1, 'a');
    return addOpening(room, wallId(room), 'door', 3, 'b');
  }

  it('cannot be typed on top of each other', () => {
    const room = pair();
    expect(updateOpening(room, 'b', { offset: 1 })).toBe(room);
  });

  it('dragging into a neighbor hops to the nearest free gap', () => {
    const room = pair();
    const a = room.openings[0]!;
    const moved = moveOpening(room, 'b', a.offset + 0.1).openings[1]!;
    expect(moved.offset).toBeCloseTo(a.offset + a.width, 9);
    expect(isOpeningValid(room, moved)).toBe(true);
  });

  it('dragging an edge stops at a neighbor', () => {
    const room = pair();
    const a = room.openings[0]!;
    const b = room.openings[1]!;
    expect(dragOpeningEdge(room, 'a', 'end', 3.5).openings[0]!.width).toBeCloseTo(b.offset - a.offset, 9);
    expect(dragOpeningEdge(room, 'b', 'start', 0).openings[1]!.offset).toBeCloseTo(a.offset + a.width, 9);
  });

  it('may share a stretch of wall at different heights', () => {
    let room = setWallHeight(rectangle(), 3);
    room = addOpening(room, wallId(room), 'door', 2, 'door');
    room = addOpening(room, wallId(room), 'window', 2, 'high');
    const high = room.openings[1]!;
    const stacked = updateOpening(room, 'high', { sill: 2.2, height: 0.5, offset: 1.6 });
    expect(stacked.openings[1]).toMatchObject({ offset: 1.6, sill: 2.2 });
    expect(high.offset).not.toBe(1.6);
  });
});

describe('editing the walls with openings in place', () => {
  it('refuses a wall too short for its opening, and leaves the room alone', () => {
    const room = withDoor();
    expect(setWallLength(room, wallId(room), 0.5)).toBe(room);
  });

  it('slides an opening along a shortened wall when it still fits', () => {
    const room = withDoor(3.5);
    const next = setWallLength(room, wallId(room), 2);
    expect(only(next).offset).toBeCloseTo(1.1, 9);
    expect(isOpeningValid(next, only(next))).toBe(true);
  });

  it('keeps an opening where it is in the world when its wall grows from the start', () => {
    // Lengthening the first wall drags the third wall's start along, so that wall grows at its start end.
    const base = rectangle();
    const opposite = wallId(base, 2);
    const room = addOpening(base, opposite, 'door', 3, 'door');
    const before = only(room);
    const next = setWallLength(room, wallId(room), 6);
    expect(only(next).offset).toBeCloseTo(before.offset + 2, 9);
  });

  it('refuses a wall height that a door no longer fits under', () => {
    const room = withDoor();
    expect(setWallHeight(room, 2)).toBe(room);
    expect(setWallHeight(room, 2.1).wallHeight).toBe(2.1);
  });

  it('lowers a window to fit under a lower ceiling, and refuses when it is too tall', () => {
    const room = withWindow();
    const next = setWallHeight(room, 2);
    expect(only(next).sill).toBeCloseTo(0.8, 9);
    expect(setWallHeight(updateOpening(room, 'window', { height: 1.5, sill: 0.5 }), 1.2).wallHeight).toBe(2.5);
  });

  it('leaves unrelated openings untouched, by identity', () => {
    const room = withDoor();
    expect(setWallHeight(room, 3).openings).toBe(room.openings);
  });

  it('removing a wall removes its openings', () => {
    const room = withDoor();
    expect(removeWall(room, wallId(room)).openings).toEqual([]);
  });
});

describe('removeOpening', () => {
  it('removes it, and ignores unknown ids', () => {
    const room = withDoor();
    expect(removeOpening(room, 'door').openings).toEqual([]);
    expect(removeOpening(room, 'nope')).toBe(room);
  });
});

describe('finding openings in plan', () => {
  it('measures distance along a wall whichever way it runs', () => {
    const room = roomFrom([[4, 0], [0, 0]], false);
    expect(distanceAlongWall(room.walls[0]!, [3, 0.1])).toBeCloseTo(1, 9);
    expect(distanceAlongWall(room.walls[0]!, [5, 0])).toBeCloseTo(-1, 9);
  });

  it('hits an opening within the wall, and misses beside it and away from the wall', () => {
    const room = withDoor(2);
    expect(nearestOpening(room, [2, -0.06], 0)?.id).toBe('door');
    expect(nearestOpening(room, [1.4, -0.06], 0)).toBeNull();
    expect(nearestOpening(room, [1.4, -0.06], 0.2)?.id).toBe('door');
    expect(nearestOpening(room, [2, -1], 0)).toBeNull();
  });
});

describe('openingOutline', () => {
  it('spans the opening along the wall and the full thickness across it', () => {
    const room = withDoor(2);
    const footprint = wallFootprints(room)[0]!;
    const outline = openingOutline(room.walls[0]!, footprint, only(room));
    const xs = outline.map((point) => point[0]);
    const ys = outline.map((point) => point[1]);
    expect(Math.min(...xs)).toBeCloseTo(1.55, 9);
    expect(Math.max(...xs)).toBeCloseTo(2.45, 9);
    expect(Math.max(...ys)).toBeCloseTo(0, 9);
    expect(Math.min(...ys)).toBeCloseTo(-room.walls[0]!.thickness, 9);
  });
});
