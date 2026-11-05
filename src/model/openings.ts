import type { Opening, Room, Vec2, Wall } from './design';
import { generateId } from './ids';
import type { WallFootprint } from './room';

export const MIN_OPENING_WIDTH = 0.2;
export const MIN_OPENING_HEIGHT = 0.2;

export const OPENING_DEFAULTS: Record<Opening['kind'], { width: number; height: number; sill: number }> = {
  door: { width: 0.9, height: 2.1, sill: 0 },
  window: { width: 1.2, height: 1.2, sill: 0.9 },
};

export type OpeningPatch = Partial<Pick<Opening, 'offset' | 'width' | 'height' | 'sill'>>;

/** Slack for rounding: typed feet and repeated arithmetic should not trip the limits. */
const TOLERANCE = 1e-6;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const lengthOf = (wall: Pick<Wall, 'start' | 'end'>) => Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
const movedApart = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) > TOLERANCE;

function direction(wall: Wall): Vec2 {
  const length = lengthOf(wall);
  return length === 0 ? [1, 0] : [(wall.end[0] - wall.start[0]) / length, (wall.end[1] - wall.start[1]) / length];
}

/** How far along the wall a point falls, measured from the wall's start. May be off either end. */
export function distanceAlongWall(wall: Wall, point: Vec2): number {
  const [dx, dy] = direction(wall);
  return (point[0] - wall.start[0]) * dx + (point[1] - wall.start[1]) * dy;
}

const spansOverlap = (a: Opening, b: Opening) => a.offset < b.offset + b.width - TOLERANCE && b.offset < a.offset + a.width - TOLERANCE;
const heightsOverlap = (a: Opening, b: Opening) => a.sill < b.sill + b.height - TOLERANCE && b.sill < a.sill + a.height - TOLERANCE;

/** The other openings on this wall that share some height with this one, left to right. A window over a door is fine. */
function blockers(room: Room, opening: Opening): Opening[] {
  return room.openings
    .filter((other) => other.id !== opening.id && other.wallId === opening.wallId && heightsOverlap(other, opening))
    .sort((a, b) => a.offset - b.offset);
}

/** Whether an opening stays on its wall, under the wall height, and clear of its neighbors. */
export function isOpeningValid(room: Room, opening: Opening): boolean {
  const wall = room.walls.find((candidate) => candidate.id === opening.wallId);
  if (!wall) return false;
  if (![opening.offset, opening.width, opening.height, opening.sill].every(Number.isFinite)) return false;
  if (opening.width < MIN_OPENING_WIDTH - TOLERANCE || opening.height < MIN_OPENING_HEIGHT - TOLERANCE) return false;
  if (opening.offset < -TOLERANCE || opening.offset + opening.width > lengthOf(wall) + TOLERANCE) return false;
  if (opening.sill < -TOLERANCE || opening.sill + opening.height > room.wallHeight + TOLERANCE) return false;
  if (opening.kind === 'door' && Math.abs(opening.sill) > TOLERANCE) return false;
  return !blockers(room, opening).some((other) => spansOverlap(other, opening));
}

/** The free offset closest to `wanted` for this opening's width, or null if it fits nowhere on the wall. */
function nearestFreeOffset(room: Room, wall: Wall, opening: Opening, wanted: number): number | null {
  const gaps: [number, number][] = [];
  let cursor = 0;
  for (const other of blockers(room, opening)) {
    gaps.push([cursor, other.offset]);
    cursor = Math.max(cursor, other.offset + other.width);
  }
  gaps.push([cursor, lengthOf(wall)]);

  let best: number | null = null;
  for (const [low, high] of gaps) {
    if (high - low < opening.width - TOLERANCE) continue;
    const candidate = clamp(wanted, low, high - opening.width);
    if (best === null || Math.abs(candidate - wanted) < Math.abs(best - wanted)) best = candidate;
  }
  return best;
}

/**
 * A new opening of the default size, centered as near `center` as it fits. It shrinks to suit a
 * short wall or low ceiling, and is null if there is no room for it.
 */
export function createOpening(room: Room, wallId: string, kind: Opening['kind'], center: number, id: string = generateId()): Opening | null {
  const wall = room.walls.find((candidate) => candidate.id === wallId);
  if (!wall) return null;
  const defaults = OPENING_DEFAULTS[kind];
  const sill = Math.min(defaults.sill, Math.max(0, room.wallHeight - defaults.height));
  const draft: Opening = {
    id,
    wallId,
    kind,
    offset: 0,
    width: Math.min(defaults.width, lengthOf(wall)),
    height: Math.min(defaults.height, room.wallHeight - sill),
    sill,
  };
  const offset = nearestFreeOffset(room, wall, draft, center - draft.width / 2);
  if (offset === null) return null;
  const opening = { ...draft, offset };
  return isOpeningValid(room, opening) ? opening : null;
}

export function addOpening(room: Room, wallId: string, kind: Opening['kind'], center: number, id: string = generateId()): Room {
  const opening = createOpening(room, wallId, kind, center, id);
  return opening ? { ...room, openings: [...room.openings, opening] } : room;
}

export function removeOpening(room: Room, id: string): Room {
  if (!room.openings.some((opening) => opening.id === id)) return room;
  return { ...room, openings: room.openings.filter((opening) => opening.id !== id) };
}

