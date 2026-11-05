import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isCatalogAsset } from '../../src/model/catalog';
import { createIO, measure, processModel } from '../../scripts/import/model';
import { formatCatalog, importAsset, slugify, upsertCatalog } from '../../scripts/import/pipeline';

/** A box from `min` to `max`, in whatever units the test pretends the source uses. */
function boxDocument(min: [number, number, number], max: [number, number, number]): Document {
  const document = new Document();
  const buffer = document.createBuffer();
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const position = document
    .createAccessor()
    .setType('VEC3')
    .setBuffer(buffer)
    .setArray(new Float32Array([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]));
  const indices = document
    .createAccessor()
    .setType('SCALAR')
    .setBuffer(buffer)
    .setArray(new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6]));
  const primitive = document.createPrimitive().setAttribute('POSITION', position).setIndices(indices);
  const mesh = document.createMesh('box').addPrimitive(primitive);
  // A nested transform, to prove that normalization looks at world space.
  const child = document.createNode('child').setMesh(mesh).setTranslation([1, 0, 0]);
  const parent = document.createNode('parent').addChild(child).setTranslation([0, 2, 0]);
  document.createScene('scene').addChild(parent);
  return document;
}

async function roundTrip(glb: Uint8Array) {
  const io = await createIO();
  return measure(await io.readBinary(glb));
}

describe('processModel', () => {
  it('moves the pivot to bottom center and leaves a model in meters at its size', async () => {
    const { glb, dimensions } = await processModel(boxDocument([3, -1, 5], [3.5, 0, 5.4]));
    expect(dimensions).toEqual([0.5, 1, 0.4]);
    const shipped = await roundTrip(glb);
    expect(shipped.dimensions).toEqual([0.5, 1, 0.4]);
    for (const offset of shipped.pivotOffset) expect(Math.abs(offset)).toBeLessThan(0.0005);
  });

  it('applies a unit scale', async () => {
    const { dimensions } = await processModel(boxDocument([0, 0, 0], [50, 100, 40]), { scale: 0.01 });
    expect(dimensions).toEqual([0.5, 1, 0.4]);
  });

  it('fits a typed real-world size uniformly', async () => {
    const { dimensions } = await processModel(boxDocument([0, 0, 0], [5, 10, 4]), { fit: { axis: 'height', meters: 0.9 } });
    expect(dimensions).toEqual([0.45, 0.9, 0.36]);
  });

  it('turns before fitting, so the axes mean what they say afterwards', async () => {
    const { dimensions } = await processModel(boxDocument([0, 0, 0], [2, 1, 0.5]), { rotateY: 90, fit: { axis: 'width', meters: 1 } });
    expect(dimensions[0]).toBeCloseTo(1, 2);
    expect(dimensions[2]).toBeCloseTo(4, 2);
    expect(dimensions[1]).toBeCloseTo(2, 2);
  });

  it('refuses a size that is probably in the wrong units, and accepts it once told', async () => {
    const centimeters = () => boxDocument([0, 0, 0], [90, 180, 50]);
    await expect(processModel(centimeters())).rejects.toThrow(/not in meters/);
    await expect(processModel(boxDocument([0, 0, 0], [0.002, 0.003, 0.001]))).rejects.toThrow(/not in meters/);
    await expect(processModel(centimeters(), { scale: 0.01 })).resolves.toBeTruthy();
  });

  it('refuses a file with no geometry', async () => {
    const document = new Document();
    document.createScene('empty').addChild(document.createNode('nothing'));
    await expect(processModel(document)).rejects.toThrow(/no visible geometry/);
  });

  it('simplifies down to the triangle budget', async () => {
    const document = new Document();
    const buffer = document.createBuffer();
    const size = 40;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let row = 0; row <= size; row++) {
      for (let column = 0; column <= size; column++) positions.push(column / size, row / size, 0);
    }
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        const corner = row * (size + 1) + column;
        indices.push(corner, corner + 1, corner + size + 1, corner + 1, corner + size + 2, corner + size + 1);
      }
    }
    const primitive = document
      .createPrimitive()
      .setAttribute('POSITION', document.createAccessor().setType('VEC3').setBuffer(buffer).setArray(new Float32Array(positions)))
      .setIndices(document.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(new Uint16Array(indices)));
    document.createScene('scene').addChild(document.createNode('grid').setMesh(document.createMesh('grid').addPrimitive(primitive)));

    const { triangles, dimensions } = await processModel(document, { maxTriangles: 200 });
    expect(triangles).toBeLessThanOrEqual(200);
    expect(dimensions).toEqual([1, 1, 0]);
  });
});

