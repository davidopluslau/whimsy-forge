import type { Design } from '../model/design';
import type { Draft } from './drafts';

/** The server save happens this long after the last change. */
export const AUTOSAVE_DELAY_MS = 2000;
/** The local draft is written at most this long after a change, so a killed tab loses no more. */
export const DRAFT_DELAY_MS = 500;
const RETRY_BASE_MS = 5000;
const RETRY_MAX_MS = 60_000;

export type SaveState =
  | { status: 'saved' }
  | { status: 'saving' }
  /** The last attempt failed and another is scheduled. `httpStatus` is absent if the server wasn't reached. */
  | { status: 'error'; httpStatus?: number }
  /** The stored design moved on without this tab. Nothing saves until the owner chooses a side. */
  | { status: 'conflict' };

export type AutosaveDeps = {
  /** Saves the JSON, conditional on `etag` if there is one, and returns the new ETag. Rejects with a `status` on an HTTP error. */
  put: (json: string, etag: string | null) => Promise<string | null>;
  writeDraft: (draft: Draft) => void;
  clearDraft: () => void;
};

const httpStatusOf = (error: unknown): number | undefined => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
};

/**
 * Keeps one open design saved. Saves run one at a time, so each is conditional on the tag the last one
 * returned. Work is safe in three layers: the server save 2 seconds after the last change, a local
 * draft within half a second, and both again the moment the page is hidden or closed.
 */
export class Autosaver {
  #design: Design;
  #saved: Design | null;
  #etag: string | null;
  readonly #deps: AutosaveDeps;
  #state: SaveState = { status: 'saved' };
  #saveTimer: ReturnType<typeof setTimeout> | null = null;
  #draftTimer: ReturnType<typeof setTimeout> | null = null;
  #inFlight: Promise<void> | null = null;
  #failures = 0;
  #disposed = false;
  readonly #listeners = new Set<() => void>();

  /** With `unsaved`, the design holds work the server doesn't have, such as a restored draft or a new design. */
  constructor(design: Design, etag: string | null, deps: AutosaveDeps, options: { unsaved?: boolean } = {}) {
    this.#design = design;
    this.#saved = options.unsaved ? null : design;
    this.#etag = etag;
    this.#deps = deps;
    if (options.unsaved) this.#state = { status: 'saving' };
  }

  get #dirty() {
    return this.#design !== this.#saved;
  }

  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  readonly getState = () => this.#state;

  #setState(state: SaveState) {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }

  #clearSaveTimer() {
    if (this.#saveTimer !== null) clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
  }

  #schedule(delay: number) {
    this.#clearSaveTimer();
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      void this.#save();
    }, delay);
  }

  #writeDraftNow() {
    if (this.#draftTimer !== null) clearTimeout(this.#draftTimer);
    this.#draftTimer = null;
    this.#deps.writeDraft({ json: JSON.stringify(this.#design), etag: this.#etag });
  }

  /** Call with the design after every change. */
  change(design: Design) {
    if (this.#disposed || design === this.#design) return;
    this.#design = design;
    this.#draftTimer ??= setTimeout(() => this.#writeDraftNow(), DRAFT_DELAY_MS);
    if (this.#state.status === 'conflict') return;
    // A failed save stays reported as an error until a later one succeeds.
    if (this.#state.status === 'saved') this.#setState({ status: 'saving' });
    if (!this.#inFlight) this.#schedule(AUTOSAVE_DELAY_MS);
  }

  #save(overwrite = false): Promise<void> {
    if (this.#inFlight) return this.#inFlight;
    if (this.#disposed || !this.#dirty || (this.#state.status === 'conflict' && !overwrite)) return Promise.resolve();
    this.#clearSaveTimer();
    const design = this.#design;
    this.#setState({ status: 'saving' });
    this.#inFlight = this.#deps
      .put(JSON.stringify(design), overwrite ? null : this.#etag)
      .then(
        (etag) => this.#saveSucceeded(design, etag),
        (error: unknown) => this.#saveFailed(error),
      );
    return this.#inFlight;
  }

  #saveSucceeded(design: Design, etag: string | null) {
    this.#inFlight = null;
    this.#saved = design;
    this.#etag = etag;
    this.#failures = 0;
    if (this.#disposed) return;
    if (this.#dirty) {
      // The draft on disk has the old tag, and that version is now superseded by this very save.
      this.#writeDraftNow();
      this.#schedule(AUTOSAVE_DELAY_MS);
    } else {
      if (this.#draftTimer !== null) clearTimeout(this.#draftTimer);
      this.#draftTimer = null;
      this.#deps.clearDraft();
      this.#setState({ status: 'saved' });
    }
  }

  #saveFailed(error: unknown) {
    this.#inFlight = null;
    if (this.#disposed) return;
    this.#writeDraftNow();
    const httpStatus = httpStatusOf(error);
    if (httpStatus === 412) {
      this.#setState({ status: 'conflict' });
      return;
    }
    this.#failures += 1;
    this.#setState(httpStatus === undefined ? { status: 'error' } : { status: 'error', httpStatus });
    this.#schedule(Math.min(RETRY_BASE_MS * 2 ** (this.#failures - 1), RETRY_MAX_MS));
  }

  /** Saves without waiting for the delay. */
  saveNow() {
    return this.#save();
  }

  /** Saves everything outstanding, and resolves with whether it all reached the server. */
  async flush(): Promise<boolean> {
    while (!this.#disposed && this.#dirty && this.#state.status !== 'conflict') {
      if (this.#inFlight) {
        await this.#inFlight;
        continue;
      }
      await this.#save();
      if (this.#state.status === 'error') return false;
    }
    return !this.#dirty;
  }

  /** The page is being hidden or closed: write the draft at once, and start a save that outlives the page. */
  leavePage() {
    if (this.#disposed || !this.#dirty) return;
    this.#writeDraftNow();
    void this.#save();
  }

  /** After a conflict: this tab's version replaces the stored one. */
  overwrite() {
    return this.#save(true);
  }

  /** Stops all saving and writing. For when the page's work is being thrown away. */
  dispose() {
    this.#disposed = true;
    this.#clearSaveTimer();
    if (this.#draftTimer !== null) clearTimeout(this.#draftTimer);
    this.#draftTimer = null;
  }
}
