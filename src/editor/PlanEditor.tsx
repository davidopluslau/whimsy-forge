import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Item, Opening, Vec2, Wall } from '../model/design';
import { footprint as itemFootprint, pointInPolygon } from '../model/items';
import { createOpening, distanceAlongWall, nearestOpening, openingOutline, wallFaces, wallPoint } from '../model/openings';
import { findRoomLoop, MAX_WALL_LENGTH, MIN_WALL_LENGTH, nearestWall, samePoint, wallEndpoints, wallFootprints, wallLength, type WallFootprint } from '../model/room';
import { formatArea, formatLength, parseLength, type LengthUnit } from '../model/units';
import { useDesignStore } from '../store/designStore';
import { ASSET_DRAG_TYPE, isAssetDrag } from './drag';
import { LengthField } from './LengthField';
import { MaterialSelect } from './MaterialSelect';
import { hasCommandModifier, isTextTarget, PLAN_TOOL_KEYS, shortcutsBlocked } from './shortcuts';
import { frameWalls, GRID_MAJOR_EVERY, GRID_STEP, mergeWithEndpoint, snapPoint, typedTarget } from './snap';

type Tool = 'draw' | 'select' | Opening['kind'];
type View = { scale: number; panX: number; panY: number };
type DrawnWall = { wallId: string; from: Vec2 };
/** Dragging an opening: `grab` keeps the part under the pointer under the pointer. */
type OpeningDrag = { openingId: string; part: 'body' | 'start' | 'end'; grab: number };

const INITIAL_SCALE = 60;
const MIN_SCALE = 10;
const MAX_SCALE = 400;
const MIN_GRID_LINE_GAP = 6;
const SNAP_RADIUS_PX = 12;
const CLICK_SLOP_PX = 4;
const DIMENSION_GAP_PX = 14;
const HANDLE_RADIUS_PX = 6;
/** Gaps narrower than this between an opening and the wall's end get no label. */
const MIN_LABELED_GAP = 0.005;

/** The door's swing, drawn into the room from the hinge at its near edge, or a window's center line. */
function openingMark(wall: Wall, footprint: WallFootprint, opening: Opening, scale: number, toScreen: (p: Vec2) => Vec2) {
  const [near, far] = wallFaces(wall, footprint);
  const point = (along: number, across: number) => toScreen(wallPoint(wall, footprint, along, across)).join(' ');
  const end = opening.offset + opening.width;
  if (opening.kind === 'window') return `M${point(opening.offset, (near + far) / 2)}L${point(end, (near + far) / 2)}`;

  // The arc runs from the open door's tip back to the closed position. Screen axes match plan axes,
  // so its direction is the sign of the turn from the door (pointing into the room) to the wall.
  const radius = opening.width * scale;
  const [dx, dy] = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]];
  const sweep = footprint.away[1] * dx - footprint.away[0] * dy > 0 ? 1 : 0;
  return `M${point(opening.offset, near)}L${point(opening.offset, near - opening.width)}A${radius} ${radius} 0 0 ${sweep} ${point(end, near)}`;
}

/** Grid lines as an SVG path, skipping any spacing too tight to read at this zoom. */
function gridPath(step: number, width: number, height: number, toScreen: (p: Vec2) => Vec2, toWorld: (x: number, y: number) => Vec2, include: (index: number) => boolean) {
  if (Math.abs(toScreen([step, 0])[0] - toScreen([0, 0])[0]) < MIN_GRID_LINE_GAP) return '';
  const [left, top] = toWorld(0, 0);
  const [right, bottom] = toWorld(width, height);
  let path = '';
  for (let i = Math.ceil(left / step); i * step <= right; i++) {
    if (include(i)) path += `M${toScreen([i * step, 0])[0]} 0V${height}`;
  }
  for (let i = Math.ceil(top / step); i * step <= bottom; i++) {
    if (include(i)) path += `M0 ${toScreen([0, i * step])[1]}H${width}`;
  }
  return path;
}

