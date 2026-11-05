import { Environment, Lightformer } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { AdditiveBlending, CanvasTexture, EquirectangularReflectionMapping, Object3D, SRGBColorSpace, type DataTexture } from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { ENVIRONMENT } from '../model/environment';
import type { PlacedLight } from '../model/items';
import type { RoomGeometry } from './roomGeometry';

/** How bright the HDRI is, and how strong the sun, in the balance that makes interiors read well. */
const ENVIRONMENT_INTENSITY = 0.7;
const SUN_INTENSITY = 1.6;
const SUN_COLOR = '#fff1dc';
/**
 * Toward the sun from the room's center. High, so walls without a ceiling don't darken the whole floor, and
 * off to the side of the opening view, so that shadows fall where they can be seen.
 */
const SUN_DIRECTION = [0.5, 1, 0.35] as const;
/** Light bouncing back from the sun's side lifts the walls it can't reach. It casts no shadow, so it costs little. */
const FILL_INTENSITY = 0.45;
const FILL_COLOR = '#ffe9d2';
const FILL_DIRECTION = [-0.6, 0.5, -0.45] as const;
/** The room used to size the shadow before there are walls. */
const DEFAULT_RADIUS = 5;
const GLOW_SIZE = 0.55;
const GLOW_OPACITY = 0.55;

/**
 * Asks for the shadow map to be drawn again when `deps` change, and when the caller goes away. The sun never
 * moves, so nothing else can change a shadow. Orbiting leaves the map alone, which saves a phone a second
 * pass over the whole scene on every frame.
 */
export function useShadowRefresh(deps: readonly unknown[]) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const refresh = () => {
      gl.shadowMap.needsUpdate = true;
      invalidate();
    };
    refresh();
    return refresh;
  }, [gl, invalidate, ...deps]);
}

/** Light drawn in the browser, with nothing to fetch. */
function BuiltInEnvironment() {
  return (
    <Environment resolution={64} frames={1} environmentIntensity={ENVIRONMENT_INTENSITY}>
      <Lightformer intensity={2.5} position={[0, 4, 0]} rotation={[Math.PI / 2, 0, 0]} scale={8} />
      <Lightformer intensity={1.5} position={[4, 2, 3]} rotation={[0, -Math.PI / 3, 0]} scale={4} />
      <Lightformer intensity={0.8} position={[-4, 1.5, -2]} rotation={[0, Math.PI / 2, 0]} scale={4} />
    </Environment>
  );
}

/** The HDRI, fetched once and kept for the session, as material textures are. */
let hdri: Promise<DataTexture> | undefined;

function loadHdri(url: string): Promise<DataTexture> {
  hdri ??= new HDRLoader().loadAsync(url).then((texture) => {
    texture.mapping = EquirectangularReflectionMapping;
    return texture;
  });
  return hdri;
}

/**
 * The self-hosted HDRI that lights the scene and shows in reflections. It isn't drawn as a backdrop. The
 * scene doesn't wait for it: built-in light stands in until it arrives, and for good if it never does.
 */
export function SceneEnvironment() {
  const invalidate = useThree((state) => state.invalidate);
  const [map, setMap] = useState<DataTexture | null>(null);

  useEffect(() => {
    if (!ENVIRONMENT) return;
    let current = true;
    loadHdri(`/api/${ENVIRONMENT.url}`).then(
      (texture) => {
        if (current) setMap(texture);
      },
      (error: unknown) => console.warn('Could not load the environment, so using the built-in light', error),
    );
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => invalidate(), [map, invalidate]);

  return map ? <Environment map={map} environmentIntensity={ENVIRONMENT_INTENSITY} /> : <BuiltInEnvironment />;
}

type SunProps = { bounds: RoomGeometry['bounds']; wallHeight: number; shadowMapSize: number; shadowRadius: number };

/** The one light that casts shadows. Its shadow covers the room and whatever stands just outside it. */
export function Sun({ bounds, wallHeight, shadowMapSize, shadowRadius }: SunProps) {
  const target = useMemo(() => new Object3D(), []);
  const radius = Math.max(bounds?.radius ?? DEFAULT_RADIUS, wallHeight);
  const [centerX, centerZ] = bounds?.center ?? [0, 0];
  const reach = radius * 3;
  const length = Math.hypot(...SUN_DIRECTION);
  const position: [number, number, number] = [
    centerX + (SUN_DIRECTION[0] / length) * reach,
    (SUN_DIRECTION[1] / length) * reach,
    centerZ + (SUN_DIRECTION[2] / length) * reach,
  ];
  const span = radius * 1.25;
  const castShadow = shadowMapSize > 0;

  useEffect(() => {
    target.position.set(centerX, 0, centerZ);
    target.updateMatrixWorld();
  }, [target, centerX, centerZ]);
  useShadowRefresh([centerX, centerZ, radius, shadowMapSize, shadowRadius, target]);

  return (
    <>
      <primitive object={target} />
      <directionalLight position={FILL_DIRECTION} color={FILL_COLOR} intensity={FILL_INTENSITY} />
      <directionalLight
        // A different map size needs a new shadow map, and only a new light gets one.
        key={shadowMapSize}
        position={position}
        target={target}
        color={SUN_COLOR}
        intensity={SUN_INTENSITY}
        castShadow={castShadow}
        shadow-mapSize={[shadowMapSize || 1, shadowMapSize || 1]}
        shadow-radius={shadowRadius}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      >
        <orthographicCamera attach="shadow-camera" args={[-span, span, span, -span, 0.1, reach * 2.5]} />
      </directionalLight>
    </>
  );
}

/** A soft round glow, drawn once. A sprite with it costs a phone almost nothing. */
function makeGlowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * What the room's lamps give. Point lights without shadows: a shadow for one would mean six more passes over
 * the scene, so their light passes through walls and furniture, within a short distance.
 */
export function LampLights({ lights }: { lights: readonly PlacedLight[] }) {
  const invalidate = useThree((state) => state.invalidate);
  const glow = useMemo(makeGlowTexture, []);
  useEffect(() => () => glow.dispose(), [glow]);
  useEffect(() => invalidate(), [lights, invalidate]);

  return (
    <>
      {lights.map((light) => (
        <group key={light.itemId} position={light.position}>
          <pointLight color={light.color} intensity={light.intensity} distance={light.distance} decay={2} />
          <sprite scale={[GLOW_SIZE, GLOW_SIZE, 1]}>
            <spriteMaterial map={glow} color={light.color} opacity={GLOW_OPACITY} blending={AdditiveBlending} depthWrite={false} transparent toneMapped={false} />
          </sprite>
        </group>
      ))}
    </>
  );
}
