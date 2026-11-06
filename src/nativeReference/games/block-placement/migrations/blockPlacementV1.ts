import {productionFromDocument} from '../../../agent-director/contracts';
import { compileTake } from '../../../director/presentationCompiler';
import { createGame, replayActions } from '../../../domain/gameEngine';
import { parseStudioBundle, type StudioBundle } from '../../../domain/projectValidation';
import type { GameSnapshot, PlacementAction, RhythmProfile, Take } from '../../../domain/types';
import { GameSchemaError } from '../../../game-runtime/errors';
import {
  GAME_PROJECT_CONTRACT,
  GAME_PROJECT_CONTRACT_VERSION,
  STUDIO_PROJECT_V2_FORMAT,
  STUDIO_PROJECT_V2_VERSION,
  type GameProjectEnvelope,
  type ProjectMigrationReport,
  type StudioProjectDocumentV2,
} from '../../../game-runtime/projectEnvelope';
import { GameRegistry } from '../../../game-runtime/gameRegistry';
import { validateStudioProjectDocumentV2 } from '../../../game-runtime/projectDocument';
import type { ProjectMigrationAdapter } from '../../../game-runtime/projectMigrationRegistry';
import { blockPlacementDefinition } from '../definition';
import {
  GAME_REPLAY_CONTRACT,
  GAME_REPLAY_CONTRACT_VERSION,
  frameReplayIdentity,
  semanticReplayIdentity,
  splitPointerPlacement,
  type GameReplayEnvelope,
} from '../../../game-runtime/replayEnvelope';
import { stableHash } from '../../../headless/stableHash';
import { hashBlockPlacementState } from '../legacyRuntime';
import {
  BLOCK_PLACEMENT_CONFIG_SCHEMA_ID,
  BLOCK_PLACEMENT_GAME_ID,
  BLOCK_PLACEMENT_MODULE_VERSION,
  BLOCK_PLACEMENT_RULESET_ID,
  BLOCK_PLACEMENT_RULESET_VERSION,
  BLOCK_PLACEMENT_SEMANTIC_ACTION_SCHEMA_ID,
  BLOCK_PLACEMENT_STATE_SCHEMA_ID,
} from '../manifest';
import { parseBlockPlacementSemanticAction, parseBlockPlacementState } from '../schemas';

export const BLOCK_PLACEMENT_DEFAULT_PRODUCTION = {
  layoutProfileRef: {
    id: 'layout.vertical',
    version: '1.0.0',
    kind: 'ui-theme' as const,
    contentHash: 'sha256:778b13e5752b159bee8a945ec060d651358fef661526178d6ff2d32b8d9d7861',
  },
  cameraProfileRef: {
    id: 'camera.fixed',
    version: '1.0.0',
    kind: 'camera-profile' as const,
    contentHash: 'sha256:742c4944ae662e8e60e6137dedf032b03c43bd1c82c979e5a99cd5ad831a3259',
  },
  lookPackRef: {
    id: 'look.copper',
    version: '1.0.0',
    kind: 'look-pack' as const,
    contentHash: 'sha256:f0d08f1ad9be342531d3deefccbd41bd5fba0a0935b7cdcd84662ffa4a3de752',
  },
};

function placementFromReplay(
  replay: GameReplayEnvelope,
  actionId: string,
  actor: 'human' | 'agent',
  semantic: ReturnType<typeof parseBlockPlacementSemanticAction>,
): PlacementAction {
  const interaction = replay.interactions.find((item) => item.committedActionId === actionId);
  if (!interaction) {
    throw new GameSchemaError(
      'MISSING_FIELD',
      `Replay ${replay.takeId} action ${actionId} is missing a committed interaction.`,
      { path: `$.takes.actions.${actionId}` },
    );
  }
  const durationFrames = interaction.endFrame - interaction.startFrame;
  if (durationFrames < 1) {
    throw new GameSchemaError(
      'INVALID_VALUE',
      `Replay ${replay.takeId} action ${actionId} interaction duration must be at least 1 frame.`,
      { path: `$.takes.interactions.${interaction.id}` },
    );
  }
  return {
    id: actionId,
    actor,
    pieceId: semantic.pieceId,
    anchor: { ...semantic.anchor },
    durationFrames,
    pointerPath: interaction.samples ? interaction.samples.map((sample) => ({ ...sample })) : [],
  };
}

export function replayBlockPlacementV2(replay: GameReplayEnvelope, initialState: GameSnapshot): GameSnapshot {
  const actions = replay.actions.map((item) => {
    const semantic = parseBlockPlacementSemanticAction(item.action, `$.actions.${item.id}.action`);
    return placementFromReplay(replay, item.id, item.actor, semantic);
  });
  const transitions = replayActions(initialState, actions);
  return transitions.at(-1)?.after ?? initialState;
}

