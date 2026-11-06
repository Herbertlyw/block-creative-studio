import type { AssetRef, OutputSpec } from './contracts.js';
import type { GameRegistry } from '../game-runtime/gameRegistry.js';
import type { GameRenderContract } from '../game-runtime/renderContract.js';
import {
  validateStudioProjectDocumentV2,
  type ValidatedStudioProjectDocumentV2,
} from '../game-runtime/projectDocument.js';

export const CREATIVE_MASTER_V2_CONTRACT = 'bcs.creative-master-v2' as const;
export const CREATIVE_MASTER_V2_CONTRACT_VERSION = '2.0.0' as const;
export const PLAN_SCHEMA_VERSION_V2 = '2.0.0' as const;

export interface CreativeMasterV2GameRef {
  id: string;
  moduleVersion: string;
  rulesetId: string;
  rulesetVersion: string;
}

export interface CreativeMasterV2 {
  contract: typeof CREATIVE_MASTER_V2_CONTRACT;
  contractVersion: typeof CREATIVE_MASTER_V2_CONTRACT_VERSION;
  id: string;
  game: CreativeMasterV2GameRef;
  renderContractId: string;
  renderContractVersion: string;
  compositionProfileId?: string;
  replay: {
    takeId: string;
    semanticHash: string;
    frameHash?: string;
    fps: number;
    totalFrames: number;
  };
  layoutProfileRef: AssetRef;
  cameraProfileRef: AssetRef;
  baseOutput: OutputSpec;
}

export type AnyCreativeMaster = import('./contracts.js').CreativeMaster | CreativeMasterV2;

export function isCreativeMasterV2(value: AnyCreativeMaster): value is CreativeMasterV2 {
  return value.contract === CREATIVE_MASTER_V2_CONTRACT;
}

export function buildCreativeMasterV2FromValidated(
  validated: ValidatedStudioProjectDocumentV2,
  input: {
    id: string;
    takeId: string;
    renderContract: GameRenderContract;
    fps: number;
    totalFrames: number;
    semanticHash: string;
    frameHash?: string;
    compositionProfileId?: string;
  },
): CreativeMasterV2 {
  const take = validated.takes.find((item) => item.takeId === input.takeId);
  if (!take) {
    throw new Error(`Take ${input.takeId} is not in the validated document.`);
  }
  const master: CreativeMasterV2 = {
    contract: CREATIVE_MASTER_V2_CONTRACT,
    contractVersion: CREATIVE_MASTER_V2_CONTRACT_VERSION,
    id: input.id,
    game: { ...validated.game.game },
    renderContractId: input.renderContract.id,
    renderContractVersion: input.renderContract.version,
    replay: {
      takeId: input.takeId,
      semanticHash: input.semanticHash,
      fps: input.fps,
      totalFrames: input.totalFrames,
    },
    layoutProfileRef: { ...validated.production.layoutProfileRef },
    cameraProfileRef: { ...validated.production.cameraProfileRef },
    baseOutput: { ...validated.production.output },
  };
  if (input.frameHash !== undefined) master.replay.frameHash = input.frameHash;
  if (input.compositionProfileId !== undefined) master.compositionProfileId = input.compositionProfileId;
  return master;
}

export function buildCreativeMasterV2(
  document: unknown,
  registry: GameRegistry,
  input: Parameters<typeof buildCreativeMasterV2FromValidated>[1],
): CreativeMasterV2 {
  return buildCreativeMasterV2FromValidated(validateStudioProjectDocumentV2(document, registry), input);
}
