import catalog from '../../seed/catalog.json';

export type SurfaceKind = 'floor' | 'wall';

/** A tiling PBR material. `url` is the color map; paths are relative to the API root, like every catalog URL. */
export type MaterialAsset = {
  id: string;
  name: string;
  kind: 'material';
  surface: SurfaceKind;
  url: string;
  normalUrl: string;
  roughnessUrl: string;
  thumbnailUrl: string;
  /** Shown until the textures load, and if they never do. */
  color: string;
  /** Real-world size of one texture tile in meters: [width, height, 0]. */
  dimensions: [number, number, number];
  license: string;
  sourceUrl: string;
};

export const MATERIALS = catalog.filter((asset) => asset.kind === 'material') as MaterialAsset[];

export const materialsFor = (surface: SurfaceKind) => MATERIALS.filter((material) => material.surface === surface);

/** The material with this id, unless the id is unset or no longer in the catalog. */
export const materialById = (id: string | undefined) => MATERIALS.find((material) => material.id === id);
