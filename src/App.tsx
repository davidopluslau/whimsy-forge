import { lazy, Suspense } from 'react';

const ChairPage = lazy(() => import('./viewer/ChairPage'));
const DesignListPage = lazy(() => import('./editor/DesignListPage'));
const EditorRoute = lazy(() => import('./editor/EditorRoute'));

export function App() {
  const { pathname } = window.location;
  const target = /^\/editor\/(.+?)\/?$/.exec(pathname)?.[1];
  return (
    <Suspense fallback={null}>
      {target ? <EditorRoute target={target} /> : /^\/editor\/?$/.test(pathname) ? <DesignListPage /> : <ChairPage />}
    </Suspense>
  );
}
