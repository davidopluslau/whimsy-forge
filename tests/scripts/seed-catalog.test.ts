// Checks the checked-in catalog against the files it describes.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Document } from '@gltf-transform/core';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { type CatalogAsset, isHttpUrl, parseCatalog } from '../../src/model/catalog';
import { createIO, measure } from '../../scripts/import/model';
import { formatCatalog } from '../../scripts/import/pipeline';
import { largestLevelSurfaceHeight } from './geometry';

const seedDir = fileURLToPath(new URL('../../seed', import.meta.url));
const rawCatalog = JSON.parse(readFileSync(join(seedDir, 'catalog.json'), 'utf8')) as Record<string, unknown>[];
const assets = parseCatalog(rawCatalog);
const models = assets.filter((asset) => asset.kind === 'model');
const byId = (id: string) => models.find((asset) => asset.id === id)!;

/** Plausible [min, max] meters for each piece, by width, height and depth, whichever way it faces. */
const REAL_WORLD_SIZES: Record<string, { height: [number, number]; footprint: [number, number] }> = {
  'painted-wooden-chair-01': { height: [0.8, 1.1], footprint: [0.35, 0.7] },
  'dining-chair-02': { height: [0.8, 1.1], footprint: [0.35, 0.7] },
  'arm-chair-01': { height: [0.75, 1.2], footprint: [0.6, 1.1] },
  'mid-century-lounge-chair': { height: [0.7, 1.25], footprint: [0.6, 1.3] },
  'sofa-02': { height: [0.6, 1.1], footprint: [0.7, 2.2] },
  'sofa-03': { height: [0.6, 1.2], footprint: [0.7, 3] },
  'round-wooden-table-02': { height: [0.68, 0.8], footprint: [0.6, 1.5] },
  'dining-table': { height: [0.7, 0.8], footprint: [0.7, 2.6] },
  'coffee-table-round-01': { height: [0.3, 0.55], footprint: [0.5, 1.4] },
  'side-table-01': { height: [0.4, 0.8], footprint: [0.3, 0.7] },
  'gothic-bed-01': { height: [0.5, 2.3], footprint: [0.9, 2.3] },
  'old-bed-frame': { height: [0.5, 1.5], footprint: [0.8, 2.3] },
  'wooden-display-shelves-01': { height: [0.8, 2.4], footprint: [0.2, 1.3] },
  'steel-frame-shelves-02': { height: [0.8, 2.4], footprint: [0.2, 1.3] },
  'desk-lamp-arm-01': { height: [0.25, 1], footprint: [0.1, 0.8] },
  'modern-ceiling-lamp-01': { height: [0.2, 1.5], footprint: [0.15, 0.8] },
  'industrial-wall-lamp': { height: [0.15, 0.6], footprint: [0.08, 0.5] },
  'potted-plant-01': { height: [0.8, 2], footprint: [0.3, 1] },
  'potted-plant-02': { height: [0.4, 1.5], footprint: [0.3, 1] },
  'potted-plant-04': { height: [0.1, 0.5], footprint: [0.1, 0.4] },
};

const documents = new Map<string, Document>();

beforeAll(async () => {
  const io = await createIO();
  await Promise.all(models.map(async (asset) => documents.set(asset.id, await io.read(join(seedDir, asset.url)))));
});

