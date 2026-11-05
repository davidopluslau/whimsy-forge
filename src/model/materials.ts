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
  /**
   * Multiplies the roughness map, for one shot much glossier than the surface should read. A value above 1
   * pushes the map toward fully rough; the shader stops at 1.
   */
  roughness?: number;
  /** Multiplies the color map in linear light, for one shot much darker than the surface it stands for. */
  tint?: [number, number, number];
  /** Real-world size of one texture tile in meters: [width, height, 0]. */
  dimensions: [number, number, number];
  license: string;
  sourceUrl: string;
};

export const MATERIALS = catalog.filter((asset) => asset.kind === 'material') as MaterialAsset[];

export const materialsFor = (surface: SurfaceKind) => MATERIALS.filter((material) => material.surface === surface);

/** The material with this id, unless the id is unset or no longer in the catalog. */
export const materialById = (id: string | undefined) => MATERIALS.find((material) => material.id === id);
