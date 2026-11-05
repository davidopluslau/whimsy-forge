import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { FrameBudget } from './quality';
import { sceneTextureMegabytes } from './textureBudget';

/** How long after the scene last drew the browser's pace still says something about the scene. */
const ACTIVE_MS = 150;

/**
 * Calls `onSlow` when the browser can't keep up while the scene draws. It starts over after each change of
 * `tierName`. It times the browser's animation frames, not the scene's draws: the scene only draws on change,
 * so a slow finger on a fast phone also means long gaps between draws, while the browser's pace falls only
 * when the device really is behind.
 */
export function FrameWatcher({ tierName, onSlow }: { tierName: string; onSlow: () => void }) {
  const budget = useMemo(() => new FrameBudget(), []);
  const lastDraw = useRef(0);
  const running = useRef(false);
  const latestOnSlow = useRef(onSlow);
  latestOnSlow.current = onSlow;

  useEffect(() => budget.reset(), [budget, tierName]);
  useEffect(
    () => () => {
      running.current = false;
    },
    [],
  );

  useFrame(() => {
    lastDraw.current = performance.now();
    if (running.current) return;
    running.current = true;
    let previous = lastDraw.current;
    const tick = () => {
      if (!running.current) return;
      const now = performance.now();
      if (budget.record(now - previous)) latestOnSlow.current();
      previous = now;
      if (now - lastDraw.current > ACTIVE_MS) running.current = false;
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
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
