import { describe, expect, it } from 'vitest';
import { DoubleSide, FrontSide, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Texture } from 'three';
import { fitModelToBudget, fittedSize, gpuMegabytes, sceneTextureMegabytes } from './textureBudget';

describe('fittedSize', () => {
  it('leaves an image that already fits', () => {
    expect(fittedSize(512, 256, 512)).toEqual({ width: 512, height: 256 });
  });

  it('shrinks by the longest side and keeps the shape', () => {
    expect(fittedSize(1024, 512, 512)).toEqual({ width: 512, height: 256 });
    expect(fittedSize(500, 2000, 1000)).toEqual({ width: 250, height: 1000 });
  });

  it('never rounds a side away to nothing', () => {
    expect(fittedSize(4096, 1, 512)).toEqual({ width: 512, height: 1 });
  });
});

describe('gpuMegabytes', () => {
  it('counts RGBA with mipmaps', () => {
    // 1024 x 1024 x 4 bytes is 4 MiB, and mipmaps add a third.
    expect(gpuMegabytes([{ width: 1024, height: 1024 }])).toBeCloseTo(16 / 3, 6);
  });
});

describe('a model and its budget', () => {
  function model(material: MeshStandardMaterial | MeshPhysicalMaterial) {
    const group = new Group();
    group.add(new Mesh(undefined, material));
    return group;
  }

  it('draws double-sided transparent materials in one pass, and leaves others alone', () => {
    const leaves = new MeshStandardMaterial({ transparent: true, side: DoubleSide });
    const opaque = new MeshStandardMaterial({ side: DoubleSide });
    const glass = new MeshStandardMaterial({ transparent: true, side: FrontSide });
    for (const material of [leaves, opaque, glass]) fitModelToBudget(model(material), 512);
    expect([leaves.forceSinglePass, opaque.forceSinglePass, glass.forceSinglePass]).toEqual([true, false, false]);
  });

  it('turns transmissive glass into see-through glass, which needs no second pass over the scene', () => {
    const glass = new MeshPhysicalMaterial({ transmission: 1, side: DoubleSide });
    fitModelToBudget(model(glass), 512);
    expect(glass.transmission).toBe(0);
    expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBeLessThan(1);
    expect(glass.forceSinglePass).toBe(true);
  });

  it('counts a texture shared by two materials once', () => {
    const shared = new Texture({ width: 1024, height: 1024 });
    const scene = new Group();
    scene.add(model(new MeshStandardMaterial({ map: shared })));
    scene.add(model(new MeshStandardMaterial({ map: shared })));
    expect(sceneTextureMegabytes(scene)).toBeCloseTo(16 / 3, 6);
  });

  it('leaves a texture alone when it already fits, and copes with one not loaded', () => {
    const small = new Texture({ width: 256, height: 256 });
    const version = small.version;
    const pending = new Texture();
    fitModelToBudget(model(new MeshStandardMaterial({ map: small, normalMap: pending })), 512);
    expect(small.version).toBe(version);
    expect(small.image).toEqual({ width: 256, height: 256 });
  });
});
