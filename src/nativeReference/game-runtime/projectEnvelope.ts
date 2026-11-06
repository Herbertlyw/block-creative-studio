import type { AssetRef, OutputSpec } from '../headless/contracts';
import type { GameReplayEnvelope } from './replayEnvelope';

export const GAME_PROJECT_CONTRACT = 'bcs.game-project' as const;
export const GAME_PROJECT_CONTRACT_VERSION = '1.0.0' as const;
export const STUDIO_PROJECT_V2_FORMAT = 'bcs-studio-project' as const;
export const STUDIO_PROJECT_V2_VERSION = '2.0.0' as const;

export interface GameProjectEnvelope {
  contract: typeof GAME_PROJECT_CONTRACT;
  contractVersion: typeof GAME_PROJECT_CONTRACT_VERSION;
  game: {
    id: string;
    moduleVersion: string;
    rulesetId: string;
    rulesetVersion: string;
  };
  config: {
    schemaId: string;
    data: unknown;
  };
  initialState: {
    schemaId: string;
    data: unknown;
    stateHash: string;
  };
}

export interface StudioProjectProductionV2 {
  layoutProfileRef: AssetRef;
  cameraProfileRef: AssetRef;
  lookPackRef: AssetRef;
  output: OutputSpec;
}

export interface StudioProjectDirectionV2 {
  rhythm: unknown;
  style?: unknown;
  /** Versioned production controls; validated by the production service. */
  production?: unknown;
}

export interface StudioProjectDocumentV2 {
  format: typeof STUDIO_PROJECT_V2_FORMAT;
  version: typeof STUDIO_PROJECT_V2_VERSION;
  id: string;
  name: string;
  game: GameProjectEnvelope;
  production: StudioProjectProductionV2;
  takes: GameReplayEnvelope[];
  direction?: StudioProjectDirectionV2;
}

export interface ProjectMigrationReport {
  sourceFormat: string;
  sourceVersion: string;
  sourceHash: string;
  targetFormat: string;
  targetVersion: string;
  targetHash: string;
  gameId: string;
  moduleVersion: string;
  rulesetVersion: string;
  actionCount: number;
  interactionCount: number;
  warnings: string[];
}
