import type { Vec2, Wall } from '../model/design';
import { distance, VERTEX_TOLERANCE } from '../model/room';
import type { LengthUnit } from '../model/units';

/** Grid spacing per display unit: 10 cm, or 6 inches. */
export const GRID_STEP: Record<LengthUnit, number> = { m: 0.1, ft: 0.1524 };

/** Heavier grid lines fall every this many steps: 1 m, or 1 foot. */
export const GRID_MAJOR_EVERY: Record<LengthUnit, number> = { m: 10, ft: 2 };

/** Space left around a framed room, in pixels. */
const FRAME_MARGIN_PX = 60;

/**
 * The plan's zoom and pan that center these walls in a canvas of this size, zooming out if they
 * wouldn't fit. Null with no walls, so an empty plan keeps its origin at the center.
 */
export function frameWalls(walls: readonly Wall[], size: { width: number; height: number }, limits: { maxScale: number; minScale: number }) {
  if (walls.length === 0) return null;
  const xs = walls.flatMap((wall) => [wall.start[0], wall.end[0]]);
  const ys = walls.flatMap((wall) => [wall.start[1], wall.end[1]]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const fit = (pixels: number, meters: number) => (meters > 0 ? Math.max(pixels - 2 * FRAME_MARGIN_PX, 1) / meters : limits.maxScale);
  const scale = Math.max(limits.minScale, Math.min(limits.maxScale, fit(size.width, maxX - minX), fit(size.height, maxY - minY)));
  return { scale, panX: (-(minX + maxX) / 2) * scale, panY: (-(minY + maxY) / 2) * scale };
}

/** A segment within this angle of horizontal or vertical is straightened. */
const AXIS_LOCK_RADIANS = (4 * Math.PI) / 180;

export type SnapKind = 'endpoint' | 'grid' | 'free';
export type SnapResult = { point: Vec2; kind: SnapKind };

export type SnapOptions = {
  /** Corners to snap to; these take priority over the grid. */
  endpoints: Vec2[];
  /** How close to a corner counts, in meters. Callers derive it from the on-screen distance. */
  tolerance: number;
  /** Grid spacing, or null when grid snapping is off. */
  gridStep: number | null;
  /** The corner the wall being drawn starts from. */
  anchor: Vec2 | null;
};

function lockToAxis(point: Vec2, anchor: Vec2, tolerance: number): Vec2 {
  const dx = Math.abs(point[0] - anchor[0]);
  const dy = Math.abs(point[1] - anchor[1]);
  if (dx <= tolerance || Math.atan2(dx, dy) <= AXIS_LOCK_RADIANS) return [anchor[0], point[1]];
  if (dy <= tolerance || Math.atan2(dy, dx) <= AXIS_LOCK_RADIANS) return [point[0], anchor[1]];
  return point;
}

/** Resolves a cursor position: a nearby corner first, then the grid, straightened against the anchor. */
export function snapPoint(raw: Vec2, { endpoints, tolerance, gridStep, anchor }: SnapOptions): SnapResult {
  let nearest: Vec2 | null = null;
  let nearestDistance = tolerance;
  for (const endpoint of endpoints) {
    const gap = distance(raw, endpoint);
    if (gap <= nearestDistance) {
      nearestDistance = gap;
      nearest = endpoint;
    }
  }
  if (nearest) return { point: nearest, kind: 'endpoint' };
  if (gridStep === null) return { point: raw, kind: 'free' };

  const onGrid: Vec2 = [Math.round(raw[0] / gridStep) * gridStep, Math.round(raw[1] / gridStep) * gridStep];
  return { point: anchor ? lockToAxis(onGrid, anchor, tolerance) : onGrid, kind: 'grid' };
}

/**
 * The corner a typed length lands on: that far from the anchor, toward the cursor. When the cursor
 * sits on the anchor there is no direction to read, so the wall runs along +x.
 */
export function typedTarget(anchor: Vec2, toward: Vec2, length: number): Vec2 {
  const dx = toward[0] - anchor[0];
  const dy = toward[1] - anchor[1];
  const span = Math.hypot(dx, dy);
  return span === 0 ? [anchor[0] + length, anchor[1]] : [anchor[0] + (dx / span) * length, anchor[1] + (dy / span) * length];
}

/** Lands on an existing corner when a typed length comes within a few millimeters of one. */
export function mergeWithEndpoint(point: Vec2, endpoints: Vec2[]): Vec2 {
  return endpoints.find((endpoint) => distance(point, endpoint) <= 5 * VERTEX_TOLERANCE) ?? point;
}
