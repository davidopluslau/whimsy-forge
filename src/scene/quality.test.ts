import { describe, expect, it } from 'vitest';
import { FrameBudget, lowerTier, QUALITY_TIERS, startingTier, tierNamed } from './quality';

describe('startingTier', () => {
  it('starts a desktop at the top', () => {
    expect(startingTier({ touch: false }).name).toBe('high');
    expect(startingTier({ touch: false, memory: 16, cores: 12 }).name).toBe('high');
  });

  it('starts a phone below the top, and a small phone lower still', () => {
    expect(startingTier({ touch: true, memory: 8, cores: 8 }).name).toBe('medium');
    expect(startingTier({ touch: true, memory: 4, cores: 8 }).name).toBe('low');
    expect(startingTier({ touch: true, memory: 8, cores: 4 }).name).toBe('low');
  });

  it('assumes nothing from a browser that hides its memory', () => {
    expect(startingTier({ touch: true }).name).toBe('medium');
  });
});

describe('the tiers', () => {
  it('only ever get cheaper going down', () => {
    for (let index = 1; index < QUALITY_TIERS.length; index++) {
      const [better, worse] = [QUALITY_TIERS[index - 1]!, QUALITY_TIERS[index]!];
      expect(worse.maxDpr).toBeLessThan(better.maxDpr);
      expect(worse.shadowMapSize).toBeLessThanOrEqual(better.shadowMapSize);
      expect(worse.maxLamps).toBeLessThan(better.maxLamps);
    }
  });

  it('step down one at a time and stop at the bottom', () => {
    expect(lowerTier(tierNamed('high')!)?.name).toBe('medium');
    expect(lowerTier(tierNamed('minimal')!)).toBeNull();
  });

  it('are found by name, and an unknown name finds none', () => {
    expect(tierNamed('low')?.name).toBe('low');
    expect(tierNamed('ultra')).toBeUndefined();
    expect(tierNamed(null)).toBeUndefined();
  });
});

describe('FrameBudget', () => {
  const feed = (budget: FrameBudget, gap: number, count: number) => Array.from({ length: count }, () => budget.record(gap)).some(Boolean);

  it('is content at 60 and at a steady 30 fps', () => {
    const budget = new FrameBudget();
    expect(feed(budget, 16.7, 300)).toBe(false);
    expect(feed(budget, 33.4, 300)).toBe(false);
  });

  it('asks for less once frames are steadily too slow', () => {
    expect(feed(new FrameBudget(), 50, 30)).toBe(true);
  });

  it('forgives a few hitches', () => {
    const budget = new FrameBudget();
    expect(feed(budget, 16.7, 25)).toBe(false);
    expect(feed(budget, 200, 5)).toBe(false);
  });

  it("doesn't count time the scene sat idle", () => {
    expect(feed(new FrameBudget(), 5000, 300)).toBe(false);
  });

  it('judges each window afresh, and reset drops what it has seen', () => {
    const budget = new FrameBudget();
    expect(feed(budget, 50, 30)).toBe(true);
    expect(feed(budget, 50, 29)).toBe(false);
    budget.reset();
    expect(feed(budget, 50, 29)).toBe(false);
  });
});
