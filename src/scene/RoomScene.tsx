import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { type MutableRefObject, useEffect, useMemo, useState } from 'react';
import { BufferAttribute, BufferGeometry, Plane, Raycaster, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector2, Vector3, type Texture } from 'three';
import type { Item, Room, Vec2 } from '../model/design';
import { materialById, type MaterialAsset } from '../model/materials';
import type { CatalogAsset } from '../model/catalog';
import { itemImage } from '../model/items';
import { buildRoomGeometry, floorUvs, type RoomGeometry } from './roomGeometry';
import { ItemGizmo, type GizmoMode, type GizmoPatch } from './ItemGizmo';
import { ItemMesh } from './ItemMesh';

const FOV = 40;
/** High enough to see the floor over the near walls. */
const INITIAL_CAMERA_POSITION: [number, number, number] = [4, 10, 6];
const MIN_FRAMED_RADIUS = 2;
const WALL_COLOR = '#ece6da';
const FLOOR_COLOR = '#b08d66';
const BACKGROUND_COLOR = '#d9d4ca';

const MAX_ANISOTROPY = Number((import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_MAX_ANISOTROPY ?? 8);

type MaterialMaps = { map: Texture; normalMap: Texture; roughnessMap: Texture };

/** One set of textures per material, shared by every surface using it and kept for the session. */
const loadedMaps = new Map<string, Promise<MaterialMaps>>();

function loadMaps(material: MaterialAsset): Promise<MaterialMaps> {
  let maps = loadedMaps.get(material.id);
  if (!maps) {
    const loader = new TextureLoader();
    const load = async (url: string) => {
      const texture = await loader.loadAsync(`/api/${url}`);
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.anisotropy = MAX_ANISOTROPY;
      // Texture coordinates are in meters.
      texture.repeat.set(1 / material.dimensions[0], 1 / material.dimensions[1]);
      return texture;
    };
    maps = Promise.all([load(material.url), load(material.normalUrl), load(material.roughnessUrl)]).then(([map, normalMap, roughnessMap]) => {
      map.colorSpace = SRGBColorSpace;
      return { map, normalMap, roughnessMap };
    });
    loadedMaps.set(material.id, maps);
  }
  return maps;
}

/** The material's textures once loaded. Until then, or if they fail, the surface shows the material's plain color. */
function useMaterialMaps(material: MaterialAsset | undefined): MaterialMaps | null {
  const invalidate = useThree((state) => state.invalidate);
  const [loaded, setLoaded] = useState<{ id: string; maps: MaterialMaps } | null>(null);

  useEffect(() => {
    if (!material) return;
    let current = true;
    loadMaps(material).then(
      (maps) => {
        if (current) setLoaded({ id: material.id, maps });
      },
      (error: unknown) => console.warn(`Could not load material ${material.id}`, error),
    );
    return () => {
      current = false;
    };
  }, [material]);

  const maps = material && loaded?.id === material.id ? loaded.maps : null;
  useEffect(() => invalidate(), [maps, invalidate]);
  return maps;
}

type SurfaceProps = { positions: Float32Array; uvs: Float32Array; materialId: string | undefined; plainColor: string };

function Surface({ positions, uvs, materialId, plainColor }: SurfaceProps) {
  const geometry = useMemo(() => {
    const result = new BufferGeometry();
    result.setAttribute('position', new BufferAttribute(positions, 3));
    result.setAttribute('uv', new BufferAttribute(uvs, 2));
    result.computeVertexNormals();
    return result;
  }, [positions, uvs]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = materialById(materialId);
  const maps = useMaterialMaps(material);

  return (
    <mesh geometry={geometry}>
      {/* Keyed: gaining or losing texture maps needs a new shader, which an in-place prop change would not trigger. */}
      {maps ? (
        <meshStandardMaterial key={material!.id} {...maps} roughness={1} />
      ) : (
        <meshStandardMaterial key="plain" color={material?.color ?? plainColor} roughness={0.85} />
      )}
    </mesh>
  );
}

type Controls = { target: Vector3; update: () => void };

/** Keeps the room framed as it grows, from whatever angle the user has orbited to. */
function FrameRoom({ bounds, wallHeight }: { bounds: RoomGeometry['bounds']; wallHeight: number }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as unknown as Controls | null;
  const invalidate = useThree((state) => state.invalidate);
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);
  const radius = Math.hypot(Math.max(bounds?.radius ?? 0, MIN_FRAMED_RADIUS), wallHeight / 2);
  const centerX = bounds?.center[0] ?? 0;
  const centerY = bounds?.center[1] ?? 0;

  useEffect(() => {
    // The pane has no size while it is hidden.
    if (!controls || width === 0 || height === 0) return;
    const tanVertical = Math.tan(((FOV / 2) * Math.PI) / 180);
    const halfAngle = Math.min(Math.atan(tanVertical), Math.atan(tanVertical * (width / height)));
    const direction = camera.position.clone().sub(controls.target).normalize();
    controls.target.set(centerX, wallHeight / 2, centerY);
    camera.position.copy(controls.target).addScaledVector(direction, radius / Math.sin(halfAngle));
    controls.update();
    invalidate();
  }, [camera, controls, invalidate, radius, centerX, centerY, wallHeight, width, height]);

  return null;
}

/** Converts a screen position to a point on the floor, for dropping things where the user points. */
export type FloorPicker = (clientX: number, clientY: number) => Vec2 | null;

/** Hands the parent a way to turn screen positions into floor points, once the canvas exists. */
function FloorPickerHandle({ target }: { target: MutableRefObject<FloorPicker | null> }) {
  const camera = useThree((state) => state.camera);
  const domElement = useThree((state) => state.gl.domElement);
  useEffect(() => {
    const raycaster = new Raycaster();
    const ground = new Plane(new Vector3(0, 1, 0), 0);
    const hit = new Vector3();
    target.current = (clientX, clientY) => {
      const rect = domElement.getBoundingClientRect();
      raycaster.setFromCamera(new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), camera);
      return raycaster.ray.intersectPlane(ground, hit) ? [hit.x, hit.z] : null;
    };
    return () => {
      target.current = null;
    };
  }, [camera, domElement, target]);
  return null;
}

