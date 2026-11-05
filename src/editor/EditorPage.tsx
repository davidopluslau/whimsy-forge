import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useCatalog } from '../api/catalog';
import type { CatalogAsset } from '../model/catalog';
import type { Item, Vec2 } from '../model/design';
import { generateId } from '../model/ids';
import * as items from '../model/items';
import type { LengthUnit } from '../model/units';
import type { SceneCapture } from '../scene/capture';
import type { GizmoMode } from '../scene/ItemGizmo';
import { type FloorPicker, RoomScene, type SceneEditing } from '../scene/RoomScene';
import { useDesignStore } from '../store/designStore';
import type { Autosaver } from '../store/autosave';
import { CatalogPanel } from './CatalogPanel';
import { DesignNameField } from './DesignNameField';
import { isAssetDrag, ASSET_DRAG_TYPE } from './drag';
import { LengthField } from './LengthField';
import { PlanEditor } from './PlanEditor';
import type { PhotoUpload } from './photo';
import { SaveIndicator } from './SaveIndicator';
import { ShareControls } from './ShareControls';

type ViewMode = 'split' | 'plan' | '3d';

const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: 'split', label: 'Split' },
  { mode: 'plan', label: 'Plan' },
  { mode: '3d', label: '3D' },
];

const UNITS: { unit: LengthUnit; label: string }[] = [
  { unit: 'm', label: 'Meters' },
  { unit: 'ft', label: 'Feet' },
];

const GIZMOS: { mode: GizmoMode; label: string }[] = [
  { mode: 'move', label: 'Move' },
  { mode: 'rotate', label: 'Rotate' },
];

/** Arrow keys move an item in plan: x right, z down, which is +y in the plan. */
const ARROW_STEPS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
/** Shift with an arrow key moves this many times as far. */
const FAST_NUDGE = 5;
const QUARTER_TURN = Math.PI / 2;
/** How long the Designs link waits for an outstanding save. */
const LEAVE_WAIT_MS = 3000;

/** Where to type or select text, where the editor's shortcuts must not take the key. */
const isTextTarget = (target: EventTarget | null) => target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]') !== null;

