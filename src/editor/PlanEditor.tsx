import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Vec2 } from '../model/design';
import { findRoomLoop, MAX_WALL_LENGTH, MIN_WALL_LENGTH, nearestWall, samePoint, wallEndpoints, wallFootprints, wallLength } from '../model/room';
import { formatArea, formatLength, parseLength, type LengthUnit } from '../model/units';
import { useDesignStore } from '../store/designStore';
import { LengthField } from './LengthField';
import { GRID_MAJOR_EVERY, GRID_STEP, mergeWithEndpoint, snapPoint, typedTarget } from './snap';

type Tool = 'draw' | 'select';
type View = { scale: number; panX: number; panY: number };
type DrawnWall = { wallId: string; from: Vec2 };

const INITIAL_SCALE = 60;
const MIN_SCALE = 10;
const MAX_SCALE = 400;
const MIN_GRID_LINE_GAP = 6;
const SNAP_RADIUS_PX = 12;
const CLICK_SLOP_PX = 4;
const DIMENSION_GAP_PX = 14;

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

export function PlanEditor({ unit }: { unit: LengthUnit }) {
  const room = useDesignStore((state) => state.design.room);
  const addWall = useDesignStore((state) => state.addWall);
  const removeWall = useDesignStore((state) => state.removeWall);
  const setWallLength = useDesignStore((state) => state.setWallLength);

  const [tool, setTool] = useState<Tool>('draw');
  const [gridSnap, setGridSnap] = useState(true);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ scale: INITIAL_SCALE, panX: 0, panY: 0 });
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [anchor, setAnchor] = useState<Vec2 | null>(null);
  const [drawn, setDrawn] = useState<DrawnWall[]>([]);
  const [typed, setTyped] = useState('');
  const [typedInvalid, setTypedInvalid] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const typedInputRef = useRef<HTMLInputElement>(null);
  const gesture = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean; pans: boolean; button: number } | null>(null);

  const toScreen = ([x, y]: Vec2): Vec2 => [size.width / 2 + view.panX + x * view.scale, size.height / 2 + view.panY + y * view.scale];
  const toWorld = (x: number, y: number): Vec2 => [(x - size.width / 2 - view.panX) / view.scale, (y - size.height / 2 - view.panY) / view.scale];

  const endpoints = useMemo(() => wallEndpoints(room.walls), [room.walls]);
  const footprints = useMemo(() => wallFootprints(room), [room]);
  const loop = useMemo(() => findRoomLoop(room.walls), [room.walls]);
  const selected = room.walls.find((wall) => wall.id === selectedId) ?? null;

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
    setTool(next);
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
      if (event.target instanceof HTMLInputElement && !inTypedInput) return;
      if (event.key === 'Escape') {
        endChain();
        setSelectedId(null);
      } else if (event.key === 'Backspace' && tool === 'draw' && anchor && typed === '') {
        event.preventDefault();
        undoLastWall();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && tool === 'select' && selectedId) {
        event.preventDefault();
        removeWall(selectedId);
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function pointerPosition(event: ReactPointerEvent) {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    const { x, y } = pointerPosition(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      x,
      y,
      panX: view.panX,
      panY: view.panY,
      moved: false,
      button: event.button,
      // Drawing keeps the left button for corners; panning there takes the middle or right button.
      pans: event.button !== 0 || tool === 'select',
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
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const active = gesture.current;
    gesture.current = null;
    if (!active || active.moved || active.button !== 0) return;
    const { x, y } = pointerPosition(event);
    const world = toWorld(x, y);
    if (tool === 'select') {
      setSelectedId(nearestWall(room.walls, world, SNAP_RADIUS_PX / view.scale)?.id ?? null);
    } else {
      placeCorner(typedPoint ?? snapAt(world).point);
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
          <button type="button" aria-pressed={tool === 'draw'} onClick={() => chooseTool('draw')}>
            Draw walls
          </button>
          <button type="button" aria-pressed={tool === 'select'} onClick={() => chooseTool('select')}>
            Select
          </button>
        </div>
        <label className="field field--inline">
          <input type="checkbox" checked={gridSnap} onChange={(event) => setGridSnap(event.target.checked)} />
          Snap to grid
        </label>
        <p className="plan__status" role="status" data-testid="room-status">
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
        }}
      >
        <path className="plan__grid" d={minorGrid} />
        <path className="plan__grid plan__grid--major" d={majorGrid} />

        {loop && <polygon className="plan__floor" points={points(loop.points)} />}

        {footprints.map((footprint) => (
          <polygon key={footprint.wallId} className={footprint.wallId === selectedId ? 'plan__wall plan__wall--selected' : 'plan__wall'} points={points(footprint.outline)} />
        ))}

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
                ? 'Point the way, type a length and press Enter, or click the next corner. Click the first corner to close. Backspace undoes, Esc stops.'
                : 'Click to place the first corner. Scroll to zoom; drag with the right button to pan.'}
            </p>
          </>
        ) : selected ? (
          <>
            <LengthField key={selected.id} label="Wall length" meters={wallLength(selected)} unit={unit} onCommit={(meters) => setWallLength(selected.id, meters)} />
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
          <p className="plan__hint">Click a wall to change its length or delete it. Scroll to zoom; drag to pan.</p>
        )}
      </div>
    </div>
  );
}
