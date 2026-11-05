import type { Room, Vec2, Wall } from './design';
import { generateId } from './ids';

export const DEFAULT_WALL_THICKNESS = 0.12;
export const MIN_WALL_LENGTH = 0.05;
export const MAX_WALL_LENGTH = 100;
export const MIN_WALL_HEIGHT = 1;
export const MAX_WALL_HEIGHT = 10;

/** Endpoints closer than this count as the same corner. */
export const VERTEX_TOLERANCE = 0.001;

const MITER_LIMIT = 4;
const EPSILON = 1e-9;

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Vec2, factor: number): Vec2 => [a[0] * factor, a[1] * factor];
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];

export const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const wallLength = (wall: Pick<Wall, 'start' | 'end'>) => distance(wall.start, wall.end);

function unit(a: Vec2): Vec2 {
  const length = Math.hypot(a[0], a[1]);
  return length === 0 ? [0, 0] : [a[0] / length, a[1] / length];
}

const vertexKey = (p: Vec2) => `${Math.round(p[0] / VERTEX_TOLERANCE)},${Math.round(p[1] / VERTEX_TOLERANCE)}`;

export const samePoint = (a: Vec2, b: Vec2) => vertexKey(a) === vertexKey(b);

/** Positive when the points run counterclockwise in plan coordinates. */
export function signedArea(points: Vec2[]): number {
  let sum = 0;
  points.forEach((point, index) => {
    sum += cross(point, points[(index + 1) % points.length]!);
  });
  return sum / 2;
}

/** The distinct wall corners, each listed once. */
export function wallEndpoints(walls: Wall[]): Vec2[] {
  const byKey = new Map<string, Vec2>();
  for (const wall of walls) {
    for (const point of [wall.start, wall.end]) {
      if (!byKey.has(vertexKey(point))) byKey.set(vertexKey(point), point);
    }
  }
  return [...byKey.values()];
}

export type LoopEdge = { wallId: string; from: Vec2; to: Vec2 };

/** The room outline: edges run counterclockwise in plan coordinates, so the room is on their left. */
export type RoomLoop = { edges: LoopEdge[]; points: Vec2[]; area: number };

type GraphEdge = { to: string; wallId: string };
type GraphVertex = { point: Vec2; edges: GraphEdge[] };

function buildGraph(walls: Wall[]): Map<string, GraphVertex> {
  const graph = new Map<string, GraphVertex>();
  const vertex = (point: Vec2) => {
    const key = vertexKey(point);
    let entry = graph.get(key);
    if (!entry) {
      entry = { point, edges: [] };
      graph.set(key, entry);
    }
    return entry;
  };
  for (const wall of walls) {
    const startKey = vertexKey(wall.start);
    const endKey = vertexKey(wall.end);
    if (startKey === endKey) continue;
    vertex(wall.start).edges.push({ to: endKey, wallId: wall.id });
    vertex(wall.end).edges.push({ to: startKey, wallId: wall.id });
  }
  return graph;
}

/** Removes dead ends repeatedly, so that only walls on some closed cycle remain. */
function pruneDeadEnds(graph: Map<string, GraphVertex>) {
  const pending = [...graph.keys()];
  while (pending.length > 0) {
    const key = pending.pop()!;
    const entry = graph.get(key);
    if (!entry || entry.edges.length > 1) continue;
    graph.delete(key);
    for (const edge of entry.edges) {
      const neighbor = graph.get(edge.to);
      if (!neighbor) continue;
      neighbor.edges = neighbor.edges.filter((other) => other.wallId !== edge.wallId);
      pending.push(edge.to);
    }
  }
}

/**
 * Walks the outer boundary of one connected part of the graph, starting from its leftmost-lowest
 * corner, always taking the sharpest available right turn. Interior partitions are skipped this way.
 */
function traceOuterBoundary(graph: Map<string, GraphVertex>, startKey: string): LoopEdge[] {
  const edges: LoopEdge[] = [];
  const edgeLimit = [...graph.values()].reduce((total, vertex) => total + vertex.edges.length, 0);
  let currentKey = startKey;
  let back: Vec2 = [-1, 0];
  let firstTo: string | null = null;

  while (edges.length <= edgeLimit) {
    const current = graph.get(currentKey)!;
    let best: GraphEdge | null = null;
    let bestAngle = Infinity;
    for (const edge of current.edges) {
      const direction = sub(graph.get(edge.to)!.point, current.point);
      let angle = Math.atan2(cross(back, direction), dot(back, direction));
      if (angle <= EPSILON) angle += 2 * Math.PI;
      if (angle < bestAngle) {
        bestAngle = angle;
        best = edge;
      }
    }
    if (!best) return [];
    if (currentKey === startKey && best.to === firstTo) return edges;
    firstTo ??= best.to;
    const next = graph.get(best.to)!;
    edges.push({ wallId: best.wallId, from: current.point, to: next.point });
    back = sub(current.point, next.point);
    currentKey = best.to;
  }
  return [];
}