export default function EditorPage({ saver }: { saver: Autosaver }) {
  const room = useDesignStore((state) => state.design.room);
  const designItems = useDesignStore((state) => state.design.items);
  const setWallHeight = useDesignStore((state) => state.setWallHeight);
  const addItem = useDesignStore((state) => state.addItem);
  const removeItem = useDesignStore((state) => state.removeItem);
  const updateItem = useDesignStore((state) => state.updateItem);
  const duplicateItem = useDesignStore((state) => state.duplicateItem);
  const nudgeItem = useDesignStore((state) => state.nudgeItem);
  const rotateItem = useDesignStore((state) => state.rotateItem);
  const beginGesture = useDesignStore((state) => state.beginGesture);
  const endGesture = useDesignStore((state) => state.endGesture);
  const undo = useDesignStore((state) => state.undo);
  const redo = useDesignStore((state) => state.redo);
  const canUndo = useDesignStore((state) => state.past.length > 0);
  const canRedo = useDesignStore((state) => state.future.length > 0);

  const { catalog, retry } = useCatalog();
  const assets = useMemo(() => (catalog.status === 'ready' ? catalog.assets : []), [catalog]);
  const catalogById = useMemo(() => new Map<string, CatalogAsset>(assets.map((asset) => [asset.id, asset])), [assets]);

  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [unit, setUnit] = useState<LengthUnit>('m');
  const [catalogOpen, setCatalogOpen] = useState(true);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [gizmo, setGizmo] = useState<GizmoMode>('move');
  const [notice, setNotice] = useState<string | null>(null);
  const pickFloor = useRef<FloorPicker | null>(null);
  const capture = useRef<SceneCapture | null>(null);

  const selectedItem = designItems.find((item) => item.id === selectedItemId) ?? null;
  // Only furniture on the floor can overlap. Rugs are meant to sit under things, and pictures hang on walls.
  const overlapping = useMemo(
    () => items.overlappingItemIds(designItems.filter((item) => item.mount === 'floor' && items.itemImage(item, catalogById)?.kind !== 'rug')),
    [designItems, catalogById],
  );
  const itemName = (item: Item) => {
    const uploaded = items.uploadIdOf(item.assetId) !== null;
    return uploaded ? (item.mount === 'wall' ? 'Photo picture' : 'Photo rug') : (catalogById.get(item.assetId)?.name ?? 'Item');
  };

  // Undo can remove the selected item; then nothing should stay selected.
  useEffect(() => {
    if (selectedItemId && !designItems.some((item) => item.id === selectedItemId)) setSelectedItemId(null);
  }, [designItems, selectedItemId]);

  function placeItem(draft: Pick<Item, 'assetId' | 'mount' | 'size'>, point: Vec2 | null): boolean {
    const placed = items.newItem(room, { ...draft, id: generateId() }, point);
    if (!placed) {
      setNotice('Draw a wall first; a picture hangs on a wall.');
      return false;
    }
    setNotice(null);
    setSelectedItemId(addItem(placed));
    return true;
  }

  function placeAsset(asset: CatalogAsset, point: Vec2 | null) {
    placeItem({ assetId: asset.id, mount: asset.mount, size: asset.dimensions }, point);
  }

  function placePhoto(photo: PhotoUpload) {
    const mount = photo.kind === 'picture' ? 'wall' : 'floor';
    placeItem({ assetId: items.photoAssetId(photo.uploadId), mount, size: items.photoSize(mount, photo.width, photo.aspect) }, null);
  }

  function dropAssetId(event: DragEvent) {
    return event.dataTransfer.getData(ASSET_DRAG_TYPE);
  }

  function duplicateSelected() {
    if (!selectedItem) return;
    const copy = duplicateItem(selectedItem.id, generateId());
    if (copy) setSelectedItemId(copy);
  }

  function deleteSelected() {
    if (!selectedItem) return;
    removeItem(selectedItem.id);
    setSelectedItemId(null);
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextTarget(event.target) || document.querySelector('dialog[open]')) return;
      const key = event.key.toLowerCase();
      const modified = event.ctrlKey || event.metaKey;

      if (modified && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (modified && key === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (modified && key === 'd' && selectedItem) {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (!selectedItem) return;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelected();
      } else if (event.key === 'Escape') {
        setSelectedItemId(null);
      } else if (ARROW_STEPS[event.key]) {
        event.preventDefault();
        const [x, z] = ARROW_STEPS[event.key]!;
        const step = event.shiftKey ? FAST_NUDGE * items.NUDGE_STEP : items.NUDGE_STEP;
        nudgeItem(selectedItem.id, x * step, z * step);
      } else if (key === 'r' && !modified && selectedItem.mount !== 'wall') {
        event.preventDefault();
        rotateItem(selectedItem.id, event.shiftKey ? -QUARTER_TURN : QUARTER_TURN);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const editing: SceneEditing = {
    selectedId: selectedItemId,
    gizmo,
    onSelect: setSelectedItemId,
    onItemChange: (id, patch) => {
      updateItem(id, patch);
    },
    onGestureStart: beginGesture,
    onGestureEnd: endGesture,
    pickFloor,
  };

  return (
    <main className="editor" data-view-mode={viewMode} data-catalog-open={catalogOpen}>
      <header className="editor__header">
        <a
          className="editor__back"
          href="/editor"
          onClick={(event) => {
            // Finish saving first, so the list shows this design as it now stands. A stalled save
            // mustn't trap the owner here: leaving the page keeps the work in a draft.
            if (event.ctrlKey || event.metaKey || event.shiftKey) return;
            event.preventDefault();
            const giveUp = new Promise((resolve) => setTimeout(resolve, LEAVE_WAIT_MS));
            void Promise.race([saver.flush(), giveUp]).finally(() => window.location.assign('/editor'));
          }}
        >
          Designs
        </a>
        <DesignNameField />
        <SaveIndicator saver={saver} />
        <div className="segmented" role="group" aria-label="View">
          {VIEW_MODES.map(({ mode, label }) => (
            <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)}>
              {label}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Units">
          {UNITS.map((option) => (
            <button key={option.unit} type="button" aria-pressed={unit === option.unit} onClick={() => setUnit(option.unit)}>
              {option.label}
            </button>
          ))}
        </div>
        <LengthField label="Wall height" meters={room.wallHeight} unit={unit} onCommit={setWallHeight} />
        <div className="segmented" role="group" aria-label="History">
          <button type="button" disabled={!canUndo} title="Undo (Ctrl+Z)" onClick={() => undo()}>
            Undo
          </button>
          <button type="button" disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" onClick={() => redo()}>
            Redo
          </button>
        </div>
        <button type="button" className="button-quiet" aria-pressed={catalogOpen} onClick={() => setCatalogOpen((open) => !open)}>
          Catalog
        </button>
        <ShareControls capture={capture} />
      </header>
      {/* Both panes stay mounted, so switching views keeps a half-drawn wall and the 3D camera. */}
      <div className="editor__panes">
        <CatalogPanel unit={unit} catalog={catalog} retry={retry} onPlace={(asset) => placeAsset(asset, null)} onAddPhoto={placePhoto} />
        <section className="editor__pane editor__pane--plan" aria-label="Floor plan">
          <PlanEditor
            unit={unit}
            items={designItems}
            overlapping={overlapping}
            selectedItemId={selectedItemId}
            onSelectItem={setSelectedItemId}
            onDropAsset={(assetId, point) => {
              const asset = catalogById.get(assetId);
              if (asset) placeAsset(asset, point);
            }}
          />
        </section>
        <section
          className="editor__pane editor__pane--scene"
          aria-label="3D view"
          data-testid="room-scene"
          data-wall-count={room.walls.length}
          data-opening-count={room.openings.length}
          data-item-count={designItems.length}
          data-selected-item={selectedItemId ?? undefined}
          onDragOver={(event) => {
            if (!isAssetDrag(event.dataTransfer.types)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(event) => {
            const assetId = dropAssetId(event);
            const asset = assetId ? catalogById.get(assetId) : undefined;
            const point = pickFloor.current?.(event.clientX, event.clientY) ?? null;
            if (!asset) return;
            event.preventDefault();
            placeAsset(asset, point);
          }}
        >
          {selectedItem && (
            <div className="item-bar" role="toolbar" aria-label="Selected item" data-testid="item-bar">
              <span className="item-bar__name">{itemName(selectedItem)}</span>
              <div className="segmented" role="group" aria-label="Gizmo">
                {GIZMOS.map(({ mode, label }) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={gizmo === mode}
                    disabled={mode === 'rotate' && selectedItem.mount === 'wall'}
                    onClick={() => setGizmo(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button type="button" className="button-quiet" onClick={duplicateSelected} title="Duplicate (Ctrl+D)">
                Duplicate
              </button>
              <button type="button" className="button-quiet" onClick={deleteSelected} title="Delete (Delete key)">
                Delete
              </button>
            </div>
          )}
          {overlapping.size > 0 && (
            <p className="scene-notice" role="status" data-testid="overlap-warning">
              {overlapping.size} {overlapping.size === 1 ? 'item overlaps' : 'items overlap'} another.
            </p>
          )}
          {notice && (
            <p className="scene-notice scene-notice--error" role="alert">
              {notice}
            </p>
          )}
          <RoomScene room={room} items={designItems} catalog={catalogById} overlapping={overlapping} editing={editing} capture={capture} />
        </section>
      </div>
    </main>
  );
}
