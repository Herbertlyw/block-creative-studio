/** Native Reference 2D design canvas. Must stay identical to REFERENCE_CANVAS. */
export const DESIGN_RESOLUTION = {
  width: 1064,
  height: 1788,
} as const;

export const DESIGN_BOARD_OUTER = { x: 80, y: 309, size: 912 } as const;

export const VIDEO_RESOLUTION = {
  width: 1080,
  height: 1920,
} as const;

export interface ContainMapping {
  scale: number;
  offsetX: number;
  offsetY: number;
  drawWidth: number;
  drawHeight: number;
  source: { width: number; height: number };
  target: { width: number; height: number };
}

/**
 * Maps a source rectangle into a target rectangle with contain (letterbox),
 * never stretch. This is the only allowed 1064×1788 → 1080×1920 mapping.
 *
 * Transitional reference-transfer only — not a finished 9:16 production framing
 * profile. Letterboxed video edges are expected until a native 1080×1920 layout exists.
 */
export function containMapping(
  source: { width: number; height: number },
  target: { width: number; height: number },
): ContainMapping {
  const scale = Math.min(target.width / source.width, target.height / source.height);
  const drawWidth = source.width * scale;
  const drawHeight = source.height * scale;
  return {
    scale,
    offsetX: (target.width - drawWidth) / 2,
    offsetY: (target.height - drawHeight) / 2,
    drawWidth,
    drawHeight,
    source: { ...source },
    target: { ...target },
  };
}

export function designToVideoMapping(): ContainMapping {
  return containMapping(DESIGN_RESOLUTION, VIDEO_RESOLUTION);
}

export function designToDisplayMapping(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): ContainMapping {
  const dpr = Math.max(0.5, Math.min(3, devicePixelRatio));
  return containMapping(DESIGN_RESOLUTION, {
    width: Math.max(1, cssWidth * dpr),
    height: Math.max(1, cssHeight * dpr),
  });
}

export function mapDesignPointToVideo(x: number, y: number): { x: number; y: number } {
  const mapping = designToVideoMapping();
  return {
    x: mapping.offsetX + x * mapping.scale,
    y: mapping.offsetY + y * mapping.scale,
  };
}

export function boardScreenRectInSpace(
  space: 'design' | 'video',
): { x: number; y: number; width: number; height: number } {
  const rect = DESIGN_BOARD_OUTER;
  if (space === 'design') {
    return { x: rect.x, y: rect.y, width: rect.size, height: rect.size };
  }
  const mapping = designToVideoMapping();
  return {
    x: mapping.offsetX + rect.x * mapping.scale,
    y: mapping.offsetY + rect.y * mapping.scale,
    width: rect.size * mapping.scale,
    height: rect.size * mapping.scale,
  };
}

export function lockedCompositionAspect(): number {
  return VIDEO_RESOLUTION.width / VIDEO_RESOLUTION.height;
}