function collectComponent(graph: Map<string, GraphVertex>, startKey: string, seen: Set<string>) {
  const pending = [startKey];
  while (pending.length > 0) {
    const key = pending.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const edge of graph.get(key)!.edges) pending.push(edge.to);
  }
}

function orientation(a: Vec2, b: Vec2, c: Vec2) {
  return cross(sub(b, a), sub(c, a));
}

function onSegment(a: Vec2, b: Vec2, p: Vec2) {
  return (
    Math.min(a[0], b[0]) - EPSILON <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) + EPSILON &&
    Math.min(a[1], b[1]) - EPSILON <= p[1] &&
    p[1] <= Math.max(a[1], b[1]) + EPSILON
  );
}

function segmentsTouch(a: Vec2, b: Vec2, c: Vec2, d: Vec2) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON)) && ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))) {
    return true;
  }
  return (
    (Math.abs(o1) <= EPSILON && onSegment(a, b, c)) ||
    (Math.abs(o2) <= EPSILON && onSegment(a, b, d)) ||
    (Math.abs(o3) <= EPSILON && onSegment(c, d, a)) ||
    (Math.abs(o4) <= EPSILON && onSegment(c, d, b))
  );
}

function isSimplePolygon(points: Vec2[]) {
  const count = points.length;
  for (let i = 0; i < count; i++) {
    for (let j = i + 2; j < count; j++) {
      if (i === 0 && j === count - 1) continue;
      if (segmentsTouch(points[i]!, points[(i + 1) % count]!, points[j]!, points[(j + 1) % count]!)) return false;
    }
  }
  return true;
}

/**
 * The closed outline the floor is built from, or null if the walls enclose nothing or the outline
 * crosses itself. Dead ends and interior partitions are ignored; with several separate outlines,
 * the largest wins.
 */
export function findRoomLoop(walls: Wall[]): RoomLoop | null {
  const graph = buildGraph(walls);
  pruneDeadEnds(graph);

  const keys = [...graph.keys()].sort((a, b) => {
    const pa = graph.get(a)!.point;
    const pb = graph.get(b)!.point;
    return pa[0] - pb[0] || pa[1] - pb[1];
  });
  const seen = new Set<string>();
  let best: RoomLoop | null = null;

  for (const key of keys) {
    if (seen.has(key)) continue;
    collectComponent(graph, key, seen);
    const edges = traceOuterBoundary(graph, key);
    if (edges.length < 3) continue;
    const points = edges.map((edge) => edge.from);
    const area = signedArea(points);
    if (area <= EPSILON || !isSimplePolygon(points)) continue;
    if (!best || area > best.area) best = { edges, points, area };
  }
  return best;
}

/**
 * A wall's outline in plan. `away` is the unit normal pointing away from the room, or toward the
 * wall's left side if it is not part of the room outline.
 */
export type WallFootprint = { wallId: string; outline: Vec2[]; away: Vec2 };

const rightNormal = (direction: Vec2): Vec2 => [direction[1], -direction[0]];

function intersectLines(pointA: Vec2, directionA: Vec2, pointB: Vec2, directionB: Vec2): Vec2 | null {
  const denominator = cross(directionA, directionB);
  if (Math.abs(denominator) < 1e-6) return null;
  return add(pointA, scale(directionA, cross(sub(pointB, pointA), directionB) / denominator));
}

/** Where the outer faces of two neighboring outline walls meet, unless the corner is too sharp. */
function miterCorner(corner: Vec2, own: { offset: Vec2; direction: Vec2 }, other: { offset: Vec2; direction: Vec2 }, thickness: number): Vec2 {
  const fallback = add(corner, own.offset);
  const meeting = intersectLines(fallback, own.direction, add(corner, other.offset), other.direction);
  if (!meeting || distance(meeting, corner) > MITER_LIMIT * thickness) return fallback;
  return meeting;
}

function loopFootprints(loop: RoomLoop, walls: Map<string, Wall>): WallFootprint[] {
  const sides = loop.edges.map((edge) => {
    const direction = unit(sub(edge.to, edge.from));
    const normal = rightNormal(direction);
    return { direction, normal, offset: scale(normal, walls.get(edge.wallId)!.thickness) };
  });
  return loop.edges.map((edge, index) => {
    const count = loop.edges.length;
    const side = sides[index]!;
    const previous = sides[(index + count - 1) % count]!;
    const next = sides[(index + 1) % count]!;
    const thickness = walls.get(edge.wallId)!.thickness;
    return {
      wallId: edge.wallId,
      outline: [edge.from, edge.to, miterCorner(edge.to, side, next, thickness), miterCorner(edge.from, side, previous, thickness)],
      away: side.normal,
    };
  });
}

