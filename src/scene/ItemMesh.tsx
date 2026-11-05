import { useGLTF, useTexture } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { Component, type ReactNode, Suspense, useEffect, useMemo } from 'react';
import { SRGBColorSpace } from 'three';
import type { Item, Vec3 } from '../model/design';
import type { ItemImage } from '../model/items';
import { CAPTURE_HIDDEN } from './capture';
import { useShadowRefresh } from './lighting';
import { fitModelToBudget } from './textureBudget';

const PLACEHOLDER_COLOR = '#c9c2b4';
const FRAME_COLOR = '#3b3026';
const RUG_BACKING_COLOR = '#8a6f5a';
const OVERLAP_COLOR = '#c0392b';

/** Until an item's image arrives, or if it never does, a box of its real size stands in for it. */
function Placeholder({ size }: { size: Vec3 }) {
  return (
    <mesh position={[0, size[1] / 2, 0]}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={PLACEHOLDER_COLOR} transparent opacity={0.6} />
    </mesh>
  );
}

function ModelItem({ path, maxTexture }: { path: string; maxTexture: number }) {
  const { scene } = useGLTF(`/api/${path}`);
  // useGLTF caches per URL, and one object can only have one parent.
  const model = useMemo(() => {
    const clone = scene.clone();
    fitModelToBudget(clone, maxTexture);
    clone.traverse((object) => {
      object.castShadow = true;
      object.receiveShadow = true;
    });
    return clone;
  }, [scene, maxTexture]);
  // A model that has just arrived replaces its placeholder, which casts no shadow.
  useShadowRefresh([model]);
  return <primitive object={model} />;
}

/** A picture: a thin frame with its image on the face toward +z. */
function Picture({ path, size }: { path: string; size: Vec3 }) {
  const texture = useTexture(`/api/${path}`, (loaded) => {
    loaded.colorSpace = SRGBColorSpace;
  });
  const [width, height, depth] = size;
  return (
    <>
      <mesh position={[0, height / 2, 0]} castShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.6} />
      </mesh>
      <mesh position={[0, height / 2, depth / 2 + 0.002]} receiveShadow>
        <planeGeometry args={[width * 0.92, height * 0.92]} />
        <meshStandardMaterial map={texture} roughness={0.8} />
      </mesh>
    </>
  );
}

/** A rug: a flat slab with its image on top. */
function Rug({ path, size }: { path: string; size: Vec3 }) {
  const texture = useTexture(`/api/${path}`, (loaded) => {
    loaded.colorSpace = SRGBColorSpace;
  });
  const [width, thickness, length] = size;
  return (
    <>
      <mesh position={[0, thickness / 2, 0]}>
        <boxGeometry args={[width, thickness, length]} />
        <meshStandardMaterial color={RUG_BACKING_COLOR} roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, thickness + 0.002, 0]} receiveShadow>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial map={texture} roughness={1} />
      </mesh>
    </>
  );
}

class ItemBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.warn('Could not show an item', error);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

type ItemMeshProps = {
  item: Item;
  image: ItemImage | null;
  overlapping: boolean;
  /** The longest side a model's textures may have. */
  maxModelTexture: number;
  onSelect?: (id: string) => void;
};

/**
 * One placed item, at its position and turn. The group is named by the item's id, so the gizmo can find it.
 * Its origin is the bottom center, and its front faces +z.
 */
export function ItemMesh({ item, image, overlapping, maxModelTexture, onSelect }: ItemMeshProps) {
  const invalidate = useThree((state) => state.invalidate);
  // `image` is a new object on every render, so its fields are the dependencies.
  useEffect(() => invalidate(), [item, image?.kind, image?.path, overlapping, invalidate]);
  // Also runs when the item goes away, so that its shadow goes too.
  useShadowRefresh([item.position, item.rotationY, item.size, image?.path]);

  const content = image === null ? <Placeholder size={item.size} /> : image.kind === 'model' ? <ModelItem path={image.path} maxTexture={maxModelTexture} /> : image.kind === 'picture' ? <Picture path={image.path} size={item.size} /> : <Rug path={image.path} size={item.size} />;

  return (
    <group
      name={item.id}
      position={item.position}
      rotation={[0, item.rotationY, 0]}
      onClick={
        onSelect
          ? (event) => {
              event.stopPropagation();
              onSelect(item.id);
            }
          : undefined
      }
    >
      <ItemBoundary fallback={<Placeholder size={item.size} />}>
        <Suspense fallback={<Placeholder size={item.size} />}>{content}</Suspense>
      </ItemBoundary>
      {overlapping && item.mount === 'floor' && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} userData={CAPTURE_HIDDEN}>
          <planeGeometry args={[item.size[0], item.size[2]]} />
          <meshBasicMaterial color={OVERLAP_COLOR} transparent opacity={0.45} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
