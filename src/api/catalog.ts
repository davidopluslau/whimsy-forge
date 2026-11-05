import { useCallback, useEffect, useState } from 'react';
import { type CatalogAsset, parseCatalog } from '../model/catalog';

export async function fetchCatalog(signal?: AbortSignal): Promise<CatalogAsset[]> {
  const response = await fetch('/api/catalog', { signal });
  if (!response.ok) throw new Error(`The catalog answered ${response.status}`);
  return parseCatalog(await response.json());
}

export type CatalogState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; assets: CatalogAsset[] };

export function useCatalog(): { catalog: CatalogState; retry: () => void } {
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setCatalog({ status: 'loading' });
    fetchCatalog(controller.signal).then(
      (assets) => setCatalog({ status: 'ready', assets }),
      () => {
        if (!controller.signal.aborted) setCatalog({ status: 'error' });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  return { catalog, retry: useCallback(() => setAttempt((count) => count + 1), []) };
}