/** What the editor adds to the scene: selection, gizmos, and the edits they make. */
export type SceneEditing = {
  selectedId: string | null;
  gizmo: GizmoMode;
  onSelect: (id: string | null) => void;
  onItemChange: (id: string, patch: GizmoPatch) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
  pickFloor: MutableRefObject<FloorPicker | null>;
};

type RoomSceneProps = {
  room: Room;
  /** Placed items, with `catalog` to look up their images. Omit both for a room with no furniture. */
  items?: Item[];
  catalog?: ReadonlyMap<string, CatalogAsset>;
  /** Ids of floor items that overlap another. */
  overlapping?: ReadonlySet<string>;
  /** Present only in the editor; the read-only viewer leaves it out. */
  editing?: SceneEditing;
};

/** The 3D view of a room. Everything here is derived from the Design's room and items. */
export function RoomScene({ room, items = [], catalog = new Map(), overlapping = new Set(), editing }: RoomSceneProps) {
  const geometry = useMemo(() => buildRoomGeometry(room), [room]);
  const floorTexCoords = useMemo(() => (geometry.floor ? floorUvs(geometry.floor) : null), [geometry.floor]);
  const selected = editing ? (items.find((item) => item.id === editing.selectedId) ?? null) : null;

  return (
    <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: INITIAL_CAMERA_POSITION, fov: FOV }} onPointerMissed={editing ? () => editing.onSelect(null) : undefined}>
      <color attach="background" args={[BACKGROUND_COLOR]} />
      <Environment resolution={64} frames={1}>
        <Lightformer intensity={2.5} position={[0, 4, 0]} rotation={[Math.PI / 2, 0, 0]} scale={8} />
        <Lightformer intensity={1.5} position={[4, 2, 3]} rotation={[0, -Math.PI / 3, 0]} scale={4} />
        <Lightformer intensity={0.8} position={[-4, 1.5, -2]} rotation={[0, Math.PI / 2, 0]} scale={4} />
      </Environment>
      <directionalLight position={[3, 6, 2]} intensity={1.2} />
      {geometry.walls.map((wall, index) => (
        <Surface key={wall.wallId} positions={wall.positions} uvs={wall.uvs} materialId={room.walls[index]!.materialId} plainColor={WALL_COLOR} />
      ))}
      {geometry.floor && floorTexCoords && <Surface positions={geometry.floor} uvs={floorTexCoords} materialId={room.floorMaterialId} plainColor={FLOOR_COLOR} />}
      {items.map((item) => (
        <ItemMesh
          key={item.id}
          item={item}
          image={itemImage(item, catalog)}
          overlapping={overlapping.has(item.id)}
          onSelect={editing ? (id) => editing.onSelect(id) : undefined}
        />
      ))}
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.02} />
      <FrameRoom bounds={geometry.bounds} wallHeight={room.wallHeight} />
      {editing && (
        <>
          <ItemGizmo item={selected} mode={editing.gizmo} room={room} onChange={editing.onItemChange} onStart={editing.onGestureStart} onEnd={editing.onGestureEnd} />
          <FloorPickerHandle target={editing.pickFloor} />
        </>
      )}
    </Canvas>
  );
}
