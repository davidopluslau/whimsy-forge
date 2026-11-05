import { ContactShadows, Environment, Lightformer, OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, useEffect } from 'react';

export const CHAIR_URL = '/api/assets/painted-wooden-chair-01/model.glb';

function Chair({ onReady }: { onReady: () => void }) {
  const { scene } = useGLTF(CHAIR_URL);
  useEffect(onReady, [onReady]);
  return <primitive object={scene} />;
}

type ChairSceneProps = {
  onReady: () => void;
  onOrbit: (azimuth: number, polar: number) => void;
};

/** Uses local lightformers rather than a fetched HDRI so the scene has no third-party requests. */
export function ChairScene({ onReady, onOrbit }: ChairSceneProps) {
  return (
    <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [1.3, 1.05, 1.7], fov: 40 }}>
      <Environment resolution={128} frames={1}>
        <Lightformer intensity={3} position={[0, 3, 0]} rotation={[Math.PI / 2, 0, 0]} scale={6} />
        <Lightformer intensity={2} position={[3, 1.5, 2]} rotation={[0, -Math.PI / 3, 0]} scale={3} />
        <Lightformer intensity={1} position={[-3, 1, -1]} rotation={[0, Math.PI / 2, 0]} scale={3} />
      </Environment>
      <Suspense fallback={null}>
        <Chair onReady={onReady} />
        {/* frames={1} captures once, so this has to mount after the chair has loaded. */}
        <ContactShadows frames={1} resolution={512} scale={3} blur={2} far={1.2} opacity={0.5} />
      </Suspense>
      <OrbitControls
        makeDefault
        target={[0, 0.48, 0]}
        enablePan={false}
        minDistance={0.8}
        maxDistance={5}
        maxPolarAngle={Math.PI / 2 - 0.02}
        onChange={(event) => {
          if (event) onOrbit(event.target.getAzimuthalAngle(), event.target.getPolarAngle());
        }}
      />
    </Canvas>
  );
}
