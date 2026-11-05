import { useSyncExternalStore } from 'react';
import type { Autosaver, SaveState } from '../store/autosave';
import { useDesignStore } from '../store/designStore';
import { clearDraft } from '../store/drafts';

function errorText(state: Extract<SaveState, { status: 'error' }>): { label: string; detail: string } {
  if (state.httpStatus === 401) return { label: 'Not saved: signed out', detail: 'Your edits are kept in this browser. Reload the page to sign in again.' };
  if (state.httpStatus === 413) return { label: 'Not saved: too large', detail: 'This design is over the 1 MiB limit. Your edits are kept in this browser.' };
  return { label: 'Not saved: retrying', detail: 'Your edits are kept in this browser, and saving keeps being retried.' };
}

/** Shows whether the design is safe, and handles a conflict with another tab. */
export function SaveIndicator({ saver }: { saver: Autosaver }) {
  const state = useSyncExternalStore(saver.subscribe, saver.getState);

  function loadLatest() {
    saver.dispose();
    clearDraft(useDesignStore.getState().design.id);
    window.location.reload();
  }

  if (state.status === 'conflict') {
    return (
      <span className="save-status" role="alert" data-testid="save-status" data-state="conflict">
        <span title="This design was saved from another tab or window after you opened it here.">Changed elsewhere</span>
        <button type="button" className="button-quiet" onClick={loadLatest} title="Discard the edits in this tab and open the stored version">
          Load latest
        </button>
        <button type="button" className="button-quiet" onClick={() => void saver.overwrite()} title="Replace the stored version with this tab's">
          Keep mine
        </button>
      </span>
    );
  }
  const error = state.status === 'error' ? errorText(state) : null;
  return (
    <span className="save-status" role="status" data-testid="save-status" data-state={state.status} title={error?.detail}>
      {error ? error.label : state.status === 'saving' ? 'Saving…' : 'Saved'}
    </span>
  );
}
