/** How much a scene spends on looks. Free of three.js and the DOM, so it can be tested in Node. */
export type QualityTier = {
  name: 'high' | 'medium' | 'low' | 'minimal';
  /** Pixels drawn per CSS pixel, at most. Fill rate is what phones run out of first. */
  maxDpr: number;
  /** Width and height of the sun's shadow map. 0 turns shadows off. */
  shadowMapSize: number;
  /** How far the shadow's edge is blurred, in shadow map texels. */
  shadowRadius: number;
  /** How many lamps give light. Each one adds work to every lit surface. */
  maxLamps: number;
  /** The longest side of a model's textures. Uncompressed, they use up a phone's memory first. */
  maxModelTexture: number;
};

/** Best first. A viewer that can't keep up steps down this list. */
export const QUALITY_TIERS: readonly QualityTier[] = [
  { name: 'high', maxDpr: 2, shadowMapSize: 2048, shadowRadius: 6, maxLamps: 4, maxModelTexture: 2048 },
  { name: 'medium', maxDpr: 1.5, shadowMapSize: 1024, shadowRadius: 4, maxLamps: 3, maxModelTexture: 512 },
  { name: 'low', maxDpr: 1.25, shadowMapSize: 1024, shadowRadius: 3, maxLamps: 2, maxModelTexture: 512 },
  { name: 'minimal', maxDpr: 1, shadowMapSize: 0, shadowRadius: 0, maxLamps: 1, maxModelTexture: 256 },
];

export const HIGH_QUALITY = QUALITY_TIERS[0]!;

export const tierNamed = (name: string | null | undefined): QualityTier | undefined => QUALITY_TIERS.find((tier) => tier.name === name);

/** The next tier down, or null at the bottom. */
export function lowerTier(tier: QualityTier): QualityTier | null {
  return QUALITY_TIERS[QUALITY_TIERS.indexOf(tier) + 1] ?? null;
}

export type DeviceHints = {
  /** Whether the main pointer is a finger. */
  touch: boolean;
  /** Gigabytes, rounded down by the browser. Chromium only. */
  memory?: number;
  cores?: number;
};

const SMALL_MEMORY_GB = 4;
const FEW_CORES = 4;

/** Where a viewer starts. A guess from what the browser reveals; `FrameBudget` corrects it if it's wrong. */
export function startingTier({ touch, memory, cores }: DeviceHints): QualityTier {
  const constrained = (memory !== undefined && memory <= SMALL_MEMORY_GB) || (cores !== undefined && cores <= FEW_CORES);
  if (touch) return tierNamed(constrained ? 'low' : 'medium')!;
  return tierNamed(constrained ? 'medium' : 'high')!;
}

/** The frame rate the viewer must hold on a mid-range phone. */
export const TARGET_FPS = 30;
/** Allows for a display that runs a little under 60 Hz and for timer rounding. */
const SLOW_FRAME_MS = 1000 / (TARGET_FPS - 2);
/** A longer gap than this is the scene sitting idle, which is normal: it only draws when something changes. */
const IDLE_GAP_MS = 1000;
const WINDOW = 30;

/**
 * Watches the time between frames while the scene is moving, and says when to lower the quality. It takes
 * the median of a window, so one hitch (a shader compiling, a texture arriving) doesn't count against a
 * device that otherwise keeps up.
 */
export class FrameBudget {
  private gaps: number[] = [];

  /** Adds the time since the last frame. Returns true when the device isn't keeping up. */
  record(gapMs: number): boolean {
    if (gapMs >= IDLE_GAP_MS) return false;
    this.gaps.push(gapMs);
    if (this.gaps.length < WINDOW) return false;
    const sorted = [...this.gaps].sort((a, b) => a - b);
    this.gaps = [];
    return sorted[Math.floor(sorted.length / 2)]! > SLOW_FRAME_MS;
  }

  reset() {
    this.gaps = [];
  }
}
