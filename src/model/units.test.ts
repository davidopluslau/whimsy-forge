import { describe, expect, it } from 'vitest';
import { formatArea, formatLength, parseLength } from './units';

describe('formatLength', () => {
  it('shows meters to the centimeter', () => {
    expect(formatLength(4, 'm')).toBe('4.00 m');
    expect(formatLength(0.5, 'm')).toBe('0.50 m');
  });

  it('shows feet and inches to the half inch', () => {
    expect(formatLength(4, 'ft')).toBe(`13' 1.5"`);
    expect(formatLength(0.3048, 'ft')).toBe(`1' 0"`);
    expect(formatLength(0.0254, 'ft')).toBe(`0' 1"`);
  });

  it('carries 12 inches over to the next foot', () => {
    expect(formatLength(0.3047, 'ft')).toBe(`1' 0"`);
  });
});

describe('formatArea', () => {
  it('shows both units', () => {
    expect(formatArea(20, 'm')).toBe('20.00 m²');
    expect(formatArea(20, 'ft')).toBe('215.3 ft²');
  });
});

describe('parseLength', () => {
  it.each([
    ['4', 'm', 4],
    ['4.5', 'm', 4.5],
    ['4,5', 'm', 4.5],
    ['.5', 'm', 0.5],
    ['4 m', 'ft', 4],
    ['450cm', 'm', 4.5],
    ['1200 mm', 'm', 1.2],
    ['10', 'ft', 3.048],
    ["10'", 'm', 3.048],
    ['10 ft', 'm', 3.048],
    ['6"', 'm', 0.1524],
    ['6 in', 'ft', 0.1524],
    [`13' 1.5"`, 'ft', 13 * 0.3048 + 1.5 * 0.0254],
    ['13ft 1in', 'm', 13 * 0.3048 + 0.0254],
    ["13' 1", 'ft', 13 * 0.3048 + 0.0254],
    [' 4 ', 'm', 4],
    ['4 M', 'ft', 4],
  ] as const)('reads %j in %s', (text, unit, meters) => {
    expect(parseLength(text, unit)).toBeCloseTo(meters, 9);
  });

  it.each(['', ' ', 'abc', '-4', '4 x', '4 m 3', '1.2.3', '1e3'])('rejects %j', (text) => {
    expect(parseLength(text, 'm')).toBeNull();
  });

  it.each([0.12, 1.37, 4, 5.5, 12.34])('reads back its own feet-and-inches output to within a quarter inch (%d m)', (meters) => {
    expect(Math.abs(parseLength(formatLength(meters, 'ft'), 'ft')! - meters)).toBeLessThanOrEqual(0.00635 + 1e-9);
  });
});
