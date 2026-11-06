import { GameSchemaError } from './errors';
import type { GameRegistry } from './gameRegistry';
import { definitionSchemas } from './gameRegistry';
import type { PresentationRegistry } from './presentationRegistry';
import type { CompiledFrameSource } from './frameSource';
import { parseStudioProjectDocumentV2 } from './projectParser';
import type { StudioProjectDocumentV2 } from './projectEnvelope';
import type { GameReplayEnvelope, InteractionRecord, InteractionSample } from './replayEnvelope';
import type { RuntimeSchema } from './contracts';

export interface ValidatedReplayTake {
  replay: GameReplayEnvelope;
  actions: unknown[];
}

export interface ValidatedStudioProjectDocumentV2 extends StudioProjectDocumentV2 {
  parsed: {
    config: unknown;
    initialState: unknown;
    takes: ValidatedReplayTake[];
  };
}

function fail(path: string, detail: string, code = 'INVALID_VALUE'): never {
  throw new GameSchemaError(code, `${path}: ${detail}`, { path });
}

function schemaById(schemas: RuntimeSchema<unknown>[], schemaId: string, path: string): RuntimeSchema<unknown> {
  const found = schemas.find((item) => item.id === schemaId);
  if (!found) {
    fail(path, `schema ${schemaId} is not owned by this game`, 'SCHEMA_NOT_IN_GAME');
  }
  return found;
}

function assertMonotonicSamples(samples: InteractionSample[], startFrame: number, endFrame: number, path: string): void {
  const duration = endFrame - startFrame;
  let previous = -1;
  for (const [index, sample] of samples.entries()) {
    if (sample.frameOffset < previous) {
      fail(`${path}[${index}].frameOffset`, 'must be non-decreasing', 'INTERACTION_SAMPLE_INVALID');
    }
    if (sample.frameOffset < 0 || sample.frameOffset > duration) {
      fail(
        `${path}[${index}].frameOffset`,
        `must fall within the interaction window 0–${duration}`,
        'INTERACTION_SAMPLE_INVALID',
      );
    }
    previous = sample.frameOffset;
  }
}

function assertInteraction(interaction: InteractionRecord, actionIds: Set<string>, path: string): void {
  if (interaction.committedActionId !== undefined && !actionIds.has(interaction.committedActionId)) {
    fail(
      `${path}.committedActionId`,
      `does not point to an action (${interaction.committedActionId})`,
      'UNKNOWN_ACTION',
    );
  }
  if (interaction.samples) {
    assertMonotonicSamples(interaction.samples, interaction.startFrame, interaction.endFrame, `${path}.samples`);
  }
}

export function validateStudioProjectDocumentV2(
  document: unknown,
  registry: GameRegistry,
): ValidatedStudioProjectDocumentV2 {
  const parsed = parseStudioProjectDocumentV2(document);
  const definition = registry.require(parsed.game.game.id, parsed.game.game.moduleVersion);
  const manifest = definition.manifest;
  if (manifest.rulesetId !== undefined && parsed.game.game.rulesetId !== manifest.rulesetId) {
    fail('$.game.game.rulesetId', `must be ${manifest.rulesetId}`, 'RULESET_MISMATCH');
  }
  if (manifest.rulesetVersion !== undefined && parsed.game.game.rulesetVersion !== manifest.rulesetVersion) {
    fail('$.game.game.rulesetVersion', `must be ${manifest.rulesetVersion}`, 'RULESET_MISMATCH');
  }

  const owned = definitionSchemas(definition);
  const configSchema = schemaById(owned, parsed.game.config.schemaId, '$.game.config.schemaId');
  if (configSchema.id !== definition.schemas.config.id) {
    fail('$.game.config.schemaId', `must be ${definition.schemas.config.id}`, 'SCHEMA_MISMATCH');
  }
  const stateSchema = schemaById(owned, parsed.game.initialState.schemaId, '$.game.initialState.schemaId');
  if (stateSchema.id !== definition.schemas.state.id) {
    fail('$.game.initialState.schemaId', `must be ${definition.schemas.state.id}`, 'SCHEMA_MISMATCH');
  }

  const config = configSchema.parse(parsed.game.config.data);
  const initialState = stateSchema.parse(parsed.game.initialState.data);
  const stateHash = definition.runtime.hashState(initialState);
  if (stateHash !== parsed.game.initialState.stateHash) {
    fail('$.game.initialState.stateHash', 'does not match the parsed initial state', 'STATE_HASH_MISMATCH');
  }

  const takes: ValidatedReplayTake[] = parsed.takes.map((replay, takeIndex) => {
    const takePath = `$.takes[${takeIndex}]`;
    if (replay.gameId !== parsed.game.game.id || replay.moduleVersion !== parsed.game.game.moduleVersion) {
      fail(`${takePath}.gameId`, 'must match the project game id and module version', 'GAME_MISMATCH');
    }
    if (replay.initialStateHash !== parsed.game.initialState.stateHash) {
      fail(`${takePath}.initialStateHash`, 'must match the parsed project initial state hash', 'STATE_HASH_MISMATCH');
    }
    const actionIds = new Set(replay.actions.map((item) => item.id));
    const actions = replay.actions.map((envelope, actionIndex) => {
      const actionPath = `${takePath}.actions[${actionIndex}]`;
      const actionSchema = schemaById(owned, envelope.schemaId, `${actionPath}.schemaId`);
      if (actionSchema.id !== definition.schemas.action.id) {
        fail(`${actionPath}.schemaId`, `must be the semantic action schema ${definition.schemas.action.id}`, 'SCHEMA_MISMATCH');
      }
      return actionSchema.parse(envelope.action);
    });
    for (const [interactionIndex, interaction] of replay.interactions.entries()) {
      assertInteraction(interaction, actionIds, `${takePath}.interactions[${interactionIndex}]`);
    }
    return { replay, actions };
  });

  return {
    ...parsed,
    parsed: {
      config,
      initialState,
      takes,
    },
  };
}

export function compileFrameSourceFromDocument(
  document: unknown,
  registries: { games: GameRegistry; presentations: PresentationRegistry },
  input: { takeId: string; directorProfile: unknown; fps: number },
): CompiledFrameSource {
  const validated = validateStudioProjectDocumentV2(document, registries.games);
  const take = validated.takes.find((item) => item.takeId === input.takeId);
  if (!take) {
    fail('$.takes', `take ${input.takeId} is not in the document`, 'UNKNOWN_TAKE');
  }
  return registries.presentations.require(validated.game.game.id).compile({
    project: validated.game,
    replay: take,
    directorProfile: input.directorProfile,
    fps: input.fps,
  });
}
