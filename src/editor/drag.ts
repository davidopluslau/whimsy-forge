/** The drag type that carries a catalog asset's id from the panel to the plan or the 3D view. */
export const ASSET_DRAG_TYPE = 'application/x-whimsy-asset';

export const isAssetDrag = (types: readonly string[]) => types.includes(ASSET_DRAG_TYPE);
