import { ShapeUtils, Vector2 } from 'three';
import type { Room, Vec2 } from '../model/design';
import { findRoomLoop, signedArea, wallFootprints } from '../model/room';

/*
 * Plan [x, y] maps to world (x, height, y). Seen from above with +x to the right, +y then points
 * down the screen, the same way the plan view draws it, so the two views are not mirrored.
 * The mapping flips handedness: a counterclockwise plan polygon is clockwise seen from above.
 */

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

/** Non-indexed triangles for a solid wall, outward-facing, so that flat normals come out right. */
export function wallPrism(outline: Vec2[], height: number): Float32Array {
  const points = signedArea(outline) < 0 ? [...outline].reverse() : outline;
  const positions = horizontalFace(points, height);
  points.forEach(([ax, ay], index) => {
    const [bx, by] = points[(index + 1) % points.length]!;
    positions.push(ax, 0, ay, bx, height, by, bx, 0, by);
    positions.push(ax, 0, ay, ax, height, ay, bx, height, by);
  });
  return new Float32Array(positions);
}

export type RoomGeometry = {
  walls: { wallId: string; positions: Float32Array }[];
  /** Triangles at y = 0, or null until the walls form a closed outline. */
  floor: Float32Array | null;
  /** Center and radius of the plan extent, or null with no walls. */
  bounds: { center: Vec2; radius: number } | null;
};

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

  return {
    walls: footprints.map(({ wallId, outline }) => ({ wallId, positions: wallPrism(outline, room.wallHeight) })),
    floor: loop ? new Float32Array(horizontalFace(loop.points, 0)) : null,
    bounds,
  };
}
