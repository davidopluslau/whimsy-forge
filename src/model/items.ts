import type { Item, Room, Vec2, Vec3, Wall } from './design';
import type { CatalogAsset, LampLight } from './catalog';
import { distanceAlongWall, wallFaces, wallPoint } from './openings';
import { nearestWall, wallFootprints, wallLength } from './room';

/** A photo's asset id is `photo:<uploadId>`; its image is an upload, not a catalog entry. */
export const PHOTO_PREFIX = 'photo:';
export const photoAssetId = (uploadId: string) => `${PHOTO_PREFIX}${uploadId}`;
export const uploadIdOf = (assetId: string): string | null => (assetId.startsWith(PHOTO_PREFIX) ? assetId.slice(PHOTO_PREFIX.length) : null);
/** Where an upload lives, under the asset route's `assets/` prefix. */
export const uploadPath = (uploadId: string) => `assets/uploads/${uploadId}.webp`;

/** Thickness of a photo picture's frame, and of a photo rug. */
export const PICTURE_DEPTH = 0.03;
export const RUG_THICKNESS = 0.01;
/** Height of a new picture's bottom edge above the floor. */
export const PICTURE_BOTTOM = 1.2;
/** Items this far apart along the floor count as touching, not overlapping. */
const OVERLAP_EPSILON = 1e-4;
/** Arrow-key nudge, in meters. */
export const NUDGE_STEP = 0.05;
/** How far a duplicate lands from its original on the floor. */
export const DUPLICATE_OFFSET = 0.3;

/** A photo's footprint: a picture is typed by width and hangs on a wall, a rug lies flat on the floor. */
export function photoSize(mount: Item['mount'], width: number, aspect: number): Vec3 {
  return mount === 'wall' ? [width, width / aspect, PICTURE_DEPTH] : [width, RUG_THICKNESS, width / aspect];
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

/** The item's four corners in plan, going around its footprint. Plan [x, y] is world [x, z]. */
export function footprint(item: Pick<Item, 'position' | 'rotationY' | 'size'>): Vec2[] {
  const sin = Math.sin(item.rotationY);
  const cos = Math.cos(item.rotationY);
  const axisX: Vec2 = [cos, -sin];
  const axisZ: Vec2 = [sin, cos];
  const halfX = item.size[0] / 2;
  const halfZ = item.size[2] / 2;
  const center: Vec2 = [item.position[0], item.position[2]];
  const corners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  return corners.map(([sx, sz]): Vec2 => [center[0] + axisX[0] * sx * halfX + axisZ[0] * sz * halfZ, center[1] + axisX[1] * sx * halfX + axisZ[1] * sz * halfZ]);
}

function project(polygon: Vec2[], axis: Vec2): [number, number] {
  let low = Infinity;
  let high = -Infinity;
  for (const [x, y] of polygon) {
    const value = x * axis[0] + y * axis[1];
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return [low, high];
}

/** Separating axis test for two convex polygons. Shapes that only touch do not overlap. */
export function polygonsOverlap(a: Vec2[], b: Vec2[]): boolean {
  for (const polygon of [a, b]) {
    for (let index = 0; index < polygon.length; index++) {
      const from = polygon[index]!;
      const to = polygon[(index + 1) % polygon.length]!;
      const axis: Vec2 = [-(to[1] - from[1]), to[0] - from[0]];
      const [aLow, aHigh] = project(a, axis);
      const [bLow, bHigh] = project(b, axis);
      if (aHigh <= bLow + OVERLAP_EPSILON || bHigh <= aLow + OVERLAP_EPSILON) return false;
    }
  }
  return true;
}

/** Whether two items share any height. A lamp standing on a table is above it, not in it. */
function heightsOverlap(a: Item, b: Item): boolean {
  return a.position[1] + a.size[1] > b.position[1] + OVERLAP_EPSILON && b.position[1] + b.size[1] > a.position[1] + OVERLAP_EPSILON;
}

/** The ids of every item that overlaps another, in plan and in height. Callers choose which items count. */
export function overlappingItemIds(items: readonly Item[]): Set<string> {
  const shapes = items.map((item) => ({ item, shape: footprint(item) }));
  const ids = new Set<string>();
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      if (heightsOverlap(shapes[i]!.item, shapes[j]!.item) && polygonsOverlap(shapes[i]!.shape, shapes[j]!.shape)) {
        ids.add(shapes[i]!.item.id);
        ids.add(shapes[j]!.item.id);
      }
    }
  }
  return ids;
}

/** A floor item centered on a point. */
export function placeOnFloor(point: Vec2): Pick<Item, 'position'> {
  return { position: [point[0], 0, point[1]] };
}

/**
 * Hangs an item flush against a wall, its back on the wall's face and its front pointing away. Along the
 * wall, its center follows `point` but stays within the wall. `facing` picks the side; without it, the side
 * is the one `point` lies on. Returns null if the wall doesn't exist.
 */
