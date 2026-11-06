import type { CompositionProfile } from '../../../rendering/composition';
import { BLOCK_PLACEMENT_GAME_ID } from '../manifest';

export const BLOCK_PLACEMENT_COMPOSITION_PROFILE_ID = 'block-placement.composition.v1';
export const BLOCK_PLACEMENT_COMPOSITION_PROFILE_VERSION = '1.0.0';

export const blockPlacementCompositionProfile = {
  id: BLOCK_PLACEMENT_COMPOSITION_PROFILE_ID,
  version: BLOCK_PLACEMENT_COMPOSITION_PROFILE_VERSION,
  gameId: BLOCK_PLACEMENT_GAME_ID,
  designResolution: { width: 1064, height: 1788 },
  videoResolution: { width: 1080, height: 1920 },
  playfield: { x: 80, y: 309, width: 912, height: 912 },
} as const satisfies CompositionProfile;
