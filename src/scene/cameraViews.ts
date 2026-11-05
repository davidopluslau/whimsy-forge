import type { DesignCamera, Room, Vec2, Vec3 } from '../model/design';
import { findRoomLoop } from '../model/room';

/** Vertical field of view of every camera on a room, in degrees. */
export const FOV = 40;
/** High enough to see the floor over the near walls. */
export const OVERVIEW_POSITION: Vec3 = [4, 10, 6];
const MIN_FRAMED_RADIUS = 2;
/** A person's eyes, unless the ceiling is lower. */
const EYE_HEIGHT = 1.55;
const EYE_TARGET_HEIGHT = 1.1;
/** How far from its corner the eye-level camera stands, as a share of the way to the room's center. */
const CORNER_INSET = 0.12;
/** Looking straight down makes "up" ambiguous, so the top view leans this little. */
const TOP_LEAN = 0.001;

export type CameraView = { position: Vec3; target: Vec3 };
export type RoomBounds = { center: Vec2; radius: number } | null;
/** A view worked out for the canvas's shape (width / height), which decides how far back to stand. */
export type ViewPreset = { name: string; view: (aspect: number) => CameraView };

const isVec3 = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every((part) => Number.isFinite(part));

/** The room's center at half height, which every outside view looks at. */
function roomTarget(bounds: RoomBounds, wallHeight: number): Vec3 {
  return [bounds?.center[0] ?? 0, wallHeight / 2, bounds?.center[1] ?? 0];
}

/** How far back a camera must stand to fit the whole room, whichever way the canvas is narrower. */
function framedDistance(bounds: RoomBounds, wallHeight: number, aspect: number): number {
  const radius = Math.hypot(Math.max(bounds?.radius ?? 0, MIN_FRAMED_RADIUS), wallHeight / 2);
  const tanVertical = Math.tan(((FOV / 2) * Math.PI) / 180);
  const halfAngle = Math.min(Math.atan(tanVertical), Math.atan(tanVertical * aspect));
  return radius / Math.sin(halfAngle);
}

/** The whole room framed, looking along `direction` (from the room toward the camera). */
export function framedView(bounds: RoomBounds, wallHeight: number, aspect: number, direction: Vec3): CameraView {
  const target = roomTarget(bounds, wallHeight);
  const distance = framedDistance(bounds, wallHeight, aspect) / Math.hypot(...direction);
  return { target, position: [target[0] + direction[0] * distance, target[1] + direction[1] * distance, target[2] + direction[2] * distance] };
}

/**
 * A stored view on a canvas of this shape. A portrait phone sees less to the sides than the wide pane
 * it was saved from, so a view from outside the room stands further back. A view from inside stays
 * put, because moving back would put a wall in front of it.
 */
export function fittedStoredView({ position, target }: CameraView, bounds: RoomBounds, aspect: number): CameraView {
  const outside = !bounds || Math.hypot(position[0] - bounds.center[0], position[2] - bounds.center[1]) > bounds.radius;
  const stretch = aspect < 1 && outside ? 1 / aspect : 1;
  return {
    target,
    position: [target[0] + (position[0] - target[0]) * stretch, target[1] + (position[1] - target[1]) * stretch, target[2] + (position[2] - target[2]) * stretch],
  };
}

/** Standing in the corner furthest from the center, looking across the room. */
function eyeLevelView(room: Room, bounds: NonNullable<RoomBounds>): CameraView | null {
  const loop = findRoomLoop(room.walls);
  if (!loop) return null;
  const distance = ([x, y]: Vec2) => Math.hypot(x - bounds.center[0], y - bounds.center[1]);
  const corner = loop.points.reduce((furthest, point) => (distance(point) > distance(furthest) ? point : furthest));
  const height = Math.min(EYE_HEIGHT, room.wallHeight * 0.8);
  return {
    position: [corner[0] + (bounds.center[0] - corner[0]) * CORNER_INSET, height, corner[1] + (bounds.center[1] - corner[1]) * CORNER_INSET],
    target: [bounds.center[0], Math.min(EYE_TARGET_HEIGHT, height), bounds.center[1]],
  };
}

/** The views a viewer can jump to, starting with the one it opens at: the view shared, if any. */
export function viewPresets(room: Room, bounds: RoomBounds, cameras: DesignCamera[]): ViewPreset[] {
  const stored = cameras
    .filter((camera) => isVec3(camera?.position) && isVec3(camera?.target))
    .map((camera): ViewPreset => ({ name: camera.name, view: (aspect) => fittedStoredView(camera, bounds, aspect) }));
  const eyeLevel = bounds && eyeLevelView(room, bounds);
  return [
    ...stored,
    { name: 'Overview', view: (aspect) => framedView(bounds, room.wallHeight, aspect, OVERVIEW_POSITION) },
    { name: 'Top', view: (aspect) => framedView(bounds, room.wallHeight, aspect, [0, 1, TOP_LEAN]) },
    ...(eyeLevel ? [{ name: 'Eye level', view: () => eyeLevel }] : []),
  ];
}
