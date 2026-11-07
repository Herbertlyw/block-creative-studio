export const DEFAULT_TAPTILE_SNAP_GAP_PX = 0;
export const MIN_TAPTILE_SNAP_GAP_PX = -32;
export const MAX_TAPTILE_SNAP_GAP_PX = 32;

export function normalizeTapTileSnapGapPx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TAPTILE_SNAP_GAP_PX;
  return Math.max(
    MIN_TAPTILE_SNAP_GAP_PX,
    Math.min(MAX_TAPTILE_SNAP_GAP_PX, Math.round(value)),
  );
}

export function formatTapTileSnapGapPx(value: number): string {
  const normalized = normalizeTapTileSnapGapPx(value);
  return `${normalized > 0 ? '+' : ''}${normalized}px`;
}