export function placeOnWall(room: Room, wallId: string, point: Vec2, size: Vec3, bottom: number, facing: Vec2 | null): Pick<Item, 'position' | 'rotationY' | 'wallId'> | null {
  const wall = room.walls.find((candidate) => candidate.id === wallId);
  const footprint = wallFootprints(room).find((candidate) => candidate.wallId === wallId);
  if (!wall || !footprint) return null;

  const half = size[0] / 2;
  const along = clamp(distanceAlongWall(wall, point), half, wallLength(wall) - half);
  const [near, far] = wallFaces(wall, footprint);
  const [awayX, awayY] = footprint.away;
  const side = facing ? facing[0] * awayX + facing[1] * awayY : (point[0] - wall.start[0]) * awayX + (point[1] - wall.start[1]) * awayY - (near + far) / 2;
  const sign = side >= 0 ? 1 : -1;
  // The item's back touches the wall face nearest to it: the far face when it faces away from the wall, the near face when it faces the other way.
  const facingDirection: Vec2 = [sign * awayX, sign * awayY];
  const touching = sign > 0 ? far : near;
  const face = wallPoint(wall, footprint, along, touching);
  const center: Vec2 = [face[0] + (facingDirection[0] * size[2]) / 2, face[1] + (facingDirection[1] * size[2]) / 2];
  const y = clamp(bottom, 0, room.wallHeight - size[1]);
  return { wallId, position: [center[0], y, center[1]], rotationY: Math.atan2(facingDirection[0], facingDirection[1]) };
}

/** Where a ceiling item's bottom goes: it hangs from the top of the walls, or stands on the floor if it's taller than they are. */
const ceilingBottom = (room: Room, size: Vec3) => Math.max(0, room.wallHeight - size[1]);

/** The unit direction a wall runs in, from its start to its end. */
function wallDirection(wall: Wall): Vec2 {
  const length = wallLength(wall);
  return length === 0 ? [1, 0] : [(wall.end[0] - wall.start[0]) / length, (wall.end[1] - wall.start[1]) / length];
}

/** Keeps wall items on their walls and ceiling items at the ceiling after a room edit. Items whose wall was removed are dropped. */
export function followWalls(room: Room, items: Item[]): Item[] {
  let changed = false;
  const next: Item[] = [];
  for (const item of items) {
    if (item.mount === 'ceiling') {
      const bottom = ceilingBottom(room, item.size);
      if (bottom === item.position[1]) {
        next.push(item);
      } else {
        changed = true;
        next.push({ ...item, position: [item.position[0], bottom, item.position[2]] });
      }
      continue;
    }
    if (item.mount !== 'wall' || item.wallId === undefined) {
      next.push(item);
      continue;
    }
    const facing: Vec2 = [Math.sin(item.rotationY), Math.cos(item.rotationY)];
    const center: Vec2 = [item.position[0], item.position[2]];
    const placed = placeOnWall(room, item.wallId, center, item.size, item.position[1], facing);
    if (!placed) {
      changed = true;
      continue;
    }
    const same = placed.position.every((value, index) => value === item.position[index]) && placed.rotationY === item.rotationY;
    if (same) {
      next.push(item);
    } else {
      changed = true;
      next.push({ ...item, position: placed.position, rotationY: placed.rotationY });
    }
  }
  return changed ? next : items;
}

/** Moves an item by a plan offset. A wall item slides along its wall and stays flush. */
export function nudgeItem(room: Room, item: Item, dx: number, dz: number): Item {
  if (item.mount !== 'wall' || item.wallId === undefined) {
    return { ...item, position: [item.position[0] + dx, item.position[1], item.position[2] + dz] };
  }
  const wall = room.walls.find((candidate) => candidate.id === item.wallId);
  if (!wall) return item;
  const [along0, along1] = wallDirection(wall);
  const step = dx * along0 + dz * along1;
  const facing: Vec2 = [Math.sin(item.rotationY), Math.cos(item.rotationY)];
  const center: Vec2 = [item.position[0], item.position[2]];
  const placed = placeOnWall(room, item.wallId, [center[0] + along0 * step, center[1] + along1 * step], item.size, item.position[1], facing);
  return placed ? { ...item, ...placed } : item;
}

/**
 * Sets the height of an item's bottom above the floor, such as a lamp on a table or a picture on its wall.
 * It stays between the floor and the top of the walls. A ceiling item stays hung from the ceiling.
 */
export function setItemHeight(room: Room, item: Item, height: number): Item {
  if (item.mount === 'ceiling') return item;
  const bottom = clamp(height, 0, room.wallHeight - item.size[1]);
  return { ...item, position: [item.position[0], bottom, item.position[2]] };
}

