export type LengthUnit = 'm' | 'ft';

const METERS_PER_FOOT = 0.3048;
const METERS_PER_INCH = 0.0254;
const SQUARE_FEET_PER_SQUARE_METER = 1 / (METERS_PER_FOOT * METERS_PER_FOOT);

/** Whole-number multiples of a half inch, written so that `parseLength` reads them back. */
function formatFeetAndInches(meters: number): string {
  const halfInches = Math.round((meters / METERS_PER_INCH) * 2);
  const feet = Math.floor(halfInches / 24);
  const inches = (halfInches - feet * 24) / 2;
  return `${feet}' ${inches}"`;
}

export function formatLength(meters: number, unit: LengthUnit): string {
  return unit === 'm' ? `${meters.toFixed(2)} m` : formatFeetAndInches(meters);
}

export function formatArea(squareMeters: number, unit: LengthUnit): string {
  return unit === 'm' ? `${squareMeters.toFixed(2)} m²` : `${(squareMeters * SQUARE_FEET_PER_SQUARE_METER).toFixed(1)} ft²`;
}

const NUMBER = String.raw`(\d+(?:\.\d*)?|\.\d+)`;
const SINGLE = new RegExp(String.raw`^${NUMBER}\s*(mm|cm|m|ft|'|in|")?$`, 'i');
const FEET_AND_INCHES = new RegExp(String.raw`^${NUMBER}\s*(?:ft|')\s*${NUMBER}\s*(?:in|")?$`, 'i');

const METERS_PER: Record<string, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  ft: METERS_PER_FOOT,
  "'": METERS_PER_FOOT,
  in: METERS_PER_INCH,
  '"': METERS_PER_INCH,
};

/**
 * Reads a typed length as meters, or null if it isn't one. A bare number is in the display unit;
 * an explicit unit always wins: `4`, `4.5 m`, `450cm`, `13'`, `13' 1.5"`, `13ft 1in`.
 */
export function parseLength(text: string, unit: LengthUnit): number | null {
  const input = text.trim().replace(',', '.');
  const combined = FEET_AND_INCHES.exec(input);
  if (combined) return Number(combined[1]) * METERS_PER_FOOT + Number(combined[2]) * METERS_PER_INCH;
  const single = SINGLE.exec(input);
  if (!single) return null;
  return Number(single[1]) * METERS_PER[(single[2] ?? unit).toLowerCase()]!;
}
