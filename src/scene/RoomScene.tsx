import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { type MutableRefObject, useEffect, useMemo, useRef, useState } from 'react';
import { BufferAttribute, BufferGeometry, NeutralToneMapping, Plane, Raycaster, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector2, Vector3, type Texture } from 'three';
import type { Item, Room, Vec2 } from '../model/design';
import { materialById, type MaterialAsset } from '../model/materials';
import type { CatalogAsset } from '../model/catalog';
import { itemImage, lampLights } from '../model/items';
import { buildRoomGeometry, floorUvs, type RoomGeometry } from './roomGeometry';
import { CAPTURE_HIDDEN, renderToCanvas, type SceneCapture } from './capture';
import { type CameraView, FOV, framedView, OVERVIEW_POSITION } from './cameraViews';
import { ItemGizmo, type GizmoMode, type GizmoPatch } from './ItemGizmo';
import { ItemMesh } from './ItemMesh';
import { LampLights, SceneEnvironment, Sun, useShadowRefresh } from './lighting';
import { FrameWatcher, StatsProbe, type SceneStats } from './performance';
import { HIGH_QUALITY, type QualityTier } from './quality';

const WALL_COLOR = '#ece6da';
const FLOOR_COLOR = '#b08d66';
const BACKGROUND_COLOR = '#d9d4ca';
const WHITE = [1, 1, 1] as const;

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

type SurfaceProps = { positions: Float32Array; uvs: Float32Array; materialId: string | undefined; plainColor: string; castShadow: boolean };

