import type { FixedCameraProfile } from '../../../assets/semanticAssetTypes';
import { BLOCK_PLACEMENT_GAME_ID } from '../manifest';
import { BLOCK_PLACEMENT_COMPOSITION_PROFILE_ID, blockPlacementCompositionProfile } from './composition';

export const BLOCK_PLACEMENT_FIXED_CAMERA_PROFILE_ID = 'block-garden-fixed-camera-draft-v1';
export const BLOCK_PLACEMENT_SHOT_PROFILE_ID = 'block-garden-fixed-shot-v1';

export const blockPlacementFixedCameraDraft = {
  id: BLOCK_PLACEMENT_FIXED_CAMERA_PROFILE_ID,
  designResolution: {
    width: blockPlacementCompositionProfile.designResolution.width,
    height: blockPlacementCompositionProfile.designResolution.height,
  },
  boardScreenRect: {
    x: blockPlacementCompositionProfile.playfield.x,
    y: blockPlacementCompositionProfile.playfield.y,
    width: blockPlacementCompositionProfile.playfield.width,
    height: blockPlacementCompositionProfile.playfield.height,
  },
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
} as const satisfies FixedCameraProfile;

export const blockPlacementShotProfile = {
  id: BLOCK_PLACEMENT_SHOT_PROFILE_ID,
  gameId: BLOCK_PLACEMENT_GAME_ID,
  compositionProfileId: BLOCK_PLACEMENT_COMPOSITION_PROFILE_ID,
  cameraProfileId: blockPlacementFixedCameraDraft.id,
  designResolution: blockPlacementCompositionProfile.designResolution,
  videoResolution: blockPlacementCompositionProfile.videoResolution,
  compositionAspect:
    blockPlacementCompositionProfile.videoResolution.width
    / blockPlacementCompositionProfile.videoResolution.height,
  verticalFovDegrees: 42,
  contentWidth: 9.05,
  contentHeight: 13.8,
  widthFill: 0.89,
  heightFill: 0.9,
  baseDistance: 17.6,
  lookAt: [0, -0.05, 0.15] as const,
  cameraOffset: { x: 0.12, y: -1.1 },
  maximumScreenZoom: blockPlacementFixedCameraDraft.motionPolicy.maximumScreenZoom,
  boardScreenRect: blockPlacementFixedCameraDraft.boardScreenRect,
  boardWorld: { minYOffset: -1.2, maxYOffset: 0.4 },
} as const;