type PlanEditorProps = {
  unit: LengthUnit;
  items: Item[];
  /** Ids of floor items that overlap another. */
  overlapping: ReadonlySet<string>;
  selectedItemId: string | null;
  onSelectItem: (id: string | null) => void;
  /** What to call an item for anyone who can't see the plan. */
  itemName: (item: Item) => string;
  /** A catalog asset was dropped on the plan at this point. */
  onDropAsset: (assetId: string, point: Vec2) => void;
};

/** Enter or Space on a part of the plan that has focus, as a click would. */
const onActivate = (select: () => void) => (event: ReactKeyboardEvent<SVGElement>) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  select();
};

export function PlanEditor({ unit, items, overlapping, selectedItemId, onSelectItem, itemName, onDropAsset }: PlanEditorProps) {
  const room = useDesignStore((state) => state.design.room);
  const beginGesture = useDesignStore((state) => state.beginGesture);
  const endGesture = useDesignStore((state) => state.endGesture);
  const addWall = useDesignStore((state) => state.addWall);
  const removeWall = useDesignStore((state) => state.removeWall);
  const setWallLength = useDesignStore((state) => state.setWallLength);
  const setWallMaterial = useDesignStore((state) => state.setWallMaterial);
  const setFloorMaterial = useDesignStore((state) => state.setFloorMaterial);
  const addOpening = useDesignStore((state) => state.addOpening);
  const removeOpening = useDesignStore((state) => state.removeOpening);
  const moveOpening = useDesignStore((state) => state.moveOpening);
  const dragOpeningEdge = useDesignStore((state) => state.dragOpeningEdge);
  const updateOpening = useDesignStore((state) => state.updateOpening);

  // A design that already has walls opens ready to edit them, so a stray click doesn't start a new one.
  const [tool, setTool] = useState<Tool>(() => (room.walls.length > 0 ? 'select' : 'draw'));
  const [gridSnap, setGridSnap] = useState(true);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ scale: INITIAL_SCALE, panX: 0, panY: 0 });
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [anchor, setAnchor] = useState<Vec2 | null>(null);
  const [drawn, setDrawn] = useState<DrawnWall[]>([]);
  const [typed, setTyped] = useState('');
  const [typedInvalid, setTypedInvalid] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const typedInputRef = useRef<HTMLInputElement>(null);
  const gesture = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean; pans: boolean; button: number; drag: OpeningDrag | null } | null>(null);

  const toScreen = ([x, y]: Vec2): Vec2 => [size.width / 2 + view.panX + x * view.scale, size.height / 2 + view.panY + y * view.scale];
  const toWorld = (x: number, y: number): Vec2 => [(x - size.width / 2 - view.panX) / view.scale, (y - size.height / 2 - view.panY) / view.scale];

  const endpoints = useMemo(() => wallEndpoints(room.walls), [room.walls]);
  const footprints = useMemo(() => wallFootprints(room), [room]);
  const loop = useMemo(() => findRoomLoop(room.walls), [room.walls]);
  const selected = room.walls.find((wall) => wall.id === selectedId) ?? null;
  const selectedOpening = room.openings.find((opening) => opening.id === selectedOpeningId) ?? null;

  const wallById = (id: string) => room.walls.find((wall) => wall.id === id);
  const footprintOf = (wallId: string) => footprints.find((footprint) => footprint.wallId === wallId);
  const snapAlong = (distance: number) => (gridSnap ? Math.round(distance / GRID_STEP[unit]) * GRID_STEP[unit] : distance);

  /** Where a door or window would go for a click at this point, centered there on the nearest wall. */
  const placementAt = (point: Vec2) => {
    if (tool !== 'door' && tool !== 'window') return null;
    const wall = nearestWall(room.walls, point, SNAP_RADIUS_PX / view.scale);
    return wall ? createOpening(room, wall.id, tool, snapAlong(distanceAlongWall(wall, point))) : null;
  };
  const placement = cursor ? placementAt(cursor) : null;

  const snapAt = (point: Vec2) => snapPoint(point, { endpoints, tolerance: SNAP_RADIUS_PX / view.scale, gridStep: gridSnap ? GRID_STEP[unit] : null, anchor });
  const snap = tool === 'draw' && cursor ? snapAt(cursor) : null;

  const typedMeters = typed.trim() === '' ? null : parseLength(typed, unit);
  const typedInRange = typedMeters !== null && typedMeters >= MIN_WALL_LENGTH && typedMeters <= MAX_WALL_LENGTH;
  /** Where the next corner lands: the typed distance if there is one, otherwise the snapped cursor. */
  const typedPoint = anchor && typedInRange ? mergeWithEndpoint(typedTarget(anchor, snap?.point ?? anchor, typedMeters), endpoints) : null;
  const nextCorner = typedPoint ?? snap?.point ?? null;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  // Once the canvas has a size, bring a saved room into view: it could be anywhere when it was drawn.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || size.width === 0 || size.height === 0) return;
    framed.current = true;
    const fitted = frameWalls(room.walls, size, { maxScale: INITIAL_SCALE, minScale: MIN_SCALE });
    if (fitted) setView(fitted);
  }, [size, room.walls]);

  // A native listener, because React's wheel listeners are passive and could not stop page zoom.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const offsetX = event.clientX - rect.left - rect.width / 2;
      const offsetY = event.clientY - rect.top - rect.height / 2;
      setView((current) => {
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * Math.exp(-event.deltaY * 0.001)));
        const ratio = scale / current.scale;
        return { scale, panX: offsetX - (offsetX - current.panX) * ratio, panY: offsetY - (offsetY - current.panY) * ratio };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // Typing a length needs no extra step: the box is ready as soon as there is a corner to measure from.
  useEffect(() => {
    if (tool === 'draw' && anchor) typedInputRef.current?.focus();
  }, [tool, anchor]);

  function clearTyped() {
    setTyped('');
    setTypedInvalid(false);
  }

  function endChain() {
    setAnchor(null);
    setDrawn([]);
    clearTyped();
  }

  function chooseTool(next: Tool) {
    endChain();
    setSelectedId(null);
    setSelectedOpeningId(null);
    onSelectItem(null);
    setTool(next);
  }

  function selectWall(id: string | null) {
    setSelectedId(id);
    setSelectedOpeningId(null);
    if (id) onSelectItem(null);
  }

  function selectOpening(id: string) {
    setSelectedOpeningId(id);
    setSelectedId(null);
    onSelectItem(null);
  }

  /** The item whose footprint is under a point. The one drawn last is on top, so it wins. */
  function itemAt(point: Vec2): string | null {
    const hit = [...items].reverse().find((item) => pointInPolygon(point, itemFootprint(item)));
    return hit?.id ?? null;
  }

  // Selecting an item clears any wall or opening selected here, so only one thing has its handles up.
  useEffect(() => {
    if (selectedItemId) {
      setSelectedId(null);
      setSelectedOpeningId(null);
    }
  }, [selectedItemId]);

  /** The selected opening's resize handle under a point, if any. */
  function handleAt(point: Vec2): 'start' | 'end' | null {
    const wall = selectedOpening && wallById(selectedOpening.wallId);
    const footprint = selectedOpening && footprintOf(selectedOpening.wallId);
    if (!selectedOpening || !wall || !footprint) return null;
    const [near, far] = wallFaces(wall, footprint);
    const radius = (HANDLE_RADIUS_PX + CLICK_SLOP_PX) / view.scale;
    const within = (along: number) => {
      const handle = wallPoint(wall, footprint, along, (near + far) / 2);
      return Math.hypot(handle[0] - point[0], handle[1] - point[1]) <= radius;
    };
    if (within(selectedOpening.offset)) return 'start';
    return within(selectedOpening.offset + selectedOpening.width) ? 'end' : null;
  }

  /** Starts dragging the opening or handle under a point in the select tool. */
  function beginOpeningDrag(point: Vec2): OpeningDrag | null {
    const handle = handleAt(point);
    const opening = handle ? selectedOpening : nearestOpening(room, point, CLICK_SLOP_PX / view.scale);
    const wall = opening && wallById(opening.wallId);
    if (!opening || !wall) return null;
    selectOpening(opening.id);
    const along = distanceAlongWall(wall, point);
    if (handle === 'start') return { openingId: opening.id, part: 'start', grab: along - opening.offset };
    if (handle === 'end') return { openingId: opening.id, part: 'end', grab: along - opening.offset - opening.width };
    return { openingId: opening.id, part: 'body', grab: along - opening.offset };
  }

  function continueOpeningDrag(drag: OpeningDrag, point: Vec2) {
    const opening = room.openings.find((candidate) => candidate.id === drag.openingId);
    const wall = opening && wallById(opening.wallId);
    if (!wall) return;
    const position = snapAlong(distanceAlongWall(wall, point) - drag.grab);
    if (drag.part === 'body') moveOpening(drag.openingId, position);
    else dragOpeningEdge(drag.openingId, drag.part, position);
  }

  function deleteSelectedOpening() {
    if (selectedOpeningId) removeOpening(selectedOpeningId);
    setSelectedOpeningId(null);
  }

  function placeCorner(corner: Vec2) {
    if (!anchor) {
      setAnchor(corner);
      return;
    }
    const joinsExisting = endpoints.some((endpoint) => samePoint(endpoint, corner));
    const wallId = addWall(anchor, corner);
    if (!wallId) return;
    clearTyped();
    if (!joinsExisting) {
      setDrawn([...drawn, { wallId, from: anchor }]);
      setAnchor(corner);
      return;
    }
    endChain();
    if (findRoomLoop(useDesignStore.getState().design.room.walls)) setTool('select');
  }

  function placeTyped() {
    if (typedPoint) placeCorner(typedPoint);
    else setTypedInvalid(typed.trim() !== '');
  }

  function undoLastWall() {
    const last = drawn.at(-1);
    if (last) {
      removeWall(last.wallId);
      setAnchor(last.from);
      setDrawn(drawn.slice(0, -1));
    } else {
      setAnchor(null);
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const inTypedInput = event.target === typedInputRef.current;
      if (shortcutsBlocked(event.target) && !inTypedInput) return;
      const nextTool = PLAN_TOOL_KEYS[event.key.toLowerCase() as keyof typeof PLAN_TOOL_KEYS];
      if (nextTool && !hasCommandModifier(event) && !event.shiftKey && !isTextTarget(event.target)) {
        chooseTool(nextTool);
      } else if (event.key === 'Escape') {
        endChain();
        selectWall(null);
        if (tool === 'door' || tool === 'window') setTool('select');
      } else if (event.key === 'Backspace' && tool === 'draw' && anchor && typed === '') {
        event.preventDefault();
        undoLastWall();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && tool === 'select' && selectedOpeningId) {
        event.preventDefault();
        deleteSelectedOpening();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && tool === 'select' && selectedId) {
        event.preventDefault();
        removeWall(selectedId);
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function pointerPosition(event: { clientX: number; clientY: number }) {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    const { x, y } = pointerPosition(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    // Everything from press to release, such as an opening drag, becomes one undo step.
    beginGesture();
    const drag = tool === 'select' && event.button === 0 ? beginOpeningDrag(toWorld(x, y)) : null;
    gesture.current = {
      x,
      y,
      panX: view.panX,
      panY: view.panY,
      moved: false,
      button: event.button,
      drag,
      // Placing things keeps the left button; panning there takes the middle or right button.
      pans: !drag && (event.button !== 0 || tool === 'select'),
    };
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const { x, y } = pointerPosition(event);
    setCursor(toWorld(x, y));
    const active = gesture.current;
    if (!active) return;
    if (Math.hypot(x - active.x, y - active.y) > CLICK_SLOP_PX) active.moved = true;
    if (active.pans && active.moved) {
      setView({ ...view, panX: active.panX + x - active.x, panY: active.panY + y - active.y });
    }
    if (active.drag && active.moved) continueOpeningDrag(active.drag, toWorld(x, y));
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const active = gesture.current;
    gesture.current = null;
    endGesture();
    if (!active || active.moved || active.drag || active.button !== 0) return;
    const { x, y } = pointerPosition(event);
    const world = toWorld(x, y);
    if (tool === 'select') {
      const item = itemAt(world);
      if (item) {
        selectWall(null);
        onSelectItem(item);
      } else {
        selectWall(nearestWall(room.walls, world, SNAP_RADIUS_PX / view.scale)?.id ?? null);
      }
    } else if (tool === 'draw') {
      placeCorner(typedPoint ?? snapAt(world).point);
    } else {
      const spot = placementAt(world);
      const id = spot && addOpening(spot.wallId, spot.kind, spot.offset + spot.width / 2);
      if (id) {
        setTool('select');
        selectOpening(id);
      }
    }
  }

  const gridStep = GRID_STEP[unit];
  const majorEvery = GRID_MAJOR_EVERY[unit];
  const minorGrid = gridPath(gridStep, size.width, size.height, toScreen, toWorld, (index) => index % majorEvery !== 0);
  const majorGrid = gridPath(gridStep * majorEvery, size.width, size.height, toScreen, toWorld, () => true);
  const points = (polygon: Vec2[]) => polygon.map((point) => toScreen(point).join(',')).join(' ');
  const previewEnd = anchor && nextCorner ? toScreen(nextCorner) : null;
  const previewStart = anchor ? toScreen(anchor) : null;

  let status: string;
  if (loop) status = `Closed room · floor ${formatArea(loop.area, unit)}`;
  else if (room.walls.length === 0) status = 'No walls yet';
  else status = `${room.walls.length} ${room.walls.length === 1 ? 'wall' : 'walls'} · not a closed room yet`;

  return (
    <div className="plan" data-testid="plan-editor" data-tool={tool}>
      <div className="plan__bar">
        <div className="segmented" role="group" aria-label="Plan tool">
          <button type="button" aria-pressed={tool === 'draw'} title="Draw walls (W)" aria-keyshortcuts="W" onClick={() => chooseTool('draw')}>
            Draw walls
          </button>
          <button type="button" aria-pressed={tool === 'select'} title="Select (V)" aria-keyshortcuts="V" onClick={() => chooseTool('select')}>
            Select
          </button>
          <button type="button" aria-label="Add door" aria-pressed={tool === 'door'} title="Add a door (D)" aria-keyshortcuts="D" onClick={() => chooseTool('door')}>
            + Door
          </button>
          <button type="button" aria-label="Add window" aria-pressed={tool === 'window'} title="Add a window (N)" aria-keyshortcuts="N" onClick={() => chooseTool('window')}>
            + Window
          </button>
        </div>
        <label className="field field--inline">
          <input type="checkbox" checked={gridSnap} onChange={(event) => setGridSnap(event.target.checked)} />
          Snap to grid
        </label>
        <p className="plan__status" role="status" data-testid="room-status" title={status}>
          {status}
        </p>
      </div>

      <svg
        ref={svgRef}
        className="plan__canvas"
        data-testid="plan-canvas"
        data-scale={view.scale}
        role="application"
        aria-label="Floor plan"
        onMouseDown={(event) => {
          // Keeps focus in the length box while drawing.
          if (tool === 'draw') event.preventDefault();
        }}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          gesture.current = null;
          endGesture();
        }}
        onDragOver={(event) => {
          if (!isAssetDrag(event.dataTransfer.types)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(event) => {
          const assetId = event.dataTransfer.getData(ASSET_DRAG_TYPE);
          if (!assetId) return;
          event.preventDefault();
          const { x, y } = pointerPosition(event);
          onDropAsset(assetId, toWorld(x, y));
        }}
      >
        <path className="plan__grid" d={minorGrid} />
        <path className="plan__grid plan__grid--major" d={majorGrid} />

        {loop && <polygon className="plan__floor" points={points(loop.points)} />}

        {footprints.map((footprint, index) => (
          <polygon
            key={footprint.wallId}
            className={footprint.wallId === selectedId ? 'plan__wall plan__wall--selected' : 'plan__wall'}
            points={points(footprint.outline)}
            data-testid="plan-wall"
            tabIndex={0}
            role="button"
            aria-label={`Wall ${index + 1}, ${formatLength(wallLength(room.walls[index]!), unit)}`}
            aria-pressed={footprint.wallId === selectedId}
            onKeyDown={onActivate(() => {
              setTool('select');
              endChain();
              selectWall(footprint.wallId);
            })}
          />
        ))}

        {items.map((item) => {
          const className = ['plan__item', item.id === selectedItemId && 'plan__item--selected', overlapping.has(item.id) && 'plan__item--overlap'].filter(Boolean).join(' ');
          return (
            <polygon
              key={item.id}
              className={className}
              data-testid="plan-item"
              data-item-id={item.id}
              points={points(itemFootprint(item))}
              tabIndex={0}
              role="button"
              aria-label={itemName(item)}
              aria-pressed={item.id === selectedItemId}
              onKeyDown={onActivate(() => {
                setTool('select');
                endChain();
                selectWall(null);
                onSelectItem(item.id);
              })}
            />
          );
        })}

        {footprints.map((footprint, index) => {
          const wall = room.walls[index]!;
          const a = toScreen(wall.start);
          const b = toScreen(wall.end);
          const gap = wall.thickness * view.scale + DIMENSION_GAP_PX;
          const x = (a[0] + b[0]) / 2 + footprint.away[0] * gap;
          const y = (a[1] + b[1]) / 2 + footprint.away[1] * gap;
          let angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
          if (angle > 90) angle -= 180;
          if (angle <= -90) angle += 180;
          return (
            <text key={footprint.wallId} className="plan__dimension" data-testid="wall-dimension" x={x} y={y} transform={`rotate(${angle} ${x} ${y})`}>
              {formatLength(wallLength(wall), unit)}
            </text>
          );
        })}

        {room.openings.map((opening) => {
          const wall = wallById(opening.wallId);
          const footprint = footprintOf(opening.wallId);
          if (!wall || !footprint) return null;
          const isSelected = opening.id === selectedOpeningId;
          return (
            <g key={opening.id}>
              <polygon
                className={isSelected ? 'plan__opening plan__opening--selected' : 'plan__opening'}
                data-testid="plan-opening"
                data-kind={opening.kind}
                points={points(openingOutline(wall, footprint, opening))}
                tabIndex={0}
                role="button"
                aria-label={`${opening.kind === 'door' ? 'Door' : 'Window'}, ${formatLength(opening.width, unit)} wide`}
                aria-pressed={isSelected}
                onKeyDown={onActivate(() => {
                  setTool('select');
                  endChain();
                  selectOpening(opening.id);
                })}
              />
              <path className="plan__opening-mark" d={openingMark(wall, footprint, opening, view.scale, toScreen)} />
            </g>
          );
        })}

        {selectedOpening &&
          (() => {
            const wall = wallById(selectedOpening.wallId);
            const footprint = footprintOf(selectedOpening.wallId);
            if (!wall || !footprint) return null;
            const [near, far] = wallFaces(wall, footprint);
            const end = selectedOpening.offset + selectedOpening.width;
            const length = wallLength(wall);
            const labelAcross = near - DIMENSION_GAP_PX / view.scale;
            const gaps: [number, number][] = [
              [selectedOpening.offset, selectedOpening.offset / 2],
              [length - end, (end + length) / 2],
            ];
            return (
              <>
                {gaps.map(([gap, along], index) => {
                  if (gap < MIN_LABELED_GAP) return null;
                  const [x, y] = toScreen(wallPoint(wall, footprint, along, labelAcross));
                  return (
                    <text key={index} className="plan__dimension plan__dimension--preview plan__dimension--gap" data-testid="opening-gap" x={x} y={y}>
                      {formatLength(gap, unit)}
                    </text>
                  );
                })}
                {[selectedOpening.offset, end].map((along) => {
                  const [x, y] = toScreen(wallPoint(wall, footprint, along, (near + far) / 2));
                  return <circle key={along} className="plan__opening-handle" data-testid="opening-handle" cx={x} cy={y} r={HANDLE_RADIUS_PX} />;
                })}
              </>
            );
          })()}

        {placement &&
          (() => {
            const wall = wallById(placement.wallId);
            const footprint = footprintOf(placement.wallId);
            return wall && footprint ? <polygon className="plan__opening plan__opening--preview" points={points(openingOutline(wall, footprint, placement))} /> : null;
          })()}

        {endpoints.map((endpoint) => {
          const [x, y] = toScreen(endpoint);
          return <circle key={`${endpoint[0]},${endpoint[1]}`} className="plan__corner" cx={x} cy={y} r={3.5} />;
        })}

        {previewStart && previewEnd && nextCorner && (
          <>
            <line className="plan__preview" x1={previewStart[0]} y1={previewStart[1]} x2={previewEnd[0]} y2={previewEnd[1]} />
            <text className="plan__dimension plan__dimension--preview" x={previewEnd[0] + 12} y={previewEnd[1] - 12}>
              {formatLength(Math.hypot(nextCorner[0] - anchor![0], nextCorner[1] - anchor![1]), unit)}
            </text>
          </>
        )}
        {previewStart && <circle className="plan__anchor" cx={previewStart[0]} cy={previewStart[1]} r={4.5} />}
        {snap && !typedPoint && (
          <circle
            className={snap.kind === 'endpoint' ? 'plan__snap plan__snap--endpoint' : 'plan__snap'}
            cx={toScreen(snap.point)[0]}
            cy={toScreen(snap.point)[1]}
            r={snap.kind === 'endpoint' ? 9 : 4}
          />
        )}
      </svg>

      <div className="plan__bar plan__bar--bottom">
        {tool === 'draw' ? (
          <>
            <label className="field">
              Length
              <input
                ref={typedInputRef}
                type="text"
                inputMode="decimal"
                value={typed}
                disabled={!anchor}
                placeholder={unit === 'm' ? 'e.g. 4' : `e.g. 13' 6"`}
                aria-invalid={typedInvalid}
                data-testid="typed-length"
                onChange={(event) => {
                  setTyped(event.target.value);
                  setTypedInvalid(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') placeTyped();
                }}
              />
            </label>
            <p className="plan__hint">
              {anchor
                ? 'Point, type a length and press Enter, or click the next corner. Click the first corner to close. Backspace undoes; Esc stops.'
                : 'Click to place the first corner. Scroll to zoom; drag with the right button to pan.'}
            </p>
          </>
        ) : tool === 'door' || tool === 'window' ? (
          <p className="plan__hint">Click a wall to place the {tool}. Esc cancels.</p>
        ) : selectedOpening ? (
          <div className="plan__fields" key={selectedOpening.id} data-testid="opening-fields">
            <LengthField label="Offset" meters={selectedOpening.offset} unit={unit} onCommit={(offset) => updateOpening(selectedOpening.id, { offset })} />
            <LengthField label="Width" meters={selectedOpening.width} unit={unit} onCommit={(width) => updateOpening(selectedOpening.id, { width })} />
            <LengthField label="Height" meters={selectedOpening.height} unit={unit} onCommit={(height) => updateOpening(selectedOpening.id, { height })} />
            {selectedOpening.kind === 'window' && <LengthField label="Sill" meters={selectedOpening.sill} unit={unit} onCommit={(sill) => updateOpening(selectedOpening.id, { sill })} />}
            <button type="button" className="button-quiet" onClick={deleteSelectedOpening}>
              Delete {selectedOpening.kind}
            </button>
          </div>
        ) : selected ? (
          <>
            <LengthField key={selected.id} label="Wall length" meters={wallLength(selected)} unit={unit} onCommit={(meters) => setWallLength(selected.id, meters)} />
            <MaterialSelect label="Wall material" surface="wall" value={selected.materialId} onChange={(materialId) => setWallMaterial(selected.id, materialId)} />
            <button
              type="button"
              className="button-quiet"
              onClick={() => {
                removeWall(selected.id);
                setSelectedId(null);
              }}
            >
              Delete wall
            </button>
          </>
        ) : (
          <>
            <MaterialSelect label="Floor material" surface="floor" value={room.floorMaterialId} onChange={setFloorMaterial} />
            <p className="plan__hint">Click a wall or opening to edit it; drag an opening or its handles to move or resize it. Scroll to zoom; drag to pan.</p>
          </>
        )}
      </div>
    </div>
  );
}
