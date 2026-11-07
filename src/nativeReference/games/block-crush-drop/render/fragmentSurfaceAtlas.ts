/** Seven square patches: +X,-X,+Y,-Y,+Z,-Z, then fresh fracture surface. */
export const CRUSH_FRAGMENT_SURFACE_TILES = 7;

/** Surface materials use the separate block-front artwork in the 3D renderer. */
export function requireCrushFragmentSurfaceFront(hasSurface: boolean, hasFront: boolean): void {
  if (hasSurface && !hasFront)
    throw new Error(
      'BLOCK_CRUSH_FRAGMENT_SURFACE_FRONT_REQUIRED: effect.fragment-surfaces requires a piece.face binding.',
    );
}

export function crushFragmentSurfaceAtlasEdge(width: number, height: number): number {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    height < 1 ||
    width !== height * CRUSH_FRAGMENT_SURFACE_TILES
  ) {
    throw new Error(
      'BLOCK_CRUSH_FRAGMENT_SURFACE_ATLAS_DIMENSIONS: expected seven equal square patches in one horizontal strip.',
    );
  }
  return height;
}
