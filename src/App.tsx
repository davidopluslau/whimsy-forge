import { lazy, Suspense } from 'react';

const ChairPage = lazy(() => import('./viewer/ChairPage'));
const EditorPage = lazy(() => import('./editor/EditorPage'));

export function App() {
  const isEditor = /^\/editor(\/|$)/.test(window.location.pathname);
  return <Suspense fallback={null}>{isEditor ? <EditorPage /> : <ChairPage />}</Suspense>;
}
