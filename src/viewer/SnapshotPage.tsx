import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCatalog } from '../api/catalog';
import { ApiError } from '../api/designs';
import { getSnapshotJson } from '../api/snapshots';
import type { CatalogAsset } from '../model/catalog';
import type { Design } from '../model/design';
import { isDesignId } from '../model/ids';
import { NewerSchemaError, parseDesign, UnreadableDesignError } from '../model/migrate';
import { viewPresets, type ViewPreset } from '../scene/cameraViews';
import { imageFileName, saveBlob, type SceneCapture, viewImage } from '../scene/capture';
import { buildRoomGeometry } from '../scene/roomGeometry';
import { RoomScene, type ViewRequest } from '../scene/RoomScene';
import { SceneErrorBoundary } from './SceneErrorBoundary';

const NOT_FOUND = { title: 'Design not found', message: 'This link does not lead to a design. It may be incomplete, or the design may no longer be shared.' };

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; design: Design }
  /** There's nothing to show, and trying again won't help. */
  | { kind: 'refused'; title: string; message: string }
  /** The server couldn't be asked. */
  | { kind: 'failed' };

function outcomeOf(error: unknown): Load {
  if (error instanceof ApiError && (error.status === 404 || error.status === 400)) return { kind: 'refused', ...NOT_FOUND };
  if (error instanceof NewerSchemaError) return { kind: 'refused', title: 'Reload to view this design', message: error.message };
  if (error instanceof UnreadableDesignError) return { kind: 'refused', title: "This design can't be shown", message: error.message };
  return { kind: 'failed' };
}

function SnapshotScene({ design }: { design: Design }) {
  const { catalog } = useCatalog();
  const catalogById = useMemo(() => new Map<string, CatalogAsset>(catalog.status === 'ready' ? catalog.assets.map((asset) => [asset.id, asset]) : []), [catalog]);
  const presets = useMemo(() => viewPresets(design.room, buildRoomGeometry(design.room).bounds, design.cameras), [design]);

  const [request, setRequest] = useState<ViewRequest>(() => ({ view: presets[0]!.view }));
  // Which button is lit. Orbiting turns it off, and pressing the button again goes back to that view.
  const [activeView, setActiveView] = useState<string | null>(presets[0]!.name);
  const [sceneFailed, setSceneFailed] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const capture = useRef<SceneCapture | null>(null);

  const goTo = (preset: ViewPreset) => {
    setRequest({ view: preset.view });
    setActiveView(preset.name);
  };
  const onSceneError = useCallback(() => setSceneFailed(true), []);
  const onOrbitStart = useCallback(() => setActiveView(null), []);

  async function exportImage() {
    if (!capture.current) return;
    setExportFailed(false);
    try {
      saveBlob(await viewImage(capture.current), imageFileName(design.name));
    } catch (error) {
      console.warn('Could not export an image', error);
      setExportFailed(true);
    }
  }

  if (sceneFailed) {
    return (
      <main className="page-message" role="alert" data-testid="snapshot-failed">
        <h1>This device can't show the 3D view</h1>
        <p>The design needs WebGL, which this browser or device doesn't have turned on.</p>
      </main>
    );
  }

  return (
    <main className="viewer" data-testid="snapshot-viewer" data-item-count={design.items.length} data-catalog={catalog.status}>
      <SceneErrorBoundary onError={onSceneError}>
        <RoomScene room={design.room} items={design.items} catalog={catalogById} viewRequest={request} onOrbitStart={onOrbitStart} capture={capture} />
      </SceneErrorBoundary>
      <h1 className="viewer__name viewer__panel">{design.name}</h1>
      <div className="viewer__controls">
        <div className="segmented viewer__panel" role="group" aria-label="Camera views">
          {presets.map((preset) => (
            <button key={preset.name} type="button" aria-pressed={activeView === preset.name} onClick={() => goTo(preset)}>
              {preset.name}
            </button>
          ))}
        </div>
        <button type="button" className="button-quiet viewer__panel" title="Save a PNG of this view" onClick={() => void exportImage()}>
          Export image
        </button>
        {exportFailed && (
          <p className="viewer__panel viewer__error" role="alert">
            Could not export the image.
          </p>
        )}
      </div>
    </main>
  );
}

/** The read-only page behind a share link. Anyone with the link may see it, with no sign-in. */
export default function SnapshotPage({ target }: { target: string }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isDesignId(target)) {
      setLoad({ kind: 'refused', ...NOT_FOUND });
      return;
    }
    let cancelled = false;
    setLoad({ kind: 'loading' });
    getSnapshotJson(target)
      .then(parseDesign)
      .then(
        (design) => {
          if (!cancelled) setLoad({ kind: 'ready', design });
        },
        (error: unknown) => {
          if (!cancelled) setLoad(outcomeOf(error));
        },
      );
    return () => {
      cancelled = true;
    };
  }, [target, attempt]);

  const name = load.kind === 'ready' ? load.design.name : null;
  useEffect(() => {
    if (name) document.title = `${name} · Whimsy Forge`;
  }, [name]);

  if (load.kind === 'ready') return <SnapshotScene design={load.design} />;
  if (load.kind === 'loading') return <p className="page-message">Loading…</p>;
  return (
    <main className="page-message" role="alert" data-testid="snapshot-failed" data-kind={load.kind}>
      <h1>{load.kind === 'refused' ? load.title : "Couldn't load this design"}</h1>
      {load.kind === 'refused' ? <p>{load.message}</p> : <p>Check your connection and try again.</p>}
      {load.kind === 'failed' && (
        <p className="page-message__actions">
          <button type="button" className="button-quiet" onClick={() => setAttempt((count) => count + 1)}>
            Try again
          </button>
        </p>
      )}
    </main>
  );
}
