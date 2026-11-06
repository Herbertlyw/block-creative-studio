import type { AssetRef, OutputSpec } from '../headless/contracts';
import { GameSchemaError } from './errors';
import {
  GAME_PROJECT_CONTRACT,
  GAME_PROJECT_CONTRACT_VERSION,
  STUDIO_PROJECT_V2_FORMAT,
  STUDIO_PROJECT_V2_VERSION,
  type GameProjectEnvelope,
  type StudioProjectDirectionV2,
  type StudioProjectDocumentV2,
  type StudioProjectProductionV2,
} from './projectEnvelope';
import {
  GAME_REPLAY_CONTRACT,
  GAME_REPLAY_CONTRACT_VERSION,
  type GameActionEnvelope,
  type GameReplayEnvelope,
  type InteractionRecord,
  type InteractionSample,
} from './replayEnvelope';

function fail(path: string, detail: string, code = 'INVALID_VALUE'): never {
  throw new GameSchemaError(code, `${path}: ${detail}`, { path });
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  return value as Record<string, unknown>;
}

function requireField(source: Record<string, unknown>, path: string, field: string): unknown {
  if (!(field in source)) fail(`${path}.${field}`, 'is required', 'MISSING_FIELD');
  return source[field];
}

function string(value: unknown, path: string, maximum = 240): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    fail(path, `must be a string of 1–${maximum} characters`);
  }
  return value;
}

function finite(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `must be a finite number between ${minimum} and ${maximum}`);
  }
  return value;
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
  const result = finite(value, path, minimum, maximum);
  if (!Number.isInteger(result)) fail(path, 'must be an integer');
  return result;
}

function parseAssetRef(value: unknown, path: string): AssetRef {
  const source = record(value, path);
  const ref: AssetRef = {
    id: string(requireField(source, path, 'id'), `${path}.id`, 180),
    version: string(requireField(source, path, 'version'), `${path}.version`, 80),
    kind: string(requireField(source, path, 'kind'), `${path}.kind`, 80) as AssetRef['kind'],
  };
  if ('contentHash' in source && source.contentHash !== undefined) {
    ref.contentHash = string(source.contentHash, `${path}.contentHash`, 200);
  }
  return ref;
}

function parseOutput(value: unknown, path: string): OutputSpec {
  const source = record(value, path);
  const quality = requireField(source, path, 'quality');
  if (quality !== 'preview' && quality !== 'standard' && quality !== 'cinematic') {
    fail(`${path}.quality`, 'must be preview, standard, or cinematic');
  }
  const output: OutputSpec = {
    width: integer(requireField(source, path, 'width'), `${path}.width`, 256, 4096),
    height: integer(requireField(source, path, 'height'), `${path}.height`, 256, 4096),
    fps: integer(requireField(source, path, 'fps'), `${path}.fps`, 1, 120),
    quality,
  };
  if (output.width % 2 !== 0 || output.height % 2 !== 0) {
    fail(path, 'H.264 output width and height must be even');
  }
  return output;
}

function parseSample(value: unknown, path: string): InteractionSample {
  const source = record(value, path);
  return {
    frameOffset: integer(requireField(source, path, 'frameOffset'), `${path}.frameOffset`, 0, 100_000),
    x: finite(requireField(source, path, 'x'), `${path}.x`, 0, 1),
    y: finite(requireField(source, path, 'y'), `${path}.y`, 0, 1),
  };
}

function parseInteraction(value: unknown, path: string): InteractionRecord {
  const source = record(value, path);
  const modality = requireField(source, path, 'modality');
  if (modality !== 'pointer' && modality !== 'touch' && modality !== 'tap' && modality !== 'system') {
    fail(`${path}.modality`, 'must be pointer, touch, tap, or system');
  }
  const interaction: InteractionRecord = {
    id: string(requireField(source, path, 'id'), `${path}.id`, 180),
    modality,
    startFrame: integer(requireField(source, path, 'startFrame'), `${path}.startFrame`, 0, 100_000),
    endFrame: integer(requireField(source, path, 'endFrame'), `${path}.endFrame`, 0, 100_000),
  };
  if (interaction.endFrame < interaction.startFrame) fail(`${path}.endFrame`, 'must be >= startFrame');
  if ('committedActionId' in source && source.committedActionId !== undefined) {
    interaction.committedActionId = string(source.committedActionId, `${path}.committedActionId`, 180);
  }
  if ('samples' in source && source.samples !== undefined) {
    if (!Array.isArray(source.samples) || source.samples.length > 10_000) {
      fail(`${path}.samples`, 'must be an array of at most 10000 samples');
    }
    interaction.samples = source.samples.map((sample, index) => parseSample(sample, `${path}.samples[${index}]`));
  }
  if ('metadata' in source && source.metadata !== undefined) {
    const metadata = record(source.metadata, `${path}.metadata`);
    interaction.metadata = metadata;
  }
  return interaction;
}

