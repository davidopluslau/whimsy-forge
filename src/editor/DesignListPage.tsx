import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, deleteDesign, duplicateStoredDesign, listDesigns, renameStoredDesign, type DesignSummary } from '../api/designs';
import { MAX_DESIGN_NAME_LENGTH } from '../model/design';
import { clearDraft } from '../store/drafts';

/** An object saved before names were recorded for the list. */
const UNNAMED = 'Unnamed design';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function when(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date);
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return 'You are signed out. Reload the page to sign in again.';
  if (error instanceof ApiError && error.status === 412) return 'That design changed while this was happening. Try again.';
  return error instanceof Error ? error.message : String(error);
}

type Row = 'idle' | 'renaming' | 'confirming-delete';

function DesignRow({ design, busy, onRename, onDuplicate, onDelete }: {
  design: DesignSummary;
  busy: boolean;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [row, setRow] = useState<Row>('idle');
  const name = design.name || UNNAMED;

  function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = new FormData(event.currentTarget).get('name');
    setRow('idle');
    if (typeof typed === 'string') onRename(typed);
  }

  return (
    <li className="designs__row" data-testid="design-row" data-design-id={design.id}>
      {row === 'renaming' ? (
        <form className="designs__rename" onSubmit={submitRename}>
          <input
            type="text"
            name="name"
            aria-label={`New name for ${name}`}
            defaultValue={design.name}
            maxLength={MAX_DESIGN_NAME_LENGTH}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Escape') setRow('idle');
            }}
          />
          <button type="submit" className="button-quiet">
            Save
          </button>
          <button type="button" className="button-quiet" onClick={() => setRow('idle')}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="designs__title">
          <a href={`/editor/${design.id}`}>{name}</a>
          <span className="designs__updated">{when(design.updatedAt)}</span>
        </div>
      )}
      {row === 'confirming-delete' ? (
        <div className="designs__actions" role="group" aria-label={`Confirm deleting ${name}`}>
          <span>Delete this design?</span>
          <button
            type="button"
            className="button-quiet button-danger"
            disabled={busy}
            onClick={() => {
              setRow('idle');
              onDelete();
            }}
          >
            Delete
          </button>
          <button type="button" className="button-quiet" onClick={() => setRow('idle')}>
            Keep
          </button>
        </div>
      ) : (
        row === 'idle' && (
          <div className="designs__actions">
            <button type="button" className="button-quiet" disabled={busy} onClick={() => setRow('renaming')}>
              Rename
            </button>
            <button type="button" className="button-quiet" disabled={busy} onClick={onDuplicate}>
              Duplicate
            </button>
            <button type="button" className="button-quiet" disabled={busy} onClick={() => setRow('confirming-delete')}>
              Delete
            </button>
          </div>
        )
      )}
    </li>
  );
}

type Listing = { status: 'loading' } | { status: 'ready'; designs: DesignSummary[] } | { status: 'error'; message: string };

export default function DesignListPage() {
  const [listing, setListing] = useState<Listing>({ status: 'loading' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setListing({ status: 'ready', designs: await listDesigns() });
    } catch (error) {
      setListing({ status: 'error', message: messageOf(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Runs one action on a stored design, then shows the list as the server now has it. */
  async function act(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(messageOf(error));
    }
    await refresh();
    setBusyId(null);
  }

  return (
    <main className="designs">
      <header className="designs__header">
        <h1>Designs</h1>
        <a className="button-primary" href="/editor/new">
          New design
        </a>
      </header>
      {actionError && (
        <p className="designs__error" role="alert" data-testid="designs-error">
          {actionError}
        </p>
      )}
      {listing.status === 'loading' && <p className="designs__note">Loading…</p>}
      {listing.status === 'error' && (
        <div className="designs__error" role="alert" data-testid="designs-error">
          <p>{listing.message}</p>
          <button type="button" className="button-quiet" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      )}
      {listing.status === 'ready' && listing.designs.length === 0 && <p className="designs__note">No designs yet. Start one with New design.</p>}
      {listing.status === 'ready' && listing.designs.length > 0 && (
        <ul className="designs__list" data-testid="design-list">
          {listing.designs.map((design) => (
            <DesignRow
              key={design.id}
              design={design}
              busy={busyId !== null}
              onRename={(name) => void act(design.id, () => renameStoredDesign(design.id, name))}
              onDuplicate={() => void act(design.id, () => duplicateStoredDesign(design.id))}
              onDelete={() =>
                void act(design.id, async () => {
                  await deleteDesign(design.id);
                  clearDraft(design.id);
                })
              }
            />
          ))}
        </ul>
      )}
    </main>
  );
}