/** A copy beside the original: on the floor, offset diagonally; on a wall, next along it. */
export function duplicateItem(room: Room, item: Item): Pick<Item, 'position' | 'rotationY' | 'wallId'> {
  if (item.mount !== 'wall' || item.wallId === undefined) {
    return { position: [item.position[0] + DUPLICATE_OFFSET, item.position[1], item.position[2] + DUPLICATE_OFFSET], rotationY: item.rotationY };
  }
  const moved = nudgeItem(room, item, 0, 0);
  const wall = room.walls.find((candidate) => candidate.id === item.wallId);
  if (!wall) return moved;
  const [along0, along1] = wallDirection(wall);
  const step = item.size[0] + 0.05;
  const facing: Vec2 = [Math.sin(item.rotationY), Math.cos(item.rotationY)];
  const center: Vec2 = [item.position[0], item.position[2]];
  const placed = placeOnWall(room, item.wallId, [center[0] + along0 * step, center[1] + along1 * step], item.size, item.position[1], facing);
  return placed ?? moved;
}

/** Turns an item by an angle in radians, keeping the result in (-π, π]. */
export function rotateItem(item: Item, angle: number): Item {
  const turned = Math.atan2(Math.sin(item.rotationY + angle), Math.cos(item.rotationY + angle));
  return { ...item, rotationY: turned };
}

/** The middle of the room, from its wall endpoints. Origin when there are no walls. */
export function roomCenter(room: Room): Vec2 {
  if (room.walls.length === 0) return [0, 0];
  const points = room.walls.flatMap((wall) => [wall.start, wall.end]);
  const sum = points.reduce<Vec2>((total, point) => [total[0] + point[0], total[1] + point[1]], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}

/** The wall a new wall-mounted item goes on when none is chosen: the longest one. */
export function longestWall(room: Room): Wall | null {
  return room.walls.reduce<Wall | null>((best, wall) => (best === null || wallLength(wall) > wallLength(best) ? wall : best), null);
}

const midpoint = (wall: Wall): Vec2 => [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2];

/** Whether a point lies inside a convex polygon. */
export function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  let sign = 0;
  for (let index = 0; index < polygon.length; index++) {
    const from = polygon[index]!;
    const to = polygon[(index + 1) % polygon.length]!;
    const cross = (to[0] - from[0]) * (point[1] - from[1]) - (to[1] - from[1]) * (point[0] - from[0]);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/** A lamp's light in the room: world position, plus the color and strength from its catalog entry. */
export type PlacedLight = Omit<LampLight, 'position'> & { itemId: string; position: Vec3 };

/**
 * The lights the room's lamps give, in the order they were placed. Every light costs shader time on every
 * surface, so only the first `limit` give light. Order is what keeps the choice steady as things move.
 */
export function lampLights(items: readonly Item[], catalog: ReadonlyMap<string, CatalogAsset>, limit: number): PlacedLight[] {
  const lights: PlacedLight[] = [];
  for (const item of items) {
    if (lights.length >= limit) break;
    const light = catalog.get(item.assetId)?.light;
    if (!light) continue;
    const sin = Math.sin(item.rotationY);
    const cos = Math.cos(item.rotationY);
    const [x, y, z] = light.position;
    lights.push({
      itemId: item.id,
      color: light.color,
      intensity: light.intensity,
      distance: light.distance,
      position: [item.position[0] + x * cos + z * sin, item.position[1] + y, item.position[2] - x * sin + z * cos],
    });
  }
  return lights;
}

/** How many of these items are lamps, whether or not they fit under the limit on lights. */
export const lampCount = (items: readonly Item[], catalog: ReadonlyMap<string, CatalogAsset>) => items.filter((item) => catalog.get(item.assetId)?.light).length;

/** What to draw for an item: a model file, or an image for a picture or a rug. Null while its catalog entry is loading. */
export type ItemImage = { kind: 'model' | 'picture' | 'rug'; path: string };

export function itemImage(item: Pick<Item, 'assetId' | 'mount'>, catalog: ReadonlyMap<string, CatalogAsset>): ItemImage | null {
  const upload = uploadIdOf(item.assetId);
  if (upload !== null) return { kind: item.mount === 'wall' ? 'picture' : 'rug', path: uploadPath(upload) };
  const asset = catalog.get(item.assetId);
  return asset ? { kind: asset.kind, path: asset.url } : null;
}

/**
 * A new item for a draft, placed where it was dropped. A wall item goes on the wall nearest the point,
 * or the longest wall when there is no point. A floor item goes on the point, or the middle of the room,
 * and a ceiling item hangs from the ceiling above it. Null when a wall item has no wall to go on.
 */
export function newItem(room: Room, draft: Pick<Item, 'id' | 'assetId' | 'mount' | 'size'>, point: Vec2 | null): Item | null {
  if (draft.mount === 'wall') {
    const wall = point ? nearestWall(room.walls, point, Infinity) : longestWall(room);
    if (!wall) return null;
    const placed = placeOnWall(room, wall.id, point ?? midpoint(wall), draft.size, PICTURE_BOTTOM, null);
    return placed ? { ...draft, ...placed } : null;
  }
  const onFloor = placeOnFloor(point ?? roomCenter(room));
  if (draft.mount === 'ceiling') {
    return { ...draft, position: [onFloor.position[0], ceilingBottom(room, draft.size), onFloor.position[2]], rotationY: 0 };
  }
  return { ...draft, ...onFloor, rotationY: 0 };
}
