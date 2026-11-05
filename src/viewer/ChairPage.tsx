import { Component, useCallback, useRef, useState, type ReactNode } from 'react';
import { ChairScene } from '../scene/ChairScene';

type SceneState = 'loading' | 'ready' | 'error';

class SceneErrorBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch() {
    this.props.onError();
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function ChairPage() {
  const [sceneState, setSceneState] = useState<SceneState>('loading');
  const rootRef = useRef<HTMLElement>(null);

  const handleReady = useCallback(() => setSceneState('ready'), []);
  const handleError = useCallback(() => setSceneState('error'), []);
  // Written straight to the DOM: this fires every orbit frame and needs no re-render.
  const handleOrbit = useCallback((azimuth: number, polar: number) => {
    rootRef.current?.setAttribute('data-camera', `${azimuth.toFixed(4)},${polar.toFixed(4)}`);
  }, []);

  return (
    <main ref={rootRef} className="chair-page" data-testid="chair-page" data-scene-state={sceneState}>
      <SceneErrorBoundary onError={handleError}>
        <ChairScene onReady={handleReady} onOrbit={handleOrbit} />
      </SceneErrorBoundary>
      <h1 className="chair-page__title">Whimsy Forge</h1>
      {sceneState === 'loading' && <p className="chair-page__message">Loading chair…</p>}
      {sceneState === 'error' && <p className="chair-page__message">The chair could not be loaded.</p>}
      <p className="chair-page__credit">
        Painted Wooden Chair 01 from{' '}
        <a href="https://polyhaven.com/a/painted_wooden_chair_01" rel="noreferrer">
          Poly Haven
        </a>{' '}
        (CC0). Drag to orbit.
      </p>
    </main>
  );
}
