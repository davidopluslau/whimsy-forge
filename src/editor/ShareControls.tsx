import { type MutableRefObject, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/designs';
import { imageFileName, saveBlob, type SceneCapture, viewImage } from '../scene/capture';
import { useDesignStore } from '../store/designStore';
import { shareDesign } from './share';

type ShareState =
  | { status: 'closed' }
  | { status: 'sharing' }
  | { status: 'shared'; url: string; copied: boolean }
  | { status: 'failed'; message: string };

const failureMessage = (error: unknown) =>
  error instanceof ApiError && error.status === 401
    ? 'You are signed out, so nothing was shared. Sign in again, then try once more. Previews of this site can never share.'
    : 'The link could not be created. Check your connection and try again.';

async function copied(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

/** The editor's Share and Export image buttons, and the dialog that shows a new link. */
export function ShareControls({ capture }: { capture: MutableRefObject<SceneCapture | null> }) {
  const [state, setState] = useState<ShareState>({ status: 'closed' });
  const [exportFailed, setExportFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const open = state.status !== 'closed';

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  async function share() {
    setState({ status: 'sharing' });
    try {
      const url = await shareDesign(useDesignStore.getState().design, capture.current);
      setState({ status: 'shared', url, copied: await copied(url) });
    } catch (error) {
      setState({ status: 'failed', message: failureMessage(error) });
    }
  }

  async function exportImage() {
    if (!capture.current) return;
    setExportFailed(false);
    try {
      saveBlob(await viewImage(capture.current), imageFileName(useDesignStore.getState().design.name));
    } catch (error) {
      console.warn('Could not export an image', error);
      setExportFailed(true);
    }
  }

  return (
    <>
      <button type="button" className="button-quiet" title="Save a PNG of the 3D view" onClick={() => void exportImage()}>
        Export image
      </button>
      {exportFailed && (
        <span className="share__export-error" role="alert">
          Could not export the image.
        </span>
      )}
      <button type="button" className="button-primary" disabled={state.status === 'sharing'} onClick={() => void share()}>
        Share
      </button>
      <dialog ref={dialog} className="share" data-testid="share-dialog" data-state={state.status} onClose={() => setState({ status: 'closed' })}>
        <h2>Share this design</h2>
        {state.status === 'sharing' && <p role="status">Creating a link…</p>}
        {state.status === 'failed' && (
          <p className="share__error" role="alert">
            {state.message}
          </p>
        )}
        {state.status === 'shared' && (
          <>
            <p role="status">{state.copied ? 'Link copied. Anyone with it can view this design, without signing in.' : 'Copy this link. Anyone with it can view this design, without signing in.'}</p>
            <input className="share__link" data-testid="share-link" type="text" readOnly aria-label="Share link" value={state.url} onFocus={(event) => event.target.select()} />
            <p className="share__note">It shows the design as it is now. Later edits won't change it; share again to send a newer version.</p>
          </>
        )}
        <div className="share__actions">
          {state.status === 'shared' && (
            <>
              <button
                type="button"
                className="button-quiet"
                onClick={() => {
                  void copied(state.url).then((done) => setState({ ...state, copied: done }));
                }}
              >
                Copy link
              </button>
              <a href={state.url} target="_blank" rel="noreferrer">
                Open
              </a>
            </>
          )}
          <button type="button" className="button-quiet" onClick={() => setState({ status: 'closed' })}>
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
