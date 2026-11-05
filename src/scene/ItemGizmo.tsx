import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Item, Room } from '../model/design';
import { placeOnWall } from '../model/items';

export type GizmoMode = 'move' | 'rotate';

export type GizmoPatch = Partial<Pick<Item, 'position' | 'rotationY' | 'wallId'>>;

type GizmoProps = {
  item: Item | null;
  mode: GizmoMode;
  room: Room;
  onChange: (id: string, patch: GizmoPatch) => void;
  onStart: () => void;
  onEnd: () => void;
};

/**
 * Move and turn gizmos for the selected item. A wall item only slides along its wall, so it always
 * uses the move gizmo, and each move is snapped back onto the wall. A drag becomes one undo step:
 * `onStart` and `onEnd` bracket it.
 */
export function ItemGizmo({ item, mode, room, onChange, onStart, onEnd }: GizmoProps) {
  const camera = useThree((state) => state.camera);
  const domElement = useThree((state) => state.gl.domElement);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const orbit = useThree((state) => state.controls) as unknown as { enabled: boolean } | null;
  const controls = useMemo(() => new TransformControls(camera, domElement), [camera, domElement]);

  const effectiveMode: GizmoMode = item?.mount === 'wall' ? 'move' : mode;
  // Listeners read the latest values through this ref, so they are bound once.
  const latest = useRef({ item, room, effectiveMode, onChange, onStart, onEnd, orbit });
  latest.current = { item, room, effectiveMode, onChange, onStart, onEnd, orbit };

  useEffect(() => {
    const onDragging = (event: { value: boolean }) => {
      const current = latest.current;
      if (current.orbit) current.orbit.enabled = !event.value;
      if (event.value) current.onStart();
      else current.onEnd();
    };

    const onObjectChange = () => {
      const current = latest.current;
      const object = controls.object;
      const target = current.item;
      if (!object || !target) return;

      if (current.effectiveMode === 'rotate') {
        object.rotation.set(0, object.rotation.y, 0);
        current.onChange(target.id, { rotationY: object.rotation.y });
        return;
      }
      if (target.mount === 'wall' && target.wallId !== undefined) {
        const facing: [number, number] = [Math.sin(target.rotationY), Math.cos(target.rotationY)];
        const placed = placeOnWall(current.room, target.wallId, [object.position.x, object.position.z], target.size, target.position[1], facing);
        if (!placed) return;
        object.position.set(placed.position[0], placed.position[1], placed.position[2]);
        object.rotation.set(0, placed.rotationY, 0);
        current.onChange(target.id, placed);
        return;
      }
      current.onChange(target.id, { position: [object.position.x, target.position[1], object.position.z] });
    };

    const onRedraw = () => invalidate();

    controls.addEventListener('dragging-changed', onDragging as never);
    controls.addEventListener('objectChange', onObjectChange as never);
    controls.addEventListener('change', onRedraw);
    return () => {
      controls.removeEventListener('dragging-changed', onDragging as never);
      controls.removeEventListener('objectChange', onObjectChange as never);
      controls.removeEventListener('change', onRedraw);
      controls.detach();
    };
  }, [controls, invalidate]);

  useEffect(() => {
    const target = item ? scene.getObjectByName(item.id) : undefined;
    if (!target) {
      controls.detach();
      invalidate();
      return;
    }
    if (effectiveMode === 'rotate') {
      controls.setMode('rotate');
      controls.showX = false;
      controls.showY = true;
      controls.showZ = false;
    } else {
      controls.setMode('translate');
      controls.showX = true;
      controls.showY = false;
      controls.showZ = true;
    }
    controls.attach(target);
    invalidate();
  }, [item?.id, item?.mount, effectiveMode, scene, controls, invalidate]);

  return <primitive object={controls} />;
}
