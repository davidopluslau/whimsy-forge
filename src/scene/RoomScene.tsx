import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { BufferAttribute, BufferGeometry, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3, type Texture } from 'three';
import type { Room } from '../model/design';
import { materialById, type MaterialAsset } from '../model/materials';
import { buildRoomGeometry, floorUvs, type RoomGeometry } from './roomGeometry';

const FOV = 40;
/** High enough to see the floor over the near walls. */
const INITIAL_CAMERA_POSITION: [number, number, number] = [4, 10, 6];
const MIN_FRAMED_RADIUS = 2;
const WALL_COLOR = '#ece6da';
const FLOOR_COLOR = '#b08d66';
const BACKGROUND_COLOR = '#d9d4ca';

const MAX_ANISOTROPY = 8;

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

/** The 3D view of a room. Everything here is derived from the Design's room. */
export function RoomScene({ room }: { room: Room }) {
  const geometry = useMemo(() => buildRoomGeometry(room), [room]);
  const floorTexCoords = useMemo(() => (geometry.floor ? floorUvs(geometry.floor) : null), [geometry.floor]);

  return (
    <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: INITIAL_CAMERA_POSITION, fov: FOV }}>
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
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.02} />
      <FrameRoom bounds={geometry.bounds} wallHeight={room.wallHeight} />
    </Canvas>
  );
}
