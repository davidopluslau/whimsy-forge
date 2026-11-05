import { describe, expect, it } from 'vitest';
import { mergeWithEndpoint, snapPoint, typedTarget } from './snap';

const options = { endpoints: [], tolerance: 0.2, gridStep: 0.1, anchor: null };

describe('snapPoint', () => {
  it('snaps to the grid', () => {
    const { point, kind } = snapPoint([1.234, 2.67], options);
    expect(kind).toBe('grid');
    expect(point[0]).toBeCloseTo(1.2, 9);
    expect(point[1]).toBeCloseTo(2.7, 9);
  });

  it('prefers a nearby endpoint, exactly, over the grid', () => {
    const corner: [number, number] = [1.234, 2.345];
    const result = snapPoint([1.3, 2.4], { ...options, endpoints: [corner] });
    expect(result).toEqual({ point: corner, kind: 'endpoint' });
  });

  it('picks the closest of two endpoints', () => {
    const near: [number, number] = [1, 1];
    const result = snapPoint([1.05, 1], { ...options, endpoints: [[1.2, 1], near] });
    expect(result.point).toBe(near);
  });

  it('ignores endpoints out of reach', () => {
    expect(snapPoint([3, 3], { ...options, endpoints: [[1, 1]] }).kind).toBe('grid');
  });

  it('straightens a nearly horizontal or vertical segment against an off-grid anchor', () => {
    const anchor: [number, number] = [1.234, 1.234];
    expect(snapPoint([4, 1.3], { ...options, anchor }).point[1]).toBe(1.234);
    expect(snapPoint([1.3, 4], { ...options, anchor }).point[0]).toBe(1.234);
  });

  it('leaves a clearly diagonal segment alone', () => {
    const { point } = snapPoint([3, 3], { ...options, anchor: [0, 0] });
    expect(point[0]).toBeCloseTo(3, 9);
    expect(point[1]).toBeCloseTo(3, 9);
  });

  it('returns the raw position with the grid off, still catching endpoints', () => {
    expect(snapPoint([1.234, 2.67], { ...options, gridStep: null })).toEqual({ point: [1.234, 2.67], kind: 'free' });
    expect(snapPoint([1.1, 1], { ...options, gridStep: null, endpoints: [[1, 1]] }).kind).toBe('endpoint');
  });
});

describe('typedTarget', () => {
  it('goes the typed distance toward the cursor', () => {
    expect(typedTarget([1, 1], [9, 1], 4)).toEqual([5, 1]);
    expect(typedTarget([1, 1], [1, -9], 5)).toEqual([1, -4]);
    const diagonal = typedTarget([0, 0], [3, 4], 10);
    expect(diagonal[0]).toBeCloseTo(6, 9);
    expect(diagonal[1]).toBeCloseTo(8, 9);
  });

  it('runs along +x with the cursor on the anchor', () => {
    expect(typedTarget([1, 1], [1, 1], 2)).toEqual([3, 1]);
  });
});

describe('mergeWithEndpoint', () => {
  it('lands on a corner within a few millimeters, and not otherwise', () => {
    const corner: [number, number] = [4, 5];
    expect(mergeWithEndpoint([4.003, 5], [corner])).toBe(corner);
    expect(mergeWithEndpoint([4.02, 5], [corner])).toEqual([4.02, 5]);
  });
});
