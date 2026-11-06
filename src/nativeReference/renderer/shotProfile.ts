import { blockPlacementShotProfile } from '../games/block-placement/profiles/fixedCamera';
import { perspectiveDistanceToFitFrame } from './cameraFraming';

export const FIXED_SHOT_PROFILE = blockPlacementShotProfile;

export type ShotProfileLike = {
  compositionAspect: number;
  verticalFovDegrees: number;
  contentWidth: number;
  contentHeight: number;
  widthFill: number;
  heightFill: number;
  baseDistance: number;
  lookAt: readonly [number, number, number];
  cameraOffset: { x: number; y: number };
  maximumScreenZoom: number;
  boardScreenRect: { x: number; y: number; width: number; height: number };
  designResolution: { width: number; height: number };
  boardWorld?: { minYOffset: number; maxYOffset: number };
};

export interface ContainedViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function containedCompositionViewport(
  canvasWidth: number,
  canvasHeight: number,
  aspect = FIXED_SHOT_PROFILE.compositionAspect,
): ContainedViewport {
  const targetAspect = aspect;
  const canvasAspect = canvasWidth / Math.max(1, canvasHeight);
  if (canvasAspect > targetAspect) {
    const width = canvasHeight * targetAspect;
    return { x: (canvasWidth - width) / 2, y: 0, width, height: canvasHeight };
  }
  const height = canvasWidth / targetAspect;
  return { x: 0, y: (canvasHeight - height) / 2, width: canvasWidth, height };
}

export function lockedCameraDistance(punch = 0, shot: ShotProfileLike = FIXED_SHOT_PROFILE): number {
  const fitted = perspectiveDistanceToFitFrame({
    verticalFovDegrees: shot.verticalFovDegrees,
    aspect: shot.compositionAspect,
    contentWidth: shot.contentWidth,
    contentHeight: shot.contentHeight,
    widthFill: shot.widthFill,
    heightFill: shot.heightFill,
    minimumDistance: shot.baseDistance,
  });
  const zoom = Math.min(shot.maximumScreenZoom, 1 + punch * 0.02);
  return fitted / zoom;
}

export function boardWorldBounds(shot: ShotProfileLike = FIXED_SHOT_PROFILE): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const half = shot.contentWidth / 2;
  const minYOffset = shot.boardWorld?.minYOffset ?? FIXED_SHOT_PROFILE.boardWorld.minYOffset;
  const maxYOffset = shot.boardWorld?.maxYOffset ?? FIXED_SHOT_PROFILE.boardWorld.maxYOffset;
  return { minX: -half, maxX: half, minY: -half + minYOffset, maxY: half + maxYOffset };
}

export function viewportPolicyForRenderer(
  renderer: 'reference-2d' | 'three-3d' | 'fixed-camera-cinematic' | 'moving-camera-cinematic',
  width: number,
  height: number,
  shot: ShotProfileLike = FIXED_SHOT_PROFILE,
): {
  aspect: number;
  viewport: ContainedViewport;
  scissorTest: boolean;
} {
  if (renderer === 'fixed-camera-cinematic' || renderer === 'moving-camera-cinematic') {
    return {
      aspect: shot.compositionAspect,
      viewport: containedCompositionViewport(width, height, shot.compositionAspect),
      scissorTest: true,
    };
  }
  return {
    aspect: width / Math.max(1, height),
    viewport: { x: 0, y: 0, width, height },
    scissorTest: false,
  };
}

export interface ClientRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CompositionPointer {
  inside: boolean;
  canvasX: number;
  canvasY: number;
  compositionX: number;
  compositionY: number;
  ndcX: number;
  ndcY: number;
}

/**
 * Map a DOM client point into the renderer composition.
 * `canvasWidth/Height` are CSS pixels (same space as `viewportPolicyForRenderer`);
 * device pixel ratio is applied by Three.js when issuing gl.viewport, not here.
 */
export function mapClientPointToComposition(input: {
  clientX: number;
  clientY: number;
  rect: ClientRectLike;
  renderer: 'reference-2d' | 'three-3d' | 'fixed-camera-cinematic' | 'moving-camera-cinematic';
  canvasWidth: number;
  canvasHeight: number;
  shot?: ShotProfileLike;
}): CompositionPointer {
  const scaleX = input.canvasWidth / Math.max(1e-6, input.rect.width);
  const scaleY = input.canvasHeight / Math.max(1e-6, input.rect.height);
  const canvasX = (input.clientX - input.rect.left) * scaleX;
  const canvasY = (input.clientY - input.rect.top) * scaleY;
  const viewport = viewportPolicyForRenderer(
    input.renderer,
    input.canvasWidth,
    input.canvasHeight,
    input.shot ?? FIXED_SHOT_PROFILE,
  ).viewport;
  const inside =
    canvasX >= viewport.x
    && canvasX <= viewport.x + viewport.width
    && canvasY >= viewport.y
    && canvasY <= viewport.y + viewport.height;
  const compositionX = viewport.width <= 0 ? 0 : (canvasX - viewport.x) / viewport.width;
  const compositionY = viewport.height <= 0 ? 0 : (canvasY - viewport.y) / viewport.height;
  return {
    inside,
    canvasX,
    canvasY,
    compositionX,
    compositionY,
    ndcX: compositionX * 2 - 1,
    ndcY: -(compositionY * 2 - 1),
  };
}

/** Three.js viewport Y is from the bottom of the drawing buffer. */
export function webglViewportFromCss(viewport: ContainedViewport, canvasHeight: number): ContainedViewport {
  return {
    x: viewport.x,
    y: canvasHeight - viewport.y - viewport.height,
    width: viewport.width,
    height: viewport.height,
  };
}
