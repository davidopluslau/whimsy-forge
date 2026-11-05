import catalog from '../../seed/catalog.json';

/** An HDRI that lights every scene. It isn't placed or chosen, so it's compiled in, as materials are. */
export type EnvironmentAsset = {
  id: string;
  name: string;
  kind: 'environment';
  /** A Radiance .hdr file. Relative to the API root, like every catalog path. */
  url: string;
  license: string;
  sourceUrl: string;
};

/** Every scene's HDRI. Undefined only if the catalog has none, and then scenes use their built-in light. */
export const ENVIRONMENT = catalog.find((asset) => asset.kind === 'environment') as EnvironmentAsset | undefined;