/** Centered on the line; ends that meet another wall run on by half a thickness to fill the corner. */
function freeFootprint(wall: Wall, cornerUse: Map<string, number>): WallFootprint {
  const direction = unit(sub(wall.end, wall.start));
  const half = wall.thickness / 2;
  const left: Vec2 = [-direction[1], direction[0]];
  const extend = (point: Vec2) => ((cornerUse.get(vertexKey(point)) ?? 0) > 1 ? half : 0);
  const start = sub(wall.start, scale(direction, extend(wall.start)));
  const end = add(wall.end, scale(direction, extend(wall.end)));
  const side = scale(left, half);
  return { wallId: wall.id, outline: [add(start, side), sub(start, side), sub(end, side), add(end, side)], away: left };
}

/** One footprint per wall, in the order of `room.walls`. */
export function wallFootprints(room: Room): WallFootprint[] {
  const byId = new Map(room.walls.map((wall) => [wall.id, wall]));
  const loop = findRoomLoop(room.walls);
  const fromLoop = new Map((loop ? loopFootprints(loop, byId) : []).map((footprint) => [footprint.wallId, footprint]));

  const cornerUse = new Map<string, number>();
  for (const wall of room.walls) {
    for (const point of [wall.start, wall.end]) {
      cornerUse.set(vertexKey(point), (cornerUse.get(vertexKey(point)) ?? 0) + 1);
    }
  }
  return room.walls.map((wall) => fromLoop.get(wall.id) ?? freeFootprint(wall, cornerUse));
}

/** Adds a wall, unless it is too short, too long, or duplicates an existing one. */
export function addWall(room: Room, start: Vec2, end: Vec2, id: string = generateId()): Room {
  const length = distance(start, end);
  if (length < MIN_WALL_LENGTH || length > MAX_WALL_LENGTH) return room;
  const duplicate = room.walls.some(
    (wall) => (samePoint(wall.start, start) && samePoint(wall.end, end)) || (samePoint(wall.start, end) && samePoint(wall.end, start)),
  );
  if (duplicate) return room;
  return { ...room, walls: [...room.walls, { id, start, end, thickness: DEFAULT_WALL_THICKNESS }] };
}

/** Removes a wall and the openings cut into it. */
export function removeWall(room: Room, id: string): Room {
  return {
    ...room,
    walls: room.walls.filter((wall) => wall.id !== id),
    openings: room.openings.filter((opening) => opening.wallId !== id),
  };
}

export function setWallHeight(room: Room, height: number): Room {
  if (!(height >= MIN_WALL_HEIGHT && height <= MAX_WALL_HEIGHT)) return room;
  return { ...room, wallHeight: height };
}

/**
 * Makes a wall a given length by moving its end corner along the wall. The next wall moves with it,
 * keeping its own length and direction, so a rectangle stays a rectangle. Returns the room unchanged
 * if the result would collapse a wall or break a closed outline.
 */
export function setWallLength(room: Room, id: string, length: number): Room {
  const wall = room.walls.find((candidate) => candidate.id === id);
  if (!wall || !(length >= MIN_WALL_LENGTH && length <= MAX_WALL_LENGTH)) return room;
  const current = wallLength(wall);
  if (current === 0) return room;

  const delta = scale(unit(sub(wall.end, wall.start)), length - current);
  const endKey = vertexKey(wall.end);
  const moved = new Set([endKey]);
  const neighbors = room.walls.filter((other) => other.id !== id && (vertexKey(other.start) === endKey || vertexKey(other.end) === endKey));
  if (neighbors.length === 1) {
    const neighbor = neighbors[0]!;
    moved.add(vertexKey(vertexKey(neighbor.start) === endKey ? neighbor.end : neighbor.start));
  }

  const shift = (point: Vec2) => (moved.has(vertexKey(point)) ? add(point, delta) : point);
  const walls = room.walls.map((other) => ({ ...other, start: shift(other.start), end: shift(other.end) }));
  if (walls.some((other) => wallLength(other) < MIN_WALL_LENGTH)) return room;
  if (findRoomLoop(room.walls) && !findRoomLoop(walls)) return room;
  return { ...room, walls };
}

/** The closest wall to a point, if it lies within `tolerance` of the wall's line segment. */
export function nearestWall(walls: Wall[], point: Vec2, tolerance: number): Wall | null {
  let best: Wall | null = null;
  let bestDistance = tolerance;
  for (const wall of walls) {
    const along = sub(wall.end, wall.start);
    const lengthSquared = dot(along, along);
    const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(point, wall.start), along) / lengthSquared));
    const gap = distance(point, add(wall.start, scale(along, t)));
    if (gap <= bestDistance) {
      bestDistance = gap;
      best = wall;
    }
  }
  return best;
}
