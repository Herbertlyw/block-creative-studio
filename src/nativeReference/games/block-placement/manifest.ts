import type { GameManifest } from '../../game-runtime/contracts';

export const BLOCK_PLACEMENT_GAME_ID = 'block-placement';
export const BLOCK_PLACEMENT_MODULE_VERSION = '1.0.0';
export const BLOCK_PLACEMENT_RULESET_ID = 'block-placement-classic-v1';
export const BLOCK_PLACEMENT_RULESET_VERSION = '1.0.0';

export const BLOCK_PLACEMENT_CONFIG_SCHEMA_ID = 'bcs.runtime.block-placement.config';
export const BLOCK_PLACEMENT_STATE_SCHEMA_ID = 'bcs.runtime.block-placement.state';
export const BLOCK_PLACEMENT_ACTION_SCHEMA_ID = 'bcs.runtime.block-placement.action';
export const BLOCK_PLACEMENT_SEMANTIC_ACTION_SCHEMA_ID = 'bcs.runtime.block-placement.semantic-action';
export const BLOCK_PLACEMENT_SCHEMA_VERSION = '1.0.0';

export const blockPlacementManifest: GameManifest = {
  gameId: BLOCK_PLACEMENT_GAME_ID,
  moduleVersion: BLOCK_PLACEMENT_MODULE_VERSION,
  displayName: 'block 拖消',
  topology: 'grid-2d',
  rulesetId: BLOCK_PLACEMENT_RULESET_ID,
  rulesetVersion: BLOCK_PLACEMENT_RULESET_VERSION,
};
