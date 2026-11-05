import { Bounds, Environment, Lightformer, OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Component, type ReactNode, Suspense, useEffect, useMemo } from 'react';
import { Box3, Vector3 } from 'three';

type MeasuredModelProps = {
  url: string;
  onMeasured: (size: [number, number, number]) => void;
};

function MeasuredModel({ url, onMeasured }: MeasuredModelProps) {
  const { scene } = useGLTF(url);
  // useGLTF caches per URL, and one object can only have one parent.
  const model = useMemo(() => scene.clone(), [scene]);

  useEffect(() => {
    const size = new Box3().setFromObject(model).getSize(new Vector3());
    onMeasured([size.x, size.y, size.z]);
  }, [model, onMeasured]);

  return (
    <Bounds fit clip observe margin={1.3}>
      <primitive object={model} />
    </Bounds>
  );
}

class PreviewErrorBoundary extends Component<{ onError: () => void; children: ReactNode }> {
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

type AssetPreviewProps = MeasuredModelProps & {
  onError: () => void;
};

/** One model on a 1 m grid, at the size its file really has. */
export function AssetPreview({ url, onMeasured, onError }: AssetPreviewProps) {
  return (
    <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [2, 1.5, 3], fov: 35 }}>
      <Environment resolution={128} frames={1}>
        <Lightformer intensity={3} position={[0, 3, 0]} rotation={[Math.PI / 2, 0, 0]} scale={6} />
        <Lightformer intensity={2} position={[3, 1.5, 2]} rotation={[0, -Math.PI / 3, 0]} scale={3} />
        <Lightformer intensity={1} position={[-3, 1, -1]} rotation={[0, Math.PI / 2, 0]} scale={3} />
      </Environment>
      <gridHelper args={[10, 10, '#8c8579', '#8c8579']} />
      <PreviewErrorBoundary key={url} onError={onError}>
        <Suspense fallback={null}>
          <MeasuredModel url={url} onMeasured={onMeasured} />
        </Suspense>
      </PreviewErrorBoundary>
      <OrbitControls makeDefault enablePan={false} maxPolarAngle={Math.PI / 2 - 0.02} />
    </Canvas>
  );
}
