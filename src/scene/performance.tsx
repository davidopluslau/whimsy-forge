import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { FrameBudget } from './quality';
import { sceneTextureMegabytes } from './textureBudget';

/** Calls `onSlow` when frames stay too slow while the scene moves. It starts over after each change of `tierName`. */
export function FrameWatcher({ tierName, onSlow }: { tierName: string; onSlow: () => void }) {
  const budget = useMemo(() => new FrameBudget(), []);
  const last = useRef<number | null>(null);

  useEffect(() => {
    budget.reset();
    last.current = null;
  }, [budget, tierName]);

  useFrame(() => {
    const now = performance.now();
    if (last.current !== null && budget.record(now - last.current)) onSlow();
    last.current = now;
  });
  return null;
}

export type SceneStats = { fps: number; drawCalls: number; triangles: number; textureMegabytes: number; pixels: [number, number] };

const REPORT_EVERY_MS = 500;

/** Reports what the last frame cost, twice a second. It's only mounted when `?stats` asks for it. */
export function StatsProbe({ onStats }: { onStats: (stats: SceneStats) => void }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const window = useRef({ start: performance.now(), frames: 0 });

  useFrame(() => {
    window.current.frames += 1;
    const now = performance.now();
    const elapsed = now - window.current.start;
    if (elapsed < REPORT_EVERY_MS) return;
    onStats({
      fps: Math.round((window.current.frames * 1000) / elapsed),
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      textureMegabytes: Math.round(sceneTextureMegabytes(scene)),
      pixels: [gl.domElement.width, gl.domElement.height],
    });
    window.current = { start: now, frames: 0 };
  });
  return null;
}