export function takeFromBlockPlacementReplay(
  project: GameProjectEnvelope,
  replay: GameReplayEnvelope,
): Take {
  const initial = parseBlockPlacementState(project.initialState.data, '$.game.initialState.data');
  return {
    id: replay.takeId,
    name: replay.takeId,
    createdAt: '1970-01-01T00:00:00.000Z',
    initial,
    actions: replay.actions.map((item) => {
      const semantic = parseBlockPlacementSemanticAction(item.action, `$.actions.${item.id}.action`);
      return placementFromReplay(replay, item.id, item.actor, semantic);
    }),
  };
}

export function migrateBlockPlacementTakeV1(take: Take, initialStateHash: string): GameReplayEnvelope {
  const split = take.actions.map((action) =>
    splitPointerPlacement({
      id: action.id,
      actor: action.actor,
      pieceId: action.pieceId,
      anchor: { ...action.anchor },
      durationFrames: action.durationFrames,
      pointerPath: action.pointerPath.map((sample) => ({ ...sample })),
      actionSchemaId: BLOCK_PLACEMENT_SEMANTIC_ACTION_SCHEMA_ID,
    }),
  );
  return {
    contract: GAME_REPLAY_CONTRACT,
    contractVersion: GAME_REPLAY_CONTRACT_VERSION,
    gameId: BLOCK_PLACEMENT_GAME_ID,
    moduleVersion: BLOCK_PLACEMENT_MODULE_VERSION,
    takeId: take.id,
    initialStateHash,
    seed: take.initial.seed,
    actions: split.map((item) => item.semantic),
    interactions: split.map((item) => item.interaction),
  };
}

export function migrateBlockPlacementV1(bundle: StudioBundle): StudioProjectDocumentV2 {
  const initial = createGame(
    bundle.project.setupBoard,
    bundle.project.seed,
    bundle.project.setupPieces,
    bundle.project.fixedPieceSupply,
    bundle.project.clearAxes,
    bundle.project.clearTrigger,
    bundle.project.referenceClearRules,
  );
  const initialStateHash = hashBlockPlacementState(initial);
  const document: StudioProjectDocumentV2 = {
    format: STUDIO_PROJECT_V2_FORMAT,
    version: STUDIO_PROJECT_V2_VERSION,
    id: bundle.project.id,
    name: bundle.project.name,
    game: {
      contract: GAME_PROJECT_CONTRACT,
      contractVersion: GAME_PROJECT_CONTRACT_VERSION,
      game: {
        id: BLOCK_PLACEMENT_GAME_ID,
        moduleVersion: BLOCK_PLACEMENT_MODULE_VERSION,
        rulesetId: BLOCK_PLACEMENT_RULESET_ID,
        rulesetVersion: BLOCK_PLACEMENT_RULESET_VERSION,
      },
      config: {
        schemaId: BLOCK_PLACEMENT_CONFIG_SCHEMA_ID,
        data: {
          board: bundle.project.setupBoard,
          ...(bundle.project.clearAxes?{clearAxes:bundle.project.clearAxes}:{}), ...(bundle.project.clearTrigger?{clearTrigger:bundle.project.clearTrigger}:{}), ...(bundle.project.referenceClearRules?{referenceClearRules:bundle.project.referenceClearRules}:{}),
          pieces: bundle.project.setupPieces,
          ...(bundle.project.fixedPieceSupply ? { fixedPieceSupply: bundle.project.fixedPieceSupply } : {}),
        },
      },
      initialState: {
        schemaId: BLOCK_PLACEMENT_STATE_SCHEMA_ID,
        data: initial,
        stateHash: initialStateHash,
      },
    },
    production: {
      ...BLOCK_PLACEMENT_DEFAULT_PRODUCTION,
      output: { ...bundle.project.render },
    },
    takes: bundle.takes.map((take) => migrateBlockPlacementTakeV1(take, initialStateHash)),
    direction: {
      ...(bundle.project.audio?{production:{version:'1.0.0' as const,audio:structuredClone(bundle.project.audio)}}:{}),
      rhythm: structuredClone(bundle.project.rhythm),
      style: structuredClone(bundle.project.style),
    },
  };
  return document;
}

export function reportBlockPlacementMigration(
  bundle: StudioBundle,
  document: StudioProjectDocumentV2,
): ProjectMigrationReport {
  const actionCount = document.takes.reduce((count, take) => count + take.actions.length, 0);
  const interactionCount = document.takes.reduce((count, take) => count + take.interactions.length, 0);
  return {
    sourceFormat: bundle.format,
    sourceVersion: bundle.version,
    sourceHash: stableHash(bundle),
    targetFormat: document.format,
    targetVersion: document.version,
    targetHash: stableHash(document),
    gameId: document.game.game.id,
    moduleVersion: document.game.game.moduleVersion,
    rulesetVersion: document.game.game.rulesetVersion,
    actionCount,
    interactionCount,
    warnings: [
      'Studio autosave and default export still write V1.',
      'Production profile refs are the builtin layout.vertical / camera.fixed / look.copper identities.',
    ],
  };
}

