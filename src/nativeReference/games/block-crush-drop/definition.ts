import type { GameDefinition } from '../../game-runtime/contracts';
import { blockCrushDropManifest } from './manifest';
import { blockCrushDropRuntime } from './runtime';
import { blockCrushDropSchemas } from './schemas';
import type {
  BlockCrushDropAction,
  BlockCrushDropConfig,
  BlockCrushDropResolution,
  BlockCrushDropState,
} from './types';

export const blockCrushDropDefinition: GameDefinition<
  BlockCrushDropConfig,
  BlockCrushDropState,
  BlockCrushDropAction,
  BlockCrushDropResolution
> = {
  manifest: blockCrushDropManifest,
  schemas: blockCrushDropSchemas,
  runtime: blockCrushDropRuntime,
};
