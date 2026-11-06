export interface PixelSize {
  width: number;
  height: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompositionProfile {
  id: string;
  version: string;
  gameId: string;
  designResolution: PixelSize;
  videoResolution: PixelSize;
  playfield: PixelRect;
}

export interface ContainMapping {
  scale: number;
  offsetX: number;
  offsetY: number;
  drawWidth: number;
  drawHeight: number;
  source: PixelSize;
  target: PixelSize;
}

/**
 * Maps a source rectangle into a target rectangle with contain (letterbox),
 * never stretch.
 */
export function containMapping(source: PixelSize, target: PixelSize): ContainMapping {
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

/**
 * Maps a source rectangle into a target rectangle with cover (crop), never
 * stretching. The target is completely filled; overflow is clipped by the
 * destination canvas. This is used by vertical video export where letterbox
 * bars are not part of the requested composition.
 */
export function coverMapping(source: PixelSize, target: PixelSize): ContainMapping {
  const scale = Math.max(target.width / source.width, target.height / source.height);
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

export function mapComposition(profile: CompositionProfile): ContainMapping {
  return containMapping(profile.designResolution, profile.videoResolution);
}

export function mapPointThroughContain(
  mapping: ContainMapping,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: mapping.offsetX + x * mapping.scale,
    y: mapping.offsetY + y * mapping.scale,
  };
}

export function mapRectThroughContain(mapping: ContainMapping, rect: PixelRect): PixelRect {
  return {
    x: mapping.offsetX + rect.x * mapping.scale,
    y: mapping.offsetY + rect.y * mapping.scale,
    width: rect.width * mapping.scale,
    height: rect.height * mapping.scale,
  };
}

export function boardRectInSpace(
  profile: CompositionProfile,
  space: 'design' | 'video',
): PixelRect {
  if (space === 'design') {
    return { ...profile.playfield };
  }
  return mapRectThroughContain(mapComposition(profile), profile.playfield);
}

export function videoCompositionAspect(profile: CompositionProfile): number {
  return profile.videoResolution.width / profile.videoResolution.height;
}

export function mapDesignPointThroughProfile(
  profile: CompositionProfile,
  x: number,
  y: number,
): { x: number; y: number } {
  return mapPointThroughContain(mapComposition(profile), x, y);
}

export function designToDisplayMappingForProfile(
  profile: CompositionProfile,
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): ContainMapping {
  const dpr = Math.max(0.5, Math.min(3, devicePixelRatio));
  return containMapping(profile.designResolution, {
    width: Math.max(1, cssWidth * dpr),
    height: Math.max(1, cssHeight * dpr),
  });
}
