import { BoxGeometry, BufferAttribute, BufferGeometry, Matrix4, ShapeUtils, Vector2, Vector3 } from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import type { Opening, Room, Vec2, Wall } from '../model/design';
import { openingOutline, wallFaces, wallPoint } from '../model/openings';
import { findRoomLoop, signedArea, wallFootprints, type WallFootprint } from '../model/room';

/*
 * Plan [x, y] maps to world (x, height, y). Seen from above with +x to the right, +y then points
 * down the screen, the same way the plan view draws it, so the two views are not mirrored.
 * The mapping flips handedness: a counterclockwise plan polygon is clockwise seen from above.
 */

/** How far a cutter runs past a surface it has to clear; coplanar faces are what CSG handles worst. */
const CUT_OVERSHOOT = 0.05;
const FLUSH = 1e-6;

/** Triangle positions for the polygon, facing up (+Y) at the given height. */
function horizontalFace(points: Vec2[], height: number): number[] {
  const contour = points.map(([x, y]) => new Vector2(x, y));
  const positions: number[] = [];
  for (const triangle of ShapeUtils.triangulateShape(contour, [])) {
    // Triangles come back counterclockwise in plan, which faces down in the world; reversed, they face up.
    for (const index of [...triangle].reverse()) {
      const [x, y] = points[index]!;
      positions.push(x, height, y);
    }
  }
  return positions;
}

/** The same polygon facing down. */
function flipped(positions: number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < positions.length; i += 9) {
    result.push(...positions.slice(i, i + 3), ...positions.slice(i + 6, i + 9), ...positions.slice(i + 3, i + 6));
  }
  return result;
}

/** Non-indexed triangles for a closed solid wall, outward-facing, so that flat normals come out right. */
export function wallPrism(outline: Vec2[], height: number): Float32Array {
  const points = signedArea(outline) < 0 ? [...outline].reverse() : outline;
  const positions = [...horizontalFace(points, height), ...flipped(horizontalFace(points, 0))];
  points.forEach(([ax, ay], index) => {
    const [bx, by] = points[(index + 1) % points.length]!;
    positions.push(ax, 0, ay, bx, height, by, bx, 0, by);
    positions.push(ax, 0, ay, ax, height, ay, bx, height, by);
  });
  return new Float32Array(positions);
}

const evaluator = new Evaluator();
evaluator.attributes = ['position', 'normal'];
evaluator.useGroups = false;

function wallBrush(positions: Float32Array): Brush {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const brush = new Brush(geometry);
  brush.updateMatrixWorld();
  return brush;
}

/** A box covering the opening through the wall's full thickness, running past any face it is flush with. */
function cutterBrush(wall: Wall, footprint: WallFootprint, opening: Opening, wallHeight: number): Brush {
  const [near, far] = wallFaces(wall, footprint);
  const bottom = opening.sill <= FLUSH ? -CUT_OVERSHOOT : opening.sill;
  const top = opening.sill + opening.height >= wallHeight - FLUSH ? wallHeight + CUT_OVERSHOOT : opening.sill + opening.height;
  const [cx, cz] = wallPoint(wall, footprint, opening.offset + opening.width / 2, (near + far) / 2);

  const start = wallPoint(wall, footprint, 0, 0);
  const end = wallPoint(wall, footprint, 1, 0);
  const along = new Vector3(end[0] - start[0], 0, end[1] - start[1]);
  const up = new Vector3(0, 1, 0);
  const across = new Vector3().crossVectors(along, up);
  const transform = new Matrix4().makeBasis(along, up, across).setPosition(cx, (bottom + top) / 2, cz);

  const brush = new Brush(new BoxGeometry(opening.width, top - bottom, far - near + 2 * CUT_OVERSHOOT).applyMatrix4(transform));
  brush.updateMatrixWorld();
  return brush;
}

/** The wall's triangles with each opening cut out as a hole through it. */
export function cutOpenings(positions: Float32Array, wall: Wall, footprint: WallFootprint, openings: Opening[], wallHeight: number): Float32Array {
  if (openings.length === 0) return positions;
  let result = wallBrush(positions);
  for (const opening of openings) {
    result = evaluator.evaluate(result, cutterBrush(wall, footprint, opening, wallHeight), SUBTRACTION);
    result.updateMatrixWorld();
  }
  const geometry = result.geometry.index ? result.geometry.toNonIndexed() : result.geometry;
  return new Float32Array(geometry.getAttribute('position').array);
}

/**
 * Texture coordinates in meters, so tiles keep their real-world size on any wall; the material sets
 * the repeat. Faces map along the wall and up it, anchored at the wall's start, with the top,
 * bottom and door or window reveals following whichever way they run.
 */
