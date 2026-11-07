import { paletteFromCrushStyle, type BlockCrushDropPalette } from './palette';

export const BLOCK_CRUSH_DROP_CRUSHZR29976_LOOK_PACK_ID =
  'block-crush-drop.look.crushzr29976-procedural.v2';

export interface BlockCrushDropRuntimeAssets {
  lookPackId: typeof BLOCK_CRUSH_DROP_CRUSHZR29976_LOOK_PACK_ID;
  pixelSourcePolicy: 'procedural-only';
  calibrationEvidence: 'numeric-measurements-only';
  palette?: BlockCrushDropPalette;
}

export interface BlockCrushDropTrayGlyphLayout {
  x: number;
  y: number;
  pitch: number;
  size: number;
}

export interface BlockCrushDropForegroundOccluderLayout {
  headerBottomY: number;
  boardLeftX: number;
  boardRightX: number;
  headerApertures: ReadonlyArray<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

export interface BlockCrushDropSpatialLuminanceField {
  /** Coefficients for 1, x, y, x², y², xy in normalized screen space. */
  polynomial: readonly [number, number, number, number, number, number];
  /** Converts the fitted display-light ratio into the renderer's linear space. */
  linearStrength: number;
  minimum: number;
  maximum: number;
}

/**
 * BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z. The front face is
 * replaced by the quarter-tile texture at runtime; the remaining colours
 * reproduce the brighter cut faces visible while source debris tumbles.
 */
export const BLOCK_CRUSH_DROP_CRUSHZR29976_DEBRIS_FACE_COLORS = [
  0xcc8d57, 0xe3a76a, 0xffe3ab, 0xc6854f, 0xebba7b, 0xb36f3f,
] as const;

/**
 * The clear pass retains a faint quadrant of the original star tile, but the
 * exposed cut face dominates after the sheet starts tumbling. A value of 1
 * would reproduce the settled-tile texture verbatim; 0 is a flat cut face.
 */
export const BLOCK_CRUSH_DROP_CRUSHZR29976_DEBRIS_FRONT_TEXTURE_BLEND = 0.35;

/** Source-matched opacity of the single cinematic shutter sample. */
export const BLOCK_CRUSH_DROP_CRUSHZR29976_DEBRIS_TRAIL_OPACITY = 0.4;

/**
 * Source-authored HUD metrics. The gameplay package only identifies the tray
 * batch, slot, piece, and rotation; a Look Pack owns the thumbnail's visual
 * scale and pivot. Keys are `${batchIndex}:${traySlot}` for this finite take.
 */
export const BLOCK_CRUSH_DROP_CRUSHZR29976_TRAY_GLYPH_LAYOUTS: Readonly<
  Record<string, BlockCrushDropTrayGlyphLayout>
> = {
  '0:0': { x: 369, y: 68, pitch: 23, size: 24 },
  '0:1': { x: 518, y: 49, pitch: 26.5, size: 27 },
  '0:2': { x: 658, y: 76, pitch: 26.5, size: 27 },
  '1:0': { x: 364, y: 49, pitch: 26.5, size: 27 },
  '1:1': { x: 518, y: 76, pitch: 26.5, size: 27 },
  '1:2': { x: 671, y: 62, pitch: 26.5, size: 27 },
};

/**
 * The source HUD is a foreground wooden frame, not a flat background image.
 * A held piece can travel behind it and remain visible only through the timer
 * and score notches. These apertures are look-pack geometry, never rules.
 */
export const BLOCK_CRUSH_DROP_CRUSHZR29976_FOREGROUND_OCCLUDER: BlockCrushDropForegroundOccluderLayout =
  {
    headerBottomY: 198,
    boardLeftX: 22,
    boardRightX: 1_053,
    headerApertures: [
      { x: 273, y: 109, width: 35, height: 89 },
      { x: 783, y: 109, width: 35, height: 89 },
    ],
  };

/**
 * Screen-space lighting recovered from stable occupied cells in source f0.
 * This belongs to the Look Pack: gameplay owns cell occupancy, while a theme
 * may brighten the same tile differently across the photographed board.
 */
export const BLOCK_CRUSH_DROP_CRUSHZR29976_TILE_LUMINANCE_FIELD: BlockCrushDropSpatialLuminanceField =
  {
    polynomial: [0.987801, 0.162699, 0.007345, -0.166621, 0.027954, 0.014713],
    linearStrength: 1.1,
    minimum: 0.9,
    maximum: 1.1,
  };

export function sampleBlockCrushDropSpatialLuminance(
  field: BlockCrushDropSpatialLuminanceField,
  normalizedX: number,
  normalizedY: number,
): number {
  const x = Math.max(0, Math.min(1, normalizedX));
  const y = Math.max(0, Math.min(1, normalizedY));
  const [constant, x1, y1, x2, y2, xy] = field.polynomial;
  const displayRatio = Math.max(
    field.minimum,
    Math.min(field.maximum, constant + x1 * x + y1 * y + x2 * x * x + y2 * y * y + xy * x * y),
  );
  return Math.pow(displayRatio, field.linearStrength);
}

export const BLOCK_CRUSH_DROP_CRUSHZR29976_RUNTIME_ASSETS: BlockCrushDropRuntimeAssets = {
  lookPackId: BLOCK_CRUSH_DROP_CRUSHZR29976_LOOK_PACK_ID,
  pixelSourcePolicy: 'procedural-only',
  calibrationEvidence: 'numeric-measurements-only',
};

export function blockCrushDropRuntimeAssetsForStyle(style: unknown): BlockCrushDropRuntimeAssets {
  return {
    ...BLOCK_CRUSH_DROP_CRUSHZR29976_RUNTIME_ASSETS,
    palette: paletteFromCrushStyle(style),
  };
}

export function usesCrushZr29976LookPack(value: unknown): value is BlockCrushDropRuntimeAssets {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BlockCrushDropRuntimeAssets>;
  return (
    candidate.lookPackId === BLOCK_CRUSH_DROP_CRUSHZR29976_LOOK_PACK_ID &&
    candidate.pixelSourcePolicy === 'procedural-only' &&
    candidate.calibrationEvidence === 'numeric-measurements-only'
  );
}
