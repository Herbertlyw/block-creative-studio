import type { GameDefinition } from '../../game-runtime/contracts';
import type { GameSnapshot, GameTransition } from '../../domain/types';
import { blockPlacementLegacyRuntime } from './legacyRuntime';
import { blockPlacementManifest } from './manifest';
import {
  blockPlacementSchemas,
  type BlockPlacementConfig,
  type BlockPlacementSemanticAction,
} from './schemas';

export const blockPlacementDefinition: GameDefinition<
  BlockPlacementConfig,
  GameSnapshot,
  BlockPlacementSemanticAction,
  GameTransition
> = {
  manifest: blockPlacementManifest,
  schemas: blockPlacementSchemas,
  runtime: blockPlacementLegacyRuntime,
};