export function migrateUnknownProjectToV2(value: unknown): {
  document: StudioProjectDocumentV2;
  report: ProjectMigrationReport;
  bundle: StudioBundle;
} {
  const bundle = parseStudioBundle(value);
  const document = migrateBlockPlacementV1(bundle);
  return { document, bundle, report: reportBlockPlacementMigration(bundle, document) };
}

export const blockPlacementProjectMigrationAdapter: ProjectMigrationAdapter = {
  gameId: BLOCK_PLACEMENT_GAME_ID,
  canMigrate(value) {
    return Boolean(
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && (value as { format?: unknown }).format === 'block-creative-studio-project',
    );
  },
  migrate(value) {
    const { document, report } = migrateUnknownProjectToV2(value);
    return { document, report };
  },
};

export function replayHashesForV2Take(
  document: StudioProjectDocumentV2,
  replay: GameReplayEnvelope,
): { semanticHash: string; frameHash: string; finalStateHash: string } {
  const initial = parseBlockPlacementState(document.game.initialState.data, '$.game.initialState.data');
  if (hashBlockPlacementState(initial) !== replay.initialStateHash) {
    throw new GameSchemaError(
      'STATE_HASH_MISMATCH',
      `Replay ${replay.takeId} initialStateHash does not match the project initial state.`,
      { path: `$.takes.${replay.takeId}.initialStateHash` },
    );
  }
  const final = replayBlockPlacementV2(replay, initial);
  const rhythm = document.direction?.rhythm;
  if (rhythm === undefined) {
    throw new GameSchemaError('MISSING_FIELD', 'direction.rhythm is required to compute a frame hash.', {
      path: '$.direction.rhythm',
    });
  }
  const take: Take = {
    id: replay.takeId,
    name: replay.takeId,
    createdAt: '1970-01-01T00:00:00.000Z',
    initial,
    actions: replay.actions.map((item) => {
      const semantic = parseBlockPlacementSemanticAction(item.action);
      return placementFromReplay(replay, item.id, item.actor, semantic);
    }),
  };
  const compiled = compileTake(take, rhythm as RhythmProfile, document.production.output.fps);
  return {
    semanticHash: stableHash(semanticReplayIdentity(replay)),
    frameHash: stableHash(frameReplayIdentity(replay, {
      rhythm,
      fps: document.production.output.fps,
      totalFrames: compiled.totalFrames,
    })),
    finalStateHash: hashBlockPlacementState(final),
  };
}

export function studioBundleFromBlockPlacementV2(document: StudioProjectDocumentV2): StudioBundle {
  const style = document.direction?.style;
  const rhythm = document.direction?.rhythm;
  if (style === undefined || rhythm === undefined) {
    throw new GameSchemaError(
      'MISSING_FIELD',
      'V2 block 拖消 documents need direction.style and direction.rhythm to import into the current Studio.',
      { path: '$.direction' },
    );
  }
  const initial = parseBlockPlacementState(document.game.initialState.data, '$.game.initialState.data');
  const takes: Take[] = document.takes.map((replay) => ({
    id: replay.takeId,
    name: replay.takeId,
    createdAt: '1970-01-01T00:00:00.000Z',
    initial: structuredClone(initial),
    actions: replay.actions.map((item) => {
      const semantic = parseBlockPlacementSemanticAction(item.action, `$.takes.${replay.takeId}.actions.${item.id}`);
      return placementFromReplay(replay, item.id, item.actor, semantic);
    }),
  }));
  return {
    format: 'block-creative-studio-project',
    version: '1.0.0',
    project: {
      schemaVersion: '1.0.0',
      ...(productionFromDocument(document)?.audio?{audio:structuredClone(productionFromDocument(document)!.audio!)}:{}),
      id: document.id,
      name: document.name,
      ruleProfile: 'block-placement-classic-v1',
      seed: initial.seed,
      setupBoard: structuredClone(initial.board),
      ...(initial.clearAxes?{clearAxes:initial.clearAxes}:{}), ...(initial.clearTrigger?{clearTrigger:initial.clearTrigger}:{}), ...(initial.referenceClearRules?{referenceClearRules:initial.referenceClearRules}:{}),
      setupPieces: structuredClone(initial.pieces),
      ...(initial.fixedPieceSupply ? { fixedPieceSupply: structuredClone(initial.fixedPieceSupply) } : {}),
      style: structuredClone(style) as StudioBundle['project']['style'],
      rhythm: structuredClone(rhythm) as StudioBundle['project']['rhythm'],
      render: { ...document.production.output },
    },
    takes,
  };
}

export function importStudioDocument(value: unknown, registry?: GameRegistry): StudioBundle {
  const source = value as { format?: unknown };
  if (source?.format === STUDIO_PROJECT_V2_FORMAT) {
    const games = registry ?? new GameRegistry();
    if (!games.has(blockPlacementDefinition.manifest.gameId, blockPlacementDefinition.manifest.moduleVersion)) {
      games.register(blockPlacementDefinition);
    }
    return studioBundleFromBlockPlacementV2(validateStudioProjectDocumentV2(value, games));
  }
  return parseStudioBundle(value);
}
