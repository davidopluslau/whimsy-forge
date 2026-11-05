import type { Design } from '../model/design';
import { parseDesign } from '../model/migrate';

/**
 * The newest unsaved state of a design, in this browser's localStorage, so a killed tab or a dead
 * network doesn't lose work. `etag` is the stored version that the draft was edited from.
 */
export type Draft = { json: string; etag: string | null };

const draftKey = (id: string) => `whimsy-forge:draft:${id}`;

// Storage can be full or blocked. A draft is a safety net, so losing one must not stop the editor.
export function writeDraft(id: string, draft: Draft): void {
  try {
    localStorage.setItem(draftKey(id), JSON.stringify(draft));
  } catch {
    // Saving to the server carries on regardless.
  }
}

export function clearDraft(id: string): void {
  try {
    localStorage.removeItem(draftKey(id));
  } catch {
    // Nothing to clear if storage is blocked.
  }
}

export function readDraft(id: string): Draft | null {
  try {
    const text = localStorage.getItem(draftKey(id));
    if (text === null) return null;
    const { json, etag } = JSON.parse(text) as Partial<Draft>;
    return typeof json === 'string' ? { json, etag: typeof etag === 'string' ? etag : null } : null;
  } catch {
    return null;
  }
}

/** What the editor opens with. `restored` means the design holds work the server doesn't have yet. */
export type StartingPoint = { design: Design; etag: string | null; restored: boolean };

function parsedDraft(draft: Draft | null, id: string): Design | null {
  if (!draft) return null;
  try {
    const design = parseDesign(draft.json);
    return design.id === id ? design : null;
  } catch {
    return null;
  }
}

/**
 * Chooses between the server's copy and a local draft: the draft only if it's strictly newer. A
 * restored draft keeps the etag it was edited from, so if the server's copy moved on in the
 * meantime, the first save reports a conflict and overwrites nothing. Throws if the server's copy
 * can't be opened, since a draft must not hide that. Returns null if neither exists.
 */
export function chooseStartingPoint(id: string, server: { json: string; etag: string | null } | null, draft: Draft | null): StartingPoint | null {
  const stored = server ? parseDesign(server.json) : null;
  const local = parsedDraft(draft, id);
  if (local && draft && (!stored || Date.parse(local.updatedAt) > Date.parse(stored.updatedAt))) {
    return { design: local, etag: draft.etag, restored: true };
  }
  return stored && server ? { design: stored, etag: server.etag, restored: false } : null;
}
