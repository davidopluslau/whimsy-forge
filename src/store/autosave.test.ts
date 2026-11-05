import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDesign, type Design } from '../model/design';
import { AUTOSAVE_DELAY_MS, Autosaver, DRAFT_DELAY_MS } from './autosave';
import type { Draft } from './drafts';

class HttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

/** A server the test answers by hand, so it controls when each save finishes. */
function setup(options: { etag?: string | null; unsaved?: boolean } = {}) {
  const puts: { json: string; etag: string | null; resolve: (etag: string | null) => void; reject: (error: unknown) => void }[] = [];
  const drafts: Draft[] = [];
  const cleared = { count: 0 };
  const design = createEmptyDesign('Test');
  const saver = new Autosaver(
    design,
    options.etag ?? 'etag-0',
    {
      put: (json, etag) => new Promise((resolve, reject) => puts.push({ json, etag, resolve, reject })),
      writeDraft: (draft) => drafts.push(draft),
      clearDraft: () => {
        cleared.count += 1;
      },
    },
    { unsaved: options.unsaved },
  );
  return { saver, design, puts, drafts, cleared };
}

const edited = (design: Design, name: string): Design => ({ ...design, name });
const namesIn = (json: string) => (JSON.parse(json) as Design).name;
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the save delay', () => {
  it('saves 2 seconds after a change, and not before', async () => {
    const { saver, design, puts } = setup();
    expect(saver.getState()).toEqual({ status: 'saved' });

    saver.change(edited(design, 'a'));
    expect(saver.getState()).toEqual({ status: 'saving' });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(puts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(puts).toHaveLength(1);
    expect(namesIn(puts[0]!.json)).toBe('a');
  });

  it('counts from the last change, and sends only the latest state', async () => {
    const { saver, design, puts } = setup();
    saver.change(edited(design, 'a'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 500);
    saver.change(edited(design, 'b'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 500);
    expect(puts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(puts.map((put) => namesIn(put.json))).toEqual(['b']);
  });

  it('reports saved once the save returns', async () => {
    const { saver, design, puts } = setup();
    const seen: string[] = [];
    saver.subscribe(() => seen.push(saver.getState().status));
    saver.change(edited(design, 'a'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    puts[0]!.resolve('etag-1');
    await settle();
    expect(saver.getState()).toEqual({ status: 'saved' });
    expect(seen.at(-1)).toBe('saved');
  });

  it('ignores a notification with the design it already has', async () => {
    const { saver, design, puts } = setup();
    saver.change(design);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(puts).toHaveLength(0);
    expect(saver.getState()).toEqual({ status: 'saved' });
  });
});

describe('save ordering', () => {
  it('runs one save at a time, each conditional on the tag from the one before', async () => {
    const { saver, design, puts } = setup();
    saver.change(edited(design, 'a'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(puts[0]!.etag).toBe('etag-0');

    saver.change(edited(design, 'b'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3);
    expect(puts).toHaveLength(1);

    puts[0]!.resolve('etag-1');
    await settle();
    expect(saver.getState()).toEqual({ status: 'saving' });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(puts).toHaveLength(2);
    expect(namesIn(puts[1]!.json)).toBe('b');
    expect(puts[1]!.etag).toBe('etag-1');
  });
});

describe('the local draft', () => {
  it('is written within half a second of a change, long before the server save', async () => {
    const { saver, design, drafts, puts } = setup();
    saver.change(edited(design, 'a'));
    expect(drafts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    expect(puts).toHaveLength(0);
    expect(drafts).toHaveLength(1);
    expect(namesIn(drafts[0]!.json)).toBe('a');
    expect(drafts[0]!.etag).toBe('etag-0');
  });

  it('holds the latest state during a burst of changes', async () => {
    const { saver, design, drafts } = setup();
    for (const name of ['a', 'b', 'c']) {
      saver.change(edited(design, name));
      await vi.advanceTimersByTimeAsync(200);
    }
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    expect(namesIn(drafts.at(-1)!.json)).toBe('c');
    expect(drafts.length).toBeLessThanOrEqual(2);
  });

  it('is cleared when a save leaves nothing outstanding', async () => {
    const { saver, design, puts, cleared } = setup();
    saver.change(edited(design, 'a'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    puts[0]!.resolve('etag-1');
    await settle();
    expect(cleared.count).toBe(1);
  });

  it('survives a save that finishes while newer edits are waiting, with the new tag', async () => {
    const { saver, design, puts, drafts, cleared } = setup();
    saver.change(edited(design, 'a'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    saver.change(edited(design, 'b'));
    puts[0]!.resolve('etag-1');
    await settle();
    expect(cleared.count).toBe(0);
    expect(drafts.at(-1)).toEqual({ json: expect.stringContaining('"name":"b"'), etag: 'etag-1' });
  });

  it('is not written again after the save that made it unnecessary', async () => {
    const { saver, design, puts, drafts } = setup();
    saver.change(edited(design, 'a'));
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    const written = drafts.length;
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    puts[0]!.resolve('etag-1');
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS * 2);
    expect(drafts).toHaveLength(written);
  });
});

describe('leaving the page', () => {
  it('writes the draft at once and starts the save without waiting', () => {
    const { saver, design, drafts, puts } = setup();
    saver.change(edited(design, 'a'));
    saver.leavePage();
    expect(namesIn(drafts.at(-1)!.json)).toBe('a');
    expect(puts).toHaveLength(1);
  });

  it('does nothing when everything is saved', () => {
    const { saver, drafts, puts } = setup();
    saver.leavePage();
    expect(drafts).toHaveLength(0);
    expect(puts).toHaveLength(0);
  });

  it('keeps the draft if a save is already running, rather than racing it', async () => {
    const { saver, design, drafts, puts } = setup();
    saver.change(edited(design, 'a'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    saver.change(edited(design, 'b'));
    saver.leavePage();
    expect(puts).toHaveLength(1);
    expect(namesIn(drafts.at(-1)!.json)).toBe('b');
  });
});

describe('failed saves', () => {
  async function failOnce(status?: number) {
    const context = setup();
    context.saver.change(edited(context.design, 'a'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    context.puts[0]!.reject(status === undefined ? new TypeError('Failed to fetch') : new HttpError(status));
    await settle();
    return context;
  }

  it('reports the error with its status, and keeps the work in a draft', async () => {
    const { saver, drafts } = await failOnce(500);
    expect(saver.getState()).toEqual({ status: 'error', httpStatus: 500 });
    expect(namesIn(drafts.at(-1)!.json)).toBe('a');
  });

  it('reports a network failure as an error with no status', async () => {
    const { saver } = await failOnce();
    expect(saver.getState()).toEqual({ status: 'error' });
  });

  it('retries by itself, backing off, until a save succeeds', async () => {
    const { saver, puts, cleared } = await failOnce();
    await vi.advanceTimersByTimeAsync(5000);
    expect(puts).toHaveLength(2);
    puts[1]!.reject(new TypeError('Failed to fetch'));
    await settle();

    await vi.advanceTimersByTimeAsync(9999);
    expect(puts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(puts).toHaveLength(3);

    puts[2]!.resolve('etag-1');
    await settle();
    expect(saver.getState()).toEqual({ status: 'saved' });
    expect(cleared.count).toBe(1);
  });

  it('stays marked as an error through further edits until a save works', async () => {
    const { saver, design, puts } = await failOnce();
    saver.change(edited(design, 'b'));
    expect(saver.getState().status).toBe('error');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(namesIn(puts[1]!.json)).toBe('b');
  });
});

describe('conflicts', () => {
  async function conflicted() {
    const context = setup();
    context.saver.change(edited(context.design, 'a'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    context.puts[0]!.reject(new HttpError(412));
    await settle();
    return context;
  }

  it('stops saving and asks, instead of retrying', async () => {
    const { saver, puts } = await conflicted();
    expect(saver.getState()).toEqual({ status: 'conflict' });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(puts).toHaveLength(1);
  });

  it('keeps later edits in the draft while it waits', async () => {
    const { saver, design, puts, drafts } = await conflicted();
    saver.change(edited(design, 'b'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(puts).toHaveLength(1);
    expect(saver.getState()).toEqual({ status: 'conflict' });
    expect(namesIn(drafts.at(-1)!.json)).toBe('b');
  });

  it('overwrites unconditionally when the owner keeps this version, then carries on', async () => {
    const { saver, design, puts } = await conflicted();
    void saver.overwrite();
    expect(puts[1]!.etag).toBeNull();
    puts[1]!.resolve('etag-2');
    await settle();
    expect(saver.getState()).toEqual({ status: 'saved' });

    saver.change(edited(design, 'b'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(puts[2]!.etag).toBe('etag-2');
  });
});

describe('flush', () => {
  it('waits for the running save and then saves what came after it', async () => {
    const { saver, design, puts } = setup();
    saver.change(edited(design, 'a'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    saver.change(edited(design, 'b'));

    const flushed = saver.flush();
    puts[0]!.resolve('etag-1');
    await settle();
    expect(namesIn(puts[1]!.json)).toBe('b');
    puts[1]!.resolve('etag-2');
    await expect(flushed).resolves.toBe(true);
    expect(saver.getState()).toEqual({ status: 'saved' });
  });

  it('reports false rather than waiting forever on a failing server', async () => {
    const { saver, design, puts } = setup();
    saver.change(edited(design, 'a'));
    const flushed = saver.flush();
    await settle();
    puts[0]!.reject(new TypeError('Failed to fetch'));
    await expect(flushed).resolves.toBe(false);
  });

  it('has nothing to do when everything is saved', async () => {
    const { saver, puts } = setup();
    await expect(saver.flush()).resolves.toBe(true);
    expect(puts).toHaveLength(0);
  });
});

describe('a design the server has not got yet', () => {
  it('shows as saving from the start, and saves on request', async () => {
    const { saver, puts } = setup({ unsaved: true });
    expect(saver.getState()).toEqual({ status: 'saving' });
    void saver.saveNow();
    expect(puts).toHaveLength(1);
    puts[0]!.resolve('etag-1');
    await settle();
    expect(saver.getState()).toEqual({ status: 'saved' });
  });
});

describe('dispose', () => {
  it('stops saves and drafts, even when the page is then closed', async () => {
    const { saver, design, puts, drafts } = setup();
    saver.change(edited(design, 'a'));
    saver.dispose();
    saver.leavePage();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(puts).toHaveLength(0);
    expect(drafts).toHaveLength(0);
    await expect(saver.flush()).resolves.toBe(false);
  });
});
