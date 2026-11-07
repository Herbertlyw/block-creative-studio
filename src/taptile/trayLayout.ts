import type { PixelRect } from './pixelGeometry';

/**
 * Stable geometry measured from the unwatermarked tpt760/tpt811 reference
 * frames at 1080x1920. The V1 rule profile uses one fixed, top-mounted tray.
 */
export const TAPTILE_TRAY_CAPACITY = 7;

export const TAPTILE_REFERENCE_TRAY_BOUNDS: PixelRect = Object.freeze({
  left: 30,
  top: 215,
  right: 1050,
  bottom: 385,
  width: 1020,
  height: 170,
});

export const TAPTILE_REFERENCE_BOARD_TOP_PX = 405;

const REFERENCE_SLOT = Object.freeze({
  leftInset: 28,
  topInset: 21,
  width: 124,
  height: 128,
  pitchX: 140,
});

export function normalizeTapTileTrayBounds(_bounds: PixelRect | undefined): PixelRect {
  // This is a frozen V1 rule/presentation profile. Keeping one canonical rect
  // prevents DOM play, director motion and exported frames from drifting apart.
  return { ...TAPTILE_REFERENCE_TRAY_BOUNDS };
}

export function tapTileTraySlotRect(
  index: number,
  tray: PixelRect = TAPTILE_REFERENCE_TRAY_BOUNDS,
): PixelRect {
  const safeIndex = Math.max(0, Math.min(TAPTILE_TRAY_CAPACITY - 1, Math.trunc(index)));
  const scaleX = tray.width / TAPTILE_REFERENCE_TRAY_BOUNDS.width;
  const scaleY = tray.height / TAPTILE_REFERENCE_TRAY_BOUNDS.height;
  const left = Math.round(tray.left + (REFERENCE_SLOT.leftInset + safeIndex * REFERENCE_SLOT.pitchX) * scaleX);
  const top = Math.round(tray.top + REFERENCE_SLOT.topInset * scaleY);
  const width = Math.round(REFERENCE_SLOT.width * scaleX);
  const height = Math.round(REFERENCE_SLOT.height * scaleY);
  return { left, top, right: left + width, bottom: top + height, width, height };
}

export function tapTileTraySlotCenter(
  index: number,
  tray: PixelRect = TAPTILE_REFERENCE_TRAY_BOUNDS,
): { xPx: number; yPx: number } {
  const slot = tapTileTraySlotRect(index, tray);
  return { xPx: slot.left + slot.width / 2, yPx: slot.top + slot.height / 2 };
}

export function tapTileBoardDownwardShiftPx(
  geometries: ReadonlyArray<{
    centerYPx: number;
    widthPx: number;
    heightPx: number;
    rotationDeg: number;
  }>,
  stageHeightPx = 1920,
): number {
  if (geometries.length === 0) return 0;
  const verticalBounds = geometries.map((geometry) => {
    const radians = (geometry.rotationDeg * Math.PI) / 180;
    const halfExtent = Math.abs(Math.sin(radians)) * geometry.widthPx / 2
      + Math.abs(Math.cos(radians)) * geometry.heightPx / 2;
    return { top: geometry.centerYPx - halfExtent, bottom: geometry.centerYPx + halfExtent };
  });
  const top = Math.min(...verticalBounds.map((bounds) => bounds.top));
  const bottom = Math.max(...verticalBounds.map((bounds) => bounds.bottom));
  const required = Math.max(0, Math.ceil(TAPTILE_REFERENCE_BOARD_TOP_PX - top));
  const available = Math.max(0, Math.floor(stageHeightPx - bottom));
  return Math.min(required, available);
}
