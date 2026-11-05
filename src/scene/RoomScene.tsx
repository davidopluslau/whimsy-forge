import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import type { Room } from '../model/design';
import { buildRoomGeometry, type RoomGeometry } from './roomGeometry';

const FOV = 40;
/** High enough to see the floor over the near walls. */
const INITIAL_CAMERA_POSITION: [number, number, number] = [4, 10, 6];
const MIN_FRAMED_RADIUS = 2;
const WALL_COLOR = '#ece6da';
const FLOOR_COLOR = '#b08d66';
const BACKGROUND_COLOR = '#d9d4ca';

function Surface({ positions, color }: { positions: Float32Array; color: string }) {
  const geometry = useMemo(() => {
    const result = new BufferGeometry();
    result.setAttribute('position', new BufferAttribute(positions, 3));
    result.computeVertexNormals();
    return result;
  }, [positions]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={color} roughness={0.85} />
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

  return (
    <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: INITIAL_CAMERA_POSITION, fov: FOV }}>
      <color attach="background" args={[BACKGROUND_COLOR]} />
      <Environment resolution={64} frames={1}>
        <Lightformer intensity={2.5} position={[0, 4, 0]} rotation={[Math.PI / 2, 0, 0]} scale={8} />
        <Lightformer intensity={1.5} position={[4, 2, 3]} rotation={[0, -Math.PI / 3, 0]} scale={4} />
        <Lightformer intensity={0.8} position={[-4, 1.5, -2]} rotation={[0, Math.PI / 2, 0]} scale={4} />
      </Environment>
      <directionalLight position={[3, 6, 2]} intensity={1.2} />
      {geometry.walls.map((wall) => (
        <Surface key={wall.wallId} positions={wall.positions} color={WALL_COLOR} />
      ))}
      {geometry.floor && <Surface positions={geometry.floor} color={FLOOR_COLOR} />}
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.02} />
      <FrameRoom bounds={geometry.bounds} wallHeight={room.wallHeight} />
    </Canvas>
  );
}