function Surface({ positions, uvs, materialId, plainColor, castShadow }: SurfaceProps) {
  const geometry = useMemo(() => {
    const result = new BufferGeometry();
    result.setAttribute('position', new BufferAttribute(positions, 3));
    result.setAttribute('uv', new BufferAttribute(uvs, 2));
    result.computeVertexNormals();
    return result;
  }, [positions, uvs]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useShadowRefresh([geometry]);

  const material = materialById(materialId);
  const maps = useMaterialMaps(material);

  return (
    <mesh geometry={geometry} castShadow={castShadow} receiveShadow>
      {/* Keyed: gaining or losing texture maps needs a new shader, which an in-place prop change would not trigger. */}
      {maps ? (
        <meshStandardMaterial key={material!.id} {...maps} roughness={material!.roughness ?? 1} color={material!.tint ?? WHITE} />
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
  const radius = bounds?.radius ?? 0;
  const centerX = bounds?.center[0] ?? 0;
  const centerY = bounds?.center[1] ?? 0;

  useEffect(() => {
    // The pane has no size while it is hidden.
    if (!controls || width === 0 || height === 0) return;
    const direction = camera.position.clone().sub(controls.target).normalize();
    const framed = framedView({ center: [centerX, centerY], radius }, wallHeight, width / height, [direction.x, direction.y, direction.z]);
    controls.target.set(...framed.target);
    camera.position.set(...framed.position);
    controls.update();
    invalidate();
  }, [camera, controls, invalidate, radius, centerX, centerY, wallHeight, width, height]);

  return null;
}

/** A view for the camera to go to. Passing a new object goes there again, even if the view is the same. */
export type ViewRequest = { view: (aspect: number) => CameraView };

/** Takes the camera to the requested view, instead of `FrameRoom`, and again if the canvas changes shape. */
function ApplyView({ request }: { request: ViewRequest }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as unknown as Controls | null;
  const invalidate = useThree((state) => state.invalidate);
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);

  useEffect(() => {
    if (!controls || width === 0 || height === 0) return;
    const { position, target } = request.view(width / height);
    controls.target.set(...target);
    camera.position.set(...position);
    controls.update();
    invalidate();
  }, [camera, controls, invalidate, request, width, height]);

  return null;
}

/** Hands the parent a way to save pictures of the scene, once the canvas exists. */
function CaptureHandle({ target, bounds, wallHeight }: { target: MutableRefObject<SceneCapture | null>; bounds: RoomGeometry['bounds']; wallHeight: number }) {
  const get = useThree((state) => state.get);
  // Read when a picture is taken, so the handle always frames the room as it is then.
  const room = useRef({ bounds, wallHeight });
  room.current = { bounds, wallHeight };

  useEffect(() => {
    const paneSize = () => {
      const { gl } = get();
      return gl.domElement.clientWidth > 0 && gl.domElement.clientHeight > 0 ? { width: gl.domElement.width, height: gl.domElement.height } : null;
    };
    const currentView = (): CameraView | null => {
      const { camera, controls } = get();
      if (!paneSize() || !controls) return null;
      const { x, y, z } = (controls as unknown as Controls).target;
      return { position: [camera.position.x, camera.position.y, camera.position.z], target: [x, y, z] };
    };
    target.current = {
      paneSize,
      currentView,
      render: (width, height) => {
        const { gl, scene, camera } = get();
        const view = currentView() ?? framedView(room.current.bounds, room.current.wallHeight, width / height, OVERVIEW_POSITION);
        return renderToCanvas(gl, scene, camera, { width, height, view });
      },
    };
    return () => {
      target.current = null;
    };
  }, [get, target]);
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
  /** Where the camera should be. Without it, the camera keeps the room framed as it changes. */
  viewRequest?: ViewRequest;
  /** Called when the user starts moving the camera themselves. */
  onOrbitStart?: () => void;
  /** Filled in with a way to save pictures of the scene, once it exists. */
  capture?: MutableRefObject<SceneCapture | null>;
  /** How much to spend on looks. The editor is on a desktop and stays at the top. */
  quality?: QualityTier;
  /** Called when frames stay too slow while the scene moves. Leave it out to keep the quality as it is. */
  onSlowFrames?: () => void;
  /** Draws all the time and reports the cost of each frame, for measuring. Normally the scene only draws on change. */
  onStats?: (stats: SceneStats) => void;
  /** Says what the scene shows, for anyone who can't see it. */
  label?: string;
};

const NO_ASSETS: ReadonlyMap<string, CatalogAsset> = new Map();
const NOTHING_OVERLAPPING: ReadonlySet<string> = new Set();

/** The 3D view of a room. Everything here is derived from the Design's room and items. */
export function RoomScene({
  room,
  items = [],
  catalog = NO_ASSETS,
  overlapping = NOTHING_OVERLAPPING,
  editing,
  viewRequest,
  onOrbitStart,
  capture,
  quality = HIGH_QUALITY,
  onSlowFrames,
  onStats,
  label,
}: RoomSceneProps) {
  const geometry = useMemo(() => buildRoomGeometry(room), [room]);
  const floorTexCoords = useMemo(() => (geometry.floor ? floorUvs(geometry.floor) : null), [geometry.floor]);
  const selected = editing ? (items.find((item) => item.id === editing.selectedId) ?? null) : null;
  const lights = useMemo(() => lampLights(items, catalog, quality.maxLamps), [items, catalog, quality.maxLamps]);
  // A view that keeps gliding after the pointer lets go isn't for everyone.
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  return (
    <Canvas
      frameloop={onStats ? 'always' : 'demand'}
      dpr={[1, quality.maxDpr]}
      shadows="percentage"
      // Keeps a material's color, where the default filmic curve turns white plaster grey.
      gl={{ toneMapping: NeutralToneMapping }}
      camera={{ position: OVERVIEW_POSITION, fov: FOV }}
      onPointerMissed={editing ? () => editing.onSelect(null) : undefined}
      onCreated={({ gl }) => {
        // Shadows are drawn when something changes (see `useShadowRefresh`), not on every frame.
        gl.shadowMap.autoUpdate = false;
        gl.shadowMap.needsUpdate = true;
      }}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <color attach="background" args={[BACKGROUND_COLOR]} />
      <SceneEnvironment />
      <Sun bounds={geometry.bounds} wallHeight={room.wallHeight} shadowMapSize={quality.shadowMapSize} shadowRadius={quality.shadowRadius} />
      <LampLights lights={lights} />
      {geometry.walls.map((wall, index) => (
        <Surface key={wall.wallId} positions={wall.positions} uvs={wall.uvs} materialId={room.walls[index]!.materialId} plainColor={WALL_COLOR} castShadow />
      ))}
      {geometry.floor && floorTexCoords && <Surface positions={geometry.floor} uvs={floorTexCoords} materialId={room.floorMaterialId} plainColor={FLOOR_COLOR} castShadow={false} />}
      {items.map((item) => (
        <ItemMesh
          key={item.id}
          item={item}
          image={itemImage(item, catalog)}
          overlapping={overlapping.has(item.id)}
          maxModelTexture={quality.maxModelTexture}
          onSelect={editing ? (id) => editing.onSelect(id) : undefined}
        />
      ))}
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.02} enableDamping={!reducedMotion} onStart={onOrbitStart} />
      {viewRequest ? <ApplyView request={viewRequest} /> : <FrameRoom bounds={geometry.bounds} wallHeight={room.wallHeight} />}
      {capture && <CaptureHandle target={capture} bounds={geometry.bounds} wallHeight={room.wallHeight} />}
      {onSlowFrames && <FrameWatcher tierName={quality.name} onSlow={onSlowFrames} />}
      {onStats && <StatsProbe onStats={onStats} />}
      {editing && (
        <>
          <group userData={CAPTURE_HIDDEN}>
            <ItemGizmo item={selected} mode={editing.gizmo} room={room} onChange={editing.onItemChange} onStart={editing.onGestureStart} onEnd={editing.onGestureEnd} />
          </group>
          <FloorPickerHandle target={editing.pickFloor} />
        </>
      )}
    </Canvas>
  );
}