function parseReplayAction(value: unknown, path: string): GameActionEnvelope {
  const source = record(value, path);
  const actor = requireField(source, path, 'actor');
  if (actor !== 'human' && actor !== 'agent') fail(`${path}.actor`, 'must be human or agent');
  if (!('action' in source)) fail(`${path}.action`, 'is required', 'MISSING_FIELD');
  return {
    id: string(requireField(source, path, 'id'), `${path}.id`, 180),
    actor,
    schemaId: string(requireField(source, path, 'schemaId'), `${path}.schemaId`, 180),
    action: source.action,
  };
}

export function parseGameReplayEnvelope(value: unknown, path = '$'): GameReplayEnvelope {
  const source = record(value, path);
  if (source.contract !== GAME_REPLAY_CONTRACT) fail(`${path}.contract`, `must be ${GAME_REPLAY_CONTRACT}`);
  if (source.contractVersion !== GAME_REPLAY_CONTRACT_VERSION) {
    fail(`${path}.contractVersion`, `must be ${GAME_REPLAY_CONTRACT_VERSION}`);
  }
  const actionsValue = requireField(source, path, 'actions');
  const interactionsValue = requireField(source, path, 'interactions');
  if (!Array.isArray(actionsValue) || actionsValue.length > 500) fail(`${path}.actions`, 'must be an array of at most 500 actions');
  if (!Array.isArray(interactionsValue) || interactionsValue.length > 10_000) {
    fail(`${path}.interactions`, 'must be an array of at most 10000 interactions');
  }
  const actions = actionsValue.map((item, index) => parseReplayAction(item, `${path}.actions[${index}]`));
  if (new Set(actions.map((item) => item.id)).size !== actions.length) fail(`${path}.actions`, 'action ids must be unique');
  const interactions = interactionsValue.map((item, index) => parseInteraction(item, `${path}.interactions[${index}]`));
  if (new Set(interactions.map((item) => item.id)).size !== interactions.length) {
    fail(`${path}.interactions`, 'interaction ids must be unique');
  }
  return {
    contract: GAME_REPLAY_CONTRACT,
    contractVersion: GAME_REPLAY_CONTRACT_VERSION,
    gameId: string(requireField(source, path, 'gameId'), `${path}.gameId`, 180),
    moduleVersion: string(requireField(source, path, 'moduleVersion'), `${path}.moduleVersion`, 80),
    takeId: string(requireField(source, path, 'takeId'), `${path}.takeId`, 180),
    initialStateHash: string(requireField(source, path, 'initialStateHash'), `${path}.initialStateHash`, 200),
    seed: integer(requireField(source, path, 'seed'), `${path}.seed`, 0, 2_147_483_647),
    actions,
    interactions,
  };
}