export function wallUvs(positions: Float32Array, wall: Wall, footprint: WallFootprint): Float32Array {
  const uvs = new Float32Array((positions.length / 3) * 2);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const faceNormal = new Vector3();
  const [ox, oz] = wall.start;
  const [ex, ez] = wallPoint(wall, footprint, 1, 0);
  const [dx, dz] = [ex - ox, ez - oz];
  const [ax, az] = footprint.away;

  for (let i = 0; i < positions.length; i += 9) {
    a.fromArray(positions, i);
    b.fromArray(positions, i + 3);
    c.fromArray(positions, i + 6);
    faceNormal.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    const facesAlong = Math.abs(faceNormal.x * dx + faceNormal.z * dz);
    const facesAcross = Math.abs(faceNormal.x * ax + faceNormal.z * az);

    [a, b, c].forEach((vertex, corner) => {
      const along = (vertex.x - ox) * dx + (vertex.z - oz) * dz;
      const across = (vertex.x - ox) * ax + (vertex.z - oz) * az;
      const at = ((i / 9) * 3 + corner) * 2;
      if (Math.abs(faceNormal.y) > 0.5) {
        uvs[at] = along;
        uvs[at + 1] = across;
      } else if (facesAlong > facesAcross) {
        uvs[at] = across;
        uvs[at + 1] = vertex.y;
      } else {
        uvs[at] = along;
        uvs[at + 1] = vertex.y;
      }
    });
  }
  return uvs;
}

/** Floor texture coordinates in meters, in the plan's own axes. */
export function floorUvs(positions: Float32Array): Float32Array {
  const uvs = new Float32Array((positions.length / 3) * 2);
  for (let i = 0; i < positions.length / 3; i++) {
    uvs[i * 2] = positions[i * 3]!;
    uvs[i * 2 + 1] = positions[i * 3 + 2]!;
  }
  return uvs;
}

/** The floor under an opening that reaches the ground, so the wall's thickness is not a gap to look through. */
function threshold(wall: Wall, footprint: WallFootprint, opening: Opening): number[] {
  const outline = openingOutline(wall, footprint, opening);
  return horizontalFace(signedArea(outline) < 0 ? [...outline].reverse() : outline, 0);
}

export type WallSurface = { wallId: string; positions: Float32Array; uvs: Float32Array };

export type RoomGeometry = {
  walls: WallSurface[];
  /** Triangles at y = 0, or null until the walls form a closed outline. */
  floor: Float32Array | null;
  /** Center and radius of the plan extent, or null with no walls. */
  bounds: { center: Vec2; radius: number } | null;
};

/**
 * The last build's walls by their inputs. Dragging an opening rebuilds the room on every pointer move,
 * and this confines the cutting and the GPU upload to the wall that changed. A material is not an
 * input to the geometry, so changing one rebuilds nothing.
 */
let wallCache = new Map<string, WallSurface>();

function buildWall(wall: Wall, footprint: WallFootprint, openings: Opening[], wallHeight: number, cache: Map<string, WallSurface>): WallSurface {
  const key = JSON.stringify([wall.id, wall.start, wall.end, footprint.outline, wallHeight, openings]);
  let surface = wallCache.get(key);
  if (!surface) {
    const positions = cutOpenings(wallPrism(footprint.outline, wallHeight), wall, footprint, openings, wallHeight);
    surface = { wallId: wall.id, positions, uvs: wallUvs(positions, wall, footprint) };
  }
  cache.set(key, surface);
  return surface;
}

/** Everything the 3D scene draws, derived from the Design's room. */
export function buildRoomGeometry(room: Room): RoomGeometry {
  const footprints = wallFootprints(room);
  const loop = findRoomLoop(room.walls);

  const corners = footprints.flatMap((footprint) => footprint.outline);
  let bounds: RoomGeometry['bounds'] = null;
  if (corners.length > 0) {
    const xs = corners.map((corner) => corner[0]);
    const ys = corners.map((corner) => corner[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    bounds = { center: [(minX + maxX) / 2, (minY + maxY) / 2], radius: Math.hypot(maxX - minX, maxY - minY) / 2 };
  }

  const cache = new Map<string, WallSurface>();
  const walls = footprints.map((footprint, index) => {
    const wall = room.walls[index]!;
    return buildWall(wall, footprint, room.openings.filter((opening) => opening.wallId === wall.id), room.wallHeight, cache);
  });
  wallCache = cache;

  let floor: Float32Array | null = null;
  if (loop) {
    const positions = horizontalFace(loop.points, 0);
    const onOutline = new Set(loop.edges.map((edge) => edge.wallId));
    for (const opening of room.openings) {
      if (opening.sill > FLUSH || !onOutline.has(opening.wallId)) continue;
      const index = room.walls.findIndex((wall) => wall.id === opening.wallId);
      if (index >= 0) positions.push(...threshold(room.walls[index]!, footprints[index]!, opening));
    }
    floor = new Float32Array(positions);
  }

  return { walls, floor, bounds };
}