describe('the seed catalog', () => {
  it('has 15 to 20 pieces covering every category the milestone asks for', () => {
    expect(models.length).toBeGreaterThanOrEqual(15);
    expect(models.length).toBeLessThanOrEqual(20);
    expect(new Set(models.map((asset) => asset.category))).toEqual(new Set(['sofa', 'chair', 'table', 'bed', 'shelf', 'lamp', 'plant']));
  });

  it('has a size range here for every model', () => {
    expect(Object.keys(REAL_WORLD_SIZES).sort()).toEqual(models.map((asset) => asset.id).sort());
  });

  it('records a license and source URL on every entry, materials included', () => {
    expect(rawCatalog.length).toBeGreaterThanOrEqual(models.length);
    for (const entry of rawCatalog) {
      expect(entry.license, String(entry.id)).toBe('CC0 1.0');
      expect(isHttpUrl(entry.sourceUrl), String(entry.id)).toBe(true);
    }
  });

  it('keeps every placeable entry valid, so none disappears from the panel', () => {
    expect(assets.length).toBe(rawCatalog.filter((entry) => entry.kind !== 'material' && entry.kind !== 'environment').length);
  });

  it('gives light from every lamp, with the bulb inside the lamp', () => {
    for (const lamp of models.filter((asset) => asset.category === 'lamp')) {
      expect(lamp.light, lamp.id).toBeDefined();
      const [x, y, z] = lamp.light!.position;
      const [width, height, depth] = lamp.dimensions;
      expect(Math.abs(x), lamp.id).toBeLessThanOrEqual(width / 2);
      expect(y, lamp.id).toBeGreaterThanOrEqual(0);
      expect(y, lamp.id).toBeLessThanOrEqual(height);
      expect(Math.abs(z), lamp.id).toBeLessThanOrEqual(depth / 2);
    }
  });

  it('has an environment that is a small enough HDRI, in the file the entry names', () => {
    const environments = rawCatalog.filter((entry) => entry.kind === 'environment');
    expect(environments).toHaveLength(1);
    const bytes = readFileSync(join(seedDir, String(environments[0]!.url)));
    expect(bytes.subarray(0, 10).toString('latin1')).toBe('#?RADIANCE');
    expect(bytes.byteLength).toBeLessThan(2 * 1024 * 1024);
  });

  it('is stored in the format the import script writes', () => {
    expect(readFileSync(join(seedDir, 'catalog.json'), 'utf8').replaceAll('\r\n', '\n')).toBe(formatCatalog(rawCatalog));
  });
});

describe.each(models.map((asset) => [asset.id, asset] as [string, CatalogAsset]))('%s', (id, asset) => {
  it('matches its catalog dimensions, with the pivot at bottom center', () => {
    const { dimensions, pivotOffset } = measure(documents.get(id)!);
    expect(dimensions).toEqual(asset.dimensions);
    for (const offset of pivotOffset) expect(Math.abs(offset)).toBeLessThan(0.001);
  });

  it('is a real-world size', () => {
    const { height, footprint } = REAL_WORLD_SIZES[id]!;
    const [width, tall, depth] = asset.dimensions;
    expect(tall).toBeGreaterThanOrEqual(height[0]);
    expect(tall).toBeLessThanOrEqual(height[1]);
    expect(Math.max(width, depth)).toBeLessThanOrEqual(footprint[1]);
    expect(Math.max(width, depth)).toBeGreaterThanOrEqual(footprint[0]);
  });

  it('stays compressed and within the phone budget', () => {
    const document = documents.get(id)!;
    const extensions = document.getRoot().listExtensionsUsed().map((extension) => extension.extensionName);
    expect(extensions).toContain('EXT_meshopt_compression');
    expect(existsSync(join(seedDir, asset.url))).toBe(true);
    expect(readFileSync(join(seedDir, asset.url)).byteLength).toBeLessThan(3 * 1024 * 1024);
    for (const texture of document.getRoot().listTextures()) {
      expect(texture.getMimeType()).toBe('image/webp');
      expect(Math.max(...texture.getSize()!)).toBeLessThanOrEqual(2048);
    }
  });

  it('has a thumbnail that shows something on a transparent background', async () => {
    const image = sharp(join(seedDir, asset.thumbnailUrl));
    const { width, height, format } = await image.metadata();
    expect([width, height, format]).toEqual([256, 256, 'webp']);
    const { channels } = await image.stats();
    const alpha = channels[3]!;
    expect(alpha.min).toBe(0);
    expect(alpha.max).toBe(255);
  });
});

describe('a dining chair', () => {
  it.each(['painted-wooden-chair-01', 'dining-chair-02'])('%s has its seat 0.40 to 0.50 m high', (id) => {
    const seat = largestLevelSurfaceHeight(documents.get(byId(id).id)!);
    expect(seat).toBeGreaterThanOrEqual(0.4);
    expect(seat).toBeLessThanOrEqual(0.5);
  });
});