export function parseGameProjectEnvelope(value: unknown, path = '$'): GameProjectEnvelope {
  const source = record(value, path);
  if (source.contract !== GAME_PROJECT_CONTRACT) fail(`${path}.contract`, `must be ${GAME_PROJECT_CONTRACT}`);
  if (source.contractVersion !== GAME_PROJECT_CONTRACT_VERSION) {
    fail(`${path}.contractVersion`, `must be ${GAME_PROJECT_CONTRACT_VERSION}`);
  }
  const game = record(requireField(source, path, 'game'), `${path}.game`);
  const config = record(requireField(source, path, 'config'), `${path}.config`);
  const initialState = record(requireField(source, path, 'initialState'), `${path}.initialState`);
  if (!('data' in config)) fail(`${path}.config.data`, 'is required', 'MISSING_FIELD');
  if (!('data' in initialState)) fail(`${path}.initialState.data`, 'is required', 'MISSING_FIELD');
  return {
    contract: GAME_PROJECT_CONTRACT,
    contractVersion: GAME_PROJECT_CONTRACT_VERSION,
    game: {
      id: string(requireField(game, `${path}.game`, 'id'), `${path}.game.id`, 180),
      moduleVersion: string(requireField(game, `${path}.game`, 'moduleVersion'), `${path}.game.moduleVersion`, 80),
      rulesetId: string(requireField(game, `${path}.game`, 'rulesetId'), `${path}.game.rulesetId`, 180),
      rulesetVersion: string(requireField(game, `${path}.game`, 'rulesetVersion'), `${path}.game.rulesetVersion`, 80),
    },
    config: {
      schemaId: string(requireField(config, `${path}.config`, 'schemaId'), `${path}.config.schemaId`, 180),
      data: config.data,
    },
    initialState: {
      schemaId: string(requireField(initialState, `${path}.initialState`, 'schemaId'), `${path}.initialState.schemaId`, 180),
      data: initialState.data,
      stateHash: string(requireField(initialState, `${path}.initialState`, 'stateHash'), `${path}.initialState.stateHash`, 200),
    },
  };
}

function parseProduction(value: unknown, path: string): StudioProjectProductionV2 {
  const source = record(value, path);
  return {
    layoutProfileRef: parseAssetRef(requireField(source, path, 'layoutProfileRef'), `${path}.layoutProfileRef`),
    cameraProfileRef: parseAssetRef(requireField(source, path, 'cameraProfileRef'), `${path}.cameraProfileRef`),
    lookPackRef: parseAssetRef(requireField(source, path, 'lookPackRef'), `${path}.lookPackRef`),
    output: parseOutput(requireField(source, path, 'output'), `${path}.output`),
  };
}

function parseDirection(value: unknown, path: string): StudioProjectDirectionV2 {
  const source = record(value, path);
  const direction: StudioProjectDirectionV2 = {
    rhythm: requireField(source, path, 'rhythm'),
  };
  if ('style' in source && source.style !== undefined) direction.style = source.style;
  if ('production' in source && source.production !== undefined) direction.production = record(source.production, `${path}.production`);
  return direction;
}

export function parseStudioProjectDocumentV2(value: unknown, path = '$'): StudioProjectDocumentV2 {
  const source = record(value, path);
  if (source.format !== STUDIO_PROJECT_V2_FORMAT) fail(`${path}.format`, `must be ${STUDIO_PROJECT_V2_FORMAT}`);
  if (source.version !== STUDIO_PROJECT_V2_VERSION) fail(`${path}.version`, `must be ${STUDIO_PROJECT_V2_VERSION}`);
  const takesValue = requireField(source, path, 'takes');
  if (!Array.isArray(takesValue) || takesValue.length > 500) fail(`${path}.takes`, 'must be an array of at most 500 takes');
  const takes = takesValue.map((take, index) => parseGameReplayEnvelope(take, `${path}.takes[${index}]`));
  if (new Set(takes.map((take) => take.takeId)).size !== takes.length) fail(`${path}.takes`, 'take ids must be unique');
  const document: StudioProjectDocumentV2 = {
    format: STUDIO_PROJECT_V2_FORMAT,
    version: STUDIO_PROJECT_V2_VERSION,
    id: string(requireField(source, path, 'id'), `${path}.id`, 180),
    name: string(requireField(source, path, 'name'), `${path}.name`, 240),
    game: parseGameProjectEnvelope(requireField(source, path, 'game'), `${path}.game`),
    production: parseProduction(requireField(source, path, 'production'), `${path}.production`),
    takes,
  };
  if ('direction' in source && source.direction !== undefined) {
    document.direction = parseDirection(source.direction, `${path}.direction`);
  }
  return document;
}

export function detectStudioDocumentKind(value: unknown): 'v1' | 'v2' | 'unknown' {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown';
  const source = value as Record<string, unknown>;
  if (source.format === STUDIO_PROJECT_V2_FORMAT && source.version === STUDIO_PROJECT_V2_VERSION) return 'v2';
  if (source.format === 'block-creative-studio-project' && source.version === '1.0.0') return 'v1';
  return 'unknown';
}
