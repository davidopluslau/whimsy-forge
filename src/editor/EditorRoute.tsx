import { useEffect, useState } from 'react';
import { ApiError, getDesignJson, putDesignJson } from '../api/designs';
import { createEmptyDesign } from '../model/design';
import { isDesignId } from '../model/ids';
import { NewerSchemaError, UnreadableDesignError } from '../model/migrate';
import { Autosaver } from '../store/autosave';
import { useDesignStore } from '../store/designStore';
import { chooseStartingPoint, clearDraft, readDraft, writeDraft, type StartingPoint } from '../store/drafts';
import EditorPage from './EditorPage';

/** The path that creates a design. It's replaced in the address bar, so reloading doesn't create another. */
const NEW_DESIGN_TARGET = 'new';

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; saver: Autosaver }
  /** Nothing to open, and trying again won't help. */
  | { kind: 'refused'; title: string; message: string }
  /** The server couldn't be asked. */
  | { kind: 'failed'; message: string };

async function fetchStartingPoint(id: string): Promise<StartingPoint | null> {
  let server: Awaited<ReturnType<typeof getDesignJson>> | null = null;
  try {
    server = await getDesignJson(id);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
  return chooseStartingPoint(id, server, readDraft(id));
}

function refusalOf(error: unknown): Load {
  if (error instanceof NewerSchemaError) return { kind: 'refused', title: 'Saved by a newer version', message: error.message };
  if (error instanceof UnreadableDesignError) return { kind: 'refused', title: "This design can't be opened", message: error.message };
  return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
}

/** Loads the design named by the URL, keeps it saved, and shows the editor or why it can't. */
export default function EditorRoute({ target }: { target: string }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;

    function start({ design, etag, restored }: StartingPoint, isNew: boolean) {
      const { setDesign } = useDesignStore.getState();
      setDesign(design);
      if (isNew) window.history.replaceState(null, '', `/editor/${design.id}`);

      const saver = new Autosaver(
        design,
        etag,
        {
          put: (json, ifMatch) => putDesignJson(design.id, json, ifMatch),
          writeDraft: (draft) => writeDraft(design.id, draft),
          clearDraft: () => clearDraft(design.id),
        },
        { unsaved: isNew || restored },
      );
      const unsubscribe = useDesignStore.subscribe((state) => saver.change(state.design));
      const leavePage = () => saver.leavePage();
      const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') saver.leavePage();
      };
      window.addEventListener('pagehide', leavePage);
      document.addEventListener('visibilitychange', onVisibilityChange);
      stop = () => {
        unsubscribe();
        window.removeEventListener('pagehide', leavePage);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        saver.dispose();
      };

      setLoad({ kind: 'ready', saver });
      if (isNew || restored) void saver.saveNow();
    }

    async function open() {
      setLoad({ kind: 'loading' });
      if (target === NEW_DESIGN_TARGET) {
        // One tick later, so StrictMode's throwaway first effect doesn't save an extra empty design.
        await Promise.resolve();
        if (!cancelled) start({ design: createEmptyDesign('Untitled design'), etag: null, restored: false }, true);
        return;
      }
      if (!isDesignId(target)) {
        setLoad({ kind: 'refused', title: 'Design not found', message: 'This address does not point at a design.' });
        return;
      }
      try {
        const point = await fetchStartingPoint(target);
        if (cancelled) return;
        if (!point) {
          setLoad({ kind: 'refused', title: 'Design not found', message: 'It may have been deleted.' });
          return;
        }
        if (!point.restored) clearDraft(target);
        start(point, false);
      } catch (error) {
        if (!cancelled) setLoad(refusalOf(error));
      }
    }

    void open();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [target, attempt]);

  if (load.kind === 'ready') return <EditorPage saver={load.saver} />;
  if (load.kind === 'loading') return <p className="page-message">Loading…</p>;
  return (
    <main className="page-message" role="alert" data-testid="open-failed" data-kind={load.kind}>
      <h1>{load.kind === 'refused' ? load.title : "Couldn't load this design"}</h1>
      <p>{load.message}</p>
      <p className="page-message__actions">
        {load.kind === 'failed' && (
          <button type="button" className="button-quiet" onClick={() => setAttempt((count) => count + 1)}>
            Try again
          </button>
        )}
        <a href="/editor">Back to designs</a>
      </p>
    </main>
  );
}
