import { lazy, Suspense } from 'react';

const ChairPage = lazy(() => import('./viewer/ChairPage'));
const DesignListPage = lazy(() => import('./editor/DesignListPage'));
const EditorRoute = lazy(() => import('./editor/EditorRoute'));
const SnapshotPage = lazy(() => import('./viewer/SnapshotPage'));

function page(pathname: string) {
  const snapshot = /^\/v\/(.+?)\/?$/.exec(pathname)?.[1];
  if (snapshot) return <SnapshotPage target={snapshot} />;
  const target = /^\/editor\/(.+?)\/?$/.exec(pathname)?.[1];
  if (target) return <EditorRoute target={target} />;
  return /^\/editor\/?$/.test(pathname) ? <DesignListPage /> : <ChairPage />;
}

export function App() {
  return <Suspense fallback={null}>{page(window.location.pathname)}</Suspense>;
}