function replaceOpening(room: Room, next: Opening): Room {
  const current = room.openings.find((opening) => opening.id === next.id);
  if (current && current.offset === next.offset && current.width === next.width && current.height === next.height && current.sill === next.sill) return room;
  return { ...room, openings: room.openings.map((opening) => (opening.id === next.id ? next : opening)) };
}

/** Slides an opening along its wall, stopping at the wall's ends and hopping to the nearest free gap. For dragging. */
export function moveOpening(room: Room, id: string, offset: number): Room {
  const opening = room.openings.find((candidate) => candidate.id === id);
  const wall = room.walls.find((candidate) => candidate.id === opening?.wallId);
  if (!opening || !wall) return room;
  const free = nearestFreeOffset(room, wall, opening, offset);
  return free === null ? room : replaceOpening(room, { ...opening, offset: free });
}

/** Moves one end of an opening to a position along the wall, stopping at the wall's ends, its neighbors and the minimum width. For dragging. */
export function dragOpeningEdge(room: Room, id: string, edge: 'start' | 'end', position: number): Room {
  const opening = room.openings.find((candidate) => candidate.id === id);
  const wall = room.walls.find((candidate) => candidate.id === opening?.wallId);
  if (!opening || !wall) return room;
  const others = blockers(room, opening);
  const right = opening.offset + opening.width;
  if (edge === 'start') {
    const limit = Math.max(0, ...others.filter((other) => other.offset < opening.offset).map((other) => other.offset + other.width));
    const offset = clamp(position, limit, right - MIN_OPENING_WIDTH);
    return replaceOpening(room, { ...opening, offset, width: right - offset });
  }
  const limit = Math.min(lengthOf(wall), ...others.filter((other) => other.offset >= right - TOLERANCE).map((other) => other.offset));
  return replaceOpening(room, { ...opening, width: clamp(position, opening.offset + MIN_OPENING_WIDTH, limit) - opening.offset });
}

/** Applies typed values, or returns the room unchanged if the result would not be valid. */
export function updateOpening(room: Room, id: string, patch: OpeningPatch): Room {
  const opening = room.openings.find((candidate) => candidate.id === id);
  if (!opening) return room;
  const next = { ...opening, ...patch };
  return isOpeningValid(room, next) ? replaceOpening(room, next) : room;
}

/**
 * Carries the openings across an edit of the walls or the wall height. An opening keeps its distance
 * from the wall end that stayed put, then slides as little as needed to fit: along the wall, or
 * down for a window under a lower ceiling. Returns null if some opening can no longer fit, because
 * resizing or deleting it is the user's decision.
 */
export function refitOpenings(before: Room, after: Room): Room | null {
  const openings = after.openings.map((opening) => {
    const oldWall = before.walls.find((wall) => wall.id === opening.wallId);
    const newWall = after.walls.find((wall) => wall.id === opening.wallId);
    if (!oldWall || !newWall) return opening;
    const length = lengthOf(newWall);
    const anchored = movedApart(oldWall.start, newWall.start) ? opening.offset + length - lengthOf(oldWall) : opening.offset;
    const offset = clamp(anchored, 0, Math.max(0, length - opening.width));
    const sill = Math.max(0, Math.min(opening.sill, after.wallHeight - opening.height));
    return offset === opening.offset && sill === opening.sill ? opening : { ...opening, offset, sill };
  });
  const refitted: Room = { ...after, openings: openings.every((opening, index) => opening === after.openings[index]) ? after.openings : openings };
  return refitted.openings.every((opening) => isOpeningValid(refitted, opening)) ? refitted : null;
}

/** The opening under a point in plan, if any: within the wall's thickness and along the opening's span. */
export function nearestOpening(room: Room, point: Vec2, tolerance: number): Opening | null {
  let best: Opening | null = null;
  let bestGap = Infinity;
  for (const opening of room.openings) {
    const wall = room.walls.find((candidate) => candidate.id === opening.wallId);
    if (!wall) continue;
    const along = distanceAlongWall(wall, point);
    if (along < opening.offset - tolerance || along > opening.offset + opening.width + tolerance) continue;
    const [dx, dy] = direction(wall);
    const gap = Math.abs((point[0] - wall.start[0]) * -dy + (point[1] - wall.start[1]) * dx);
    if (gap <= wall.thickness + tolerance && gap < bestGap) {
      bestGap = gap;
      best = opening;
    }
  }
  return best;
}

/** Where a wall's two faces lie, as distances from its line along the footprint's `away` normal. */
export function wallFaces(wall: Wall, footprint: WallFootprint): [number, number] {
  const offsets = footprint.outline.map((point) => (point[0] - wall.start[0]) * footprint.away[0] + (point[1] - wall.start[1]) * footprint.away[1]);
  return [Math.min(...offsets), Math.max(...offsets)];
}

/** A point given by its distance along the wall and across it, along the footprint's `away` normal. */
export function wallPoint(wall: Wall, footprint: WallFootprint, along: number, across: number): Vec2 {
  const [dx, dy] = direction(wall);
  return [wall.start[0] + dx * along + footprint.away[0] * across, wall.start[1] + dy * along + footprint.away[1] * across];
}

/** The opening's outline in plan, through the full thickness of the wall. */
export function openingOutline(wall: Wall, footprint: WallFootprint, opening: Opening): Vec2[] {
  const [near, far] = wallFaces(wall, footprint);
  const end = opening.offset + opening.width;
  return [wallPoint(wall, footprint, opening.offset, near), wallPoint(wall, footprint, end, near), wallPoint(wall, footprint, end, far), wallPoint(wall, footprint, opening.offset, far)];
}
