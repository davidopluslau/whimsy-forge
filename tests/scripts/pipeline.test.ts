import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isCatalogAsset } from '../../src/model/catalog';
import { createIO, describeStretch, measure, planFit, processModel } from '../../scripts/import/model';
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
    const { dimensions } = await processModel(boxDocument([0, 0, 0], [5, 10, 4]), { fit: { height: 0.9 } });
    expect(dimensions).toEqual([0.45, 0.9, 0.36]);
  });

  it('turns before fitting, so the axes mean what they say afterwards', async () => {
    const { dimensions } = await processModel(boxDocument([0, 0, 0], [2, 1, 0.5]), { rotateY: 90, fit: { width: 1 } });
    expect(dimensions[0]).toBeCloseTo(1, 2);
    expect(dimensions[2]).toBeCloseTo(4, 2);
    expect(dimensions[1]).toBeCloseTo(2, 2);
  });

  describe('fitting width, height and depth', () => {
    it('fits each axis exactly and reports the stretch', async () => {
      const { glb, dimensions, fit } = await processModel(boxDocument([0, 0, 0], [1, 0.5, 0.8]), { fit: { width: 1.05, height: 0.5, depth: 0.76 } });
      expect(dimensions).toEqual([1.05, 0.5, 0.76]);
      expect((await roundTrip(glb)).dimensions).toEqual([1.05, 0.5, 0.76]);
      expect(fit!.scales.map((scale) => +scale.toFixed(4))).toEqual([1.05, 1, 0.95]);
      expect(fit!.distortion).toBeCloseTo(1.05 / 0.95 - 1, 6);
      expect(fit!.stretch[0]).toBeGreaterThan(0);
      expect(fit!.stretch[2]).toBeLessThan(0);
      expect(fit!.error).toEqual([0, 0, 0]);
    });

    it('reports no distortion when the listing matches the model', async () => {
      const { dimensions, fit } = await processModel(boxDocument([0, 0, 0], [5, 10, 4]), { fit: { width: 0.45, height: 0.9, depth: 0.36 } });
      expect(dimensions).toEqual([0.45, 0.9, 0.36]);
      expect(fit!.distortion).toBeCloseTo(0, 9);
    });

    it('fits the axes after the turn', async () => {
      const { dimensions } = await processModel(boxDocument([0, 0, 0], [2, 1, 0.5]), { rotateY: 90, fit: { width: 0.55, height: 1.05, depth: 2.1 } });
      expect(dimensions).toEqual([0.55, 1.05, 2.1]);
    });

    it('stretches along the room axes, not a turned part of the model', async () => {
      // Turned 30 degrees, the box's own axes no longer line up with width and depth, so a scale
      // applied above the turn without baking it would shear.
      const document = boxDocument([0, 0, 0], [1, 1, 0.5]);
      const half = Math.PI / 12;
      document.getRoot().listNodes().find((node) => node.getName() === 'child')!.setRotation([0, Math.sin(half), 0, Math.cos(half)]);
      const { glb, dimensions } = await processModel(document, { fit: { width: 1.2, height: 1, depth: 0.95 } });
      expect(dimensions).toEqual([1.2, 1, 0.95]);
      expect((await roundTrip(glb)).dimensions).toEqual([1.2, 1, 0.95]);
    });

    it('bakes a mesh shared by two nodes once for each', async () => {
      const document = boxDocument([0, 0, 0], [0.5, 1, 0.5]);
      const child = document.getRoot().listNodes().find((node) => node.getName() === 'child')!;
      child.getParentNode()!.addChild(document.createNode('twin').setMesh(child.getMesh()).setTranslation([2, 0, 0]));
      // Two boxes from x = 1 to 2.5: 1.5 wide, 1 high and 0.5 deep.
      const { dimensions } = await processModel(document, { fit: { width: 1.56, height: 1, depth: 0.5 } });
      expect(dimensions).toEqual([1.56, 1, 0.5]);
    });

    it('takes the average scale for an axis left out', async () => {
      const { dimensions, fit } = await processModel(boxDocument([0, 0, 0], [1, 1, 1]), { fit: { width: 1.06, depth: 0.94 } });
      expect(dimensions[0]).toBe(1.06);
      expect(dimensions[2]).toBe(0.94);
      expect(dimensions[1]).toBeCloseTo(Math.sqrt(1.06 * 0.94), 3);
      expect(fit!.error[1]).toBeNull();
    });

    it('refuses to stretch past the limit, unless the limit is raised', async () => {
      const sofa = () => boxDocument([0, 0, 0], [2, 0.8, 1]);
      const listing = { width: 2, height: 0.8, depth: 0.8 };
      await expect(processModel(sofa(), { fit: listing })).rejects.toThrow(/25\.0 %.*more than the 15 % limit/);
      const { dimensions, fit } = await processModel(sofa(), { fit: listing, maxStretch: 0.3 });
      expect(dimensions).toEqual([2, 0.8, 0.8]);
      expect(fit!.distortion).toBeCloseTo(0.25, 6);
    });
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

  it('fits a listing W x H x D and returns how far it stretched the model', async () => {
    const { asset, fit } = await importAsset({ ...request, file: table, model: { fit: { width: 1.25, height: 0.74, depth: 0.8 } } }, seedDir, thumbnails);
    expect(asset.dimensions).toEqual([1.25, 0.74, 0.8]);
    expect(fit!.distortion).toBeGreaterThan(0.04);
    expect(fit!.distortion).toBeLessThan(0.06);
    expect(fit!.error).toEqual([0, 0, 0]);
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

describe('planFit', () => {
  it('scales uniformly from one axis', () => {
    const plan = planFit([2, 1, 0.5], { height: 0.8 });
    expect(plan.scales).toEqual([0.8, 0.8, 0.8]);
    expect(plan.distortion).toBe(0);
  });

  it('stretches evenly around the uniform scale', () => {
    const plan = planFit([1, 1, 1], { width: 1.06, height: 1, depth: 0.94 });
    const uniform = Math.cbrt(1.06 * 0.94);
    expect(plan.stretch[0]).toBeCloseTo(1.06 / uniform - 1, 9);
    expect(plan.stretch[2]).toBeCloseTo(0.94 / uniform - 1, 9);
  });

  it('allows exactly the limit and no more', () => {
    expect(planFit([1, 1, 1], { width: 1.15, height: 1 }).distortion).toBeCloseTo(0.15, 9);
    expect(() => planFit([1, 1, 1], { width: 1.16, height: 1 })).toThrow(/limit/);
    expect(() => planFit([1, 1, 1], { width: 1.01, height: 1 }, 0)).toThrow(/limit/);
  });

  it('refuses a fit to an axis the model is flat along, and bad sizes', () => {
    expect(() => planFit([1, 1, 0], { width: 1, depth: 0.01 })).toThrow(/flat along its depth/);
    expect(() => planFit([1, 1, 1], { width: -1 })).toThrow(/positive/);
    expect(() => planFit([1, 1, 1], {})).toThrow(/at least one/);
  });
});

describe('describeStretch', () => {
  it('signs each axis', () => {
    expect(describeStretch([0.02, 0, -0.015])).toBe('width +2.0 %, height +0.0 %, depth -1.5 %');
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
