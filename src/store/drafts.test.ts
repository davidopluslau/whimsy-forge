import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDesign, CURRENT_SCHEMA_VERSION } from '../model/design';
import { NewerSchemaError } from '../model/migrate';
import { chooseStartingPoint, clearDraft, readDraft, writeDraft } from './drafts';

const design = (updatedAt: string, name = 'Test') => ({ ...createEmptyDesign(name), id: 'ID', updatedAt });
const OLD = '2026-01-01T00:00:00.000Z';
const NEW = '2026-01-02T00:00:00.000Z';

describe('chooseStartingPoint', () => {
  const server = (updatedAt: string) => ({ json: JSON.stringify(design(updatedAt, 'server')), etag: 'server-tag' });
  const draft = (updatedAt: string) => ({ json: JSON.stringify(design(updatedAt, 'draft')), etag: 'draft-tag' });

  it('opens the server copy when there is no draft', () => {
    expect(chooseStartingPoint('ID', server(OLD), null)).toMatchObject({ design: { name: 'server' }, etag: 'server-tag', restored: false });
  });

  it('restores a newer draft, keeping the etag it was edited from', () => {
    expect(chooseStartingPoint('ID', server(OLD), draft(NEW))).toMatchObject({ design: { name: 'draft' }, etag: 'draft-tag', restored: true });
  });

  it('ignores a draft that is older, or the same age, because the save reached the server', () => {
    expect(chooseStartingPoint('ID', server(NEW), draft(OLD))).toMatchObject({ design: { name: 'server' }, restored: false });
    expect(chooseStartingPoint('ID', server(NEW), draft(NEW))).toMatchObject({ design: { name: 'server' }, restored: false });
  });

  it('restores a draft of a design the server never received', () => {
    expect(chooseStartingPoint('ID', null, draft(NEW))).toMatchObject({ design: { name: 'draft' }, restored: true });
  });

  it('returns null with neither', () => {
    expect(chooseStartingPoint('ID', null, null)).toBeNull();
  });

  it.each([
    ['is damaged', { json: '{nope', etag: null }],
    ['belongs to another design', { json: JSON.stringify({ ...design(NEW), id: 'OTHER' }), etag: null }],
  ])('ignores a draft that %s', (_name, bad) => {
    expect(chooseStartingPoint('ID', server(OLD), bad)).toMatchObject({ restored: false });
    expect(chooseStartingPoint('ID', null, bad)).toBeNull();
  });

  it('refuses a newer server copy even when a draft exists', () => {
    const newer = { json: JSON.stringify({ ...design(OLD), schemaVersion: CURRENT_SCHEMA_VERSION + 1 }), etag: null };
    expect(() => chooseStartingPoint('ID', newer, draft(NEW))).toThrow(NewerSchemaError);
  });
});

describe('draft storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('with working storage', () => {
    beforeEach(() => {
      const items = new Map<string, string>();
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => items.set(key, value),
        removeItem: (key: string) => items.delete(key),
      });
    });

    it('reads back what it wrote, per design, until cleared', () => {
      writeDraft('a', { json: '{"a":1}', etag: 'tag' });
      writeDraft('b', { json: '{"b":1}', etag: null });
      expect(readDraft('a')).toEqual({ json: '{"a":1}', etag: 'tag' });
      expect(readDraft('b')).toEqual({ json: '{"b":1}', etag: null });
      clearDraft('a');
      expect(readDraft('a')).toBeNull();
      expect(readDraft('b')).not.toBeNull();
    });

    it('treats a damaged entry as no draft', () => {
      localStorage.setItem('whimsy-forge:draft:a', '{nope');
      expect(readDraft('a')).toBeNull();
      localStorage.setItem('whimsy-forge:draft:a', '{"etag":"x"}');
      expect(readDraft('a')).toBeNull();
    });
  });

  it('carries on when storage throws, as when it is full or blocked', () => {
    const refuse = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse, removeItem: refuse });
    expect(() => writeDraft('a', { json: '{}', etag: null })).not.toThrow();
    expect(() => clearDraft('a')).not.toThrow();
    expect(readDraft('a')).toBeNull();
  });
});
