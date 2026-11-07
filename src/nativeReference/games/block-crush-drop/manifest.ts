import type { GameManifest } from '../../game-runtime/contracts';

export const BLOCK_CRUSH_DROP_GAME_ID = 'block-crush-drop' as const;
export const BLOCK_CRUSH_DROP_MODULE_VERSION = '0.4.0' as const;
export const BLOCK_CRUSH_DROP_RULESET_ID = 'block-crush-drop-tray-drag-rising-cuts-v1' as const;
export const BLOCK_CRUSH_DROP_RULESET_VERSION = '1.0.0' as const;

export const BLOCK_CRUSH_DROP_CONFIG_SCHEMA_ID = 'bcs.runtime.block-crush-drop.config';
export const BLOCK_CRUSH_DROP_STATE_SCHEMA_ID = 'bcs.runtime.block-crush-drop.state';
export const BLOCK_CRUSH_DROP_ACTION_SCHEMA_ID = 'bcs.runtime.block-crush-drop.action';
export const BLOCK_CRUSH_DROP_SCHEMA_VERSION = '4.0.0';

export const blockCrushDropManifest: GameManifest = {
  gameId: BLOCK_CRUSH_DROP_GAME_ID,
  moduleVersion: BLOCK_CRUSH_DROP_MODULE_VERSION,
  displayName: 'block 落消',
  topology: 'grid-2d',
  rulesetId: BLOCK_CRUSH_DROP_RULESET_ID,
  rulesetVersion: BLOCK_CRUSH_DROP_RULESET_VERSION,
  capabilities: [
    'elimination-resolution-trace.v1',
    'interaction-trajectory.v1',
    'timed-world-state.v1',
    'overlapping-presentation-effects.v1',
    'camera-strategy.v1',
  ],
};