describe('importAsset', () => {
  const thumbnails = { render: async () => Buffer.from('thumbnail') };
  const request = { category: 'table', license: 'CC0 1.0', sourceUrl: 'https://example.com/source' } as const;
  let seedDir: string;
  let table: string;

  beforeEach(async () => {
    seedDir = mkdtempSync(join(tmpdir(), 'whimsy-import-'));
    writeFileSync(join(seedDir, 'catalog.json'), '[{"id":"existing","kind":"material"}]\n');
    table = join(seedDir, 'OakTable_01.glb');
    await new NodeIO().write(table, boxDocument([0, 0, 0], [1.2, 0.75, 0.8]));
  });

  afterEach(() => rmSync(seedDir, { recursive: true, force: true }));

  const catalog = () => JSON.parse(readFileSync(join(seedDir, 'catalog.json'), 'utf8')) as { id: string }[];

  it('writes the files and appends a valid entry with its license and source', async () => {
    const { asset, files } = await importAsset({ ...request, file: table }, seedDir, thumbnails);

    expect(isCatalogAsset(asset)).toBe(true);
    expect(asset).toMatchObject({
      id: 'oak-table-01',
      name: 'Oak table 01',
      kind: 'model',
      mount: 'floor',
      url: 'assets/oak-table-01/model.glb',
      thumbnailUrl: 'assets/oak-table-01/thumbnail.webp',
      dimensions: [1.2, 0.75, 0.8],
      license: 'CC0 1.0',
      sourceUrl: 'https://example.com/source',
    });
    expect(catalog().map((entry) => entry.id)).toEqual(['existing', 'oak-table-01']);
    expect(readFileSync(join(seedDir, asset.thumbnailUrl), 'utf8')).toBe('thumbnail');
    expect(files.map((file) => file.key)).toEqual([asset.url, asset.thumbnailUrl, 'catalog.json']);
  });

  it('refuses an import without a license or a source URL', async () => {
    await expect(importAsset({ ...request, file: table, license: ' ' }, seedDir, thumbnails)).rejects.toThrow(/license/);
    await expect(importAsset({ ...request, file: table, sourceUrl: 'somewhere' }, seedDir, thumbnails)).rejects.toThrow(/URL/);
    expect(catalog()).toHaveLength(1);
  });

  it('refuses to overwrite an id unless asked, and replaces in place when asked', async () => {
    await importAsset({ ...request, file: table, id: 'existing-table' }, seedDir, thumbnails);
    await expect(importAsset({ ...request, file: table, id: 'existing-table' }, seedDir, thumbnails)).rejects.toThrow(/already has/);
    await importAsset({ ...request, file: table, id: 'existing', replace: true }, seedDir, thumbnails);
    expect(catalog().map((entry) => entry.id)).toEqual(['existing', 'existing-table']);
  });

  it('refuses an unsupported file type', async () => {
    await expect(importAsset({ ...request, file: 'sofa.fbx' }, seedDir, thumbnails)).rejects.toThrow(/Can't import/);
  });

  it('leaves the catalog alone when processing fails', async () => {
    const failing = { render: async () => Promise.reject(new Error('no browser')) };
    await expect(importAsset({ ...request, file: table }, seedDir, failing)).rejects.toThrow('no browser');
    expect(catalog()).toHaveLength(1);
  });

  describe('with an image', () => {
    let photo: string;

    beforeEach(async () => {
      photo = join(seedDir, 'Sunset Photo.png');
      await sharp({ create: { width: 400, height: 300, channels: 3, background: '#c06030' } }).png().toFile(photo);
    });

    it('sizes a picture from the width and aspect ratio, for the wall by default', async () => {
      const { asset } = await importAsset({ ...request, category: 'picture', file: photo, imageWidth: 0.8 }, seedDir, null);
      expect(asset).toMatchObject({ id: 'sunset-photo', kind: 'picture', mount: 'wall', url: 'assets/sunset-photo/image.webp' });
      expect(asset.dimensions).toEqual([0.8, 0.6, 0.03]);
      const stored = await sharp(readFileSync(join(seedDir, asset.url))).metadata();
      expect([stored.format, stored.width, stored.height]).toEqual(['webp', 400, 300]);
      const thumbnail = await sharp(readFileSync(join(seedDir, asset.thumbnailUrl))).metadata();
      expect([thumbnail.width, thumbnail.height]).toEqual([256, 256]);
    });

    it('lays a rug flat on the floor', async () => {
      const { asset } = await importAsset({ ...request, category: 'rug', file: photo, imageWidth: 2 }, seedDir, null);
      expect(asset).toMatchObject({ kind: 'rug', mount: 'floor' });
      expect(asset.dimensions).toEqual([2, 0.01, 1.5]);
    });

    it('caps a huge image at the phone budget', async () => {
      const big = join(seedDir, 'big.png');
      await sharp({ create: { width: 4000, height: 2000, channels: 3, background: '#335577' } }).png().toFile(big);
      const { asset } = await importAsset({ ...request, category: 'picture', file: big, imageWidth: 1 }, seedDir, null);
      const stored = await sharp(readFileSync(join(seedDir, asset.url))).metadata();
      expect([stored.width, stored.height]).toEqual([2048, 1024]);
    });

    it('requires a width', async () => {
      await expect(importAsset({ ...request, category: 'picture', file: photo }, seedDir, null)).rejects.toThrow(/--width/);
    });
  });
});

describe('slugify', () => {
  it.each([
    ['ArmChair_01', 'arm-chair-01'],
    ['painted_wooden_chair_01', 'painted-wooden-chair-01'],
    ['Sunset Photo!', 'sunset-photo'],
  ])('%s becomes %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe('formatCatalog', () => {
  it('keeps number arrays on one line and tag lists readable', () => {
    expect(formatCatalog([{ id: 'a', dimensions: [1, 0.5, 2] }])).toBe('[\n  {\n    "id": "a",\n    "dimensions": [1, 0.5, 2]\n  }\n]\n');
  });
});

describe('upsertCatalog', () => {
  it('appends a new id and replaces an existing one where it stands', () => {
    const entry = (id: string, name = id) => ({ id, name }) as never;
    expect(upsertCatalog([entry('a')], entry('b'))).toEqual([entry('a'), entry('b')]);
    expect(upsertCatalog([entry('a'), entry('b')], entry('a', 'new'))).toEqual([entry('a', 'new'), entry('b')]);
  });
});
