import type { FixedCameraProfile } from './semanticAssetTypes';

/**
 * Screen-space truth for the first reference profile.
 *
 * Physical lens selection is intentionally left pending. The supplied
 * reference recording proves the final screen layout, but not whether its
 * source was orthographic, long-lens perspective, or a fully 2D composition.
 */
export const BLOCK_GARDEN_FIXED_CAMERA_DRAFT: FixedCameraProfile = {
  id: 'block-garden-fixed-camera-draft-v1',
  designResolution: { width: 1064, height: 1788 },
  boardScreenRect: { x: 80, y: 309, width: 912, height: 912 },
  pose: {
    position: [0, 0, 18],
    rotationEulerRadians: [0, 0, 0],
  },
  projection: { mode: 'calibration-pending' },
  motionPolicy: {
    transformAnimation: false,
    orbit: false,
    lensAnimation: false,
    screenShake: true,
    screenTranslate: true,
    screenZoom: true,
    maximumScreenZoom: 1.03,
    maximumScreenRotationDegrees: 0.6,
  },
};
