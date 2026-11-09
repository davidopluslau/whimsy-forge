import { useCallback, useEffect, useState } from 'react';
import { type CatalogAsset, parseCatalog } from '../model/catalog';

export async function fetchCatalog(signal?: AbortSignal): Promise<CatalogAsset[]> {
  const response = await fetch('/api/catalog', { signal });
  if (!response.ok) throw new Error(`The catalog answered ${response.status}`);
  return parseCatalog(await response.json());
}

/** The owner's personal catalog. Only the editor asks for it; a 404 means nothing has been imported yet. */
export async function fetchPrivateCatalog(signal?: AbortSignal): Promise<CatalogAsset[]> {
  const response = await fetch('/api/private/catalog', { signal });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`The personal catalog answered ${response.status}`);
  return parseCatalog(await response.json(), 'private');
}

export type CatalogState =
  | { status: 'loading' }
  | { status: 'error' }
  /** `privateFailed` says the personal catalog couldn't be read, so only public assets are listed. */
  | { status: 'ready'; assets: CatalogAsset[]; privateFailed: boolean };

/**
 * The catalog to place from. With `withPrivate`, the owner's private assets follow the public ones. The
 * public catalog decides whether this loads at all, because a failure of the personal one must not take
 * the rest down. The viewer never passes it, so a share link never asks for anything private.
 */
export function useCatalog({ withPrivate = false }: { withPrivate?: boolean } = {}): { catalog: CatalogState; retry: () => void } {
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setCatalog({ status: 'loading' });
    const personal = withPrivate ? fetchPrivateCatalog(controller.signal).then((assets) => ({ assets, failed: false }), () => ({ assets: [], failed: true })) : Promise.resolve({ assets: [], failed: false });
    Promise.all([fetchCatalog(controller.signal), personal]).then(
      ([assets, privateAssets]) => {
        if (privateAssets.failed && !controller.signal.aborted) console.warn('Listing public assets only: the personal catalog could not be read');
        setCatalog({ status: 'ready', assets: [...assets, ...privateAssets.assets], privateFailed: privateAssets.failed });
      },
      () => {
        if (!controller.signal.aborted) setCatalog({ status: 'error' });
      },
    );
    return () => controller.abort();
  }, [attempt, withPrivate]);

  return { catalog, retry: useCallback(() => setAttempt((count) => count + 1), []) };
}
